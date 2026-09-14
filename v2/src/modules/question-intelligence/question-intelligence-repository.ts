import type pg from "pg";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { withTenantTransaction } from "../../platform/database.js";
import { questionGenerationRunSchema, questionPanelSchema, type QuestionGenerationRun, type QuestionPanel } from "./question-intelligence.js";

type RunRow = { id: string; tenant_id: string; brand_truth_card_id: string; brand_truth_version: number; status: "succeeded" | "failed";
  provider: "deepseek"; model: string; prompt_version: "question-expansion.v1" | "question-expansion.v2"; evidence_id: string; error_code: string | null; requested_at: Date; completed_at: Date };
type PanelRow = { id: string; tenant_id: string; version: number; status: "draft" | "approved"; brand_truth_card_id: string;
  brand_truth_version: number; generation_run_id: string; candidates: unknown; mix: unknown; created_at: Date };
const mapRun = (row: RunRow): QuestionGenerationRun => questionGenerationRunSchema.parse({ id: row.id, tenantId: row.tenant_id,
  brandTruthCardId: row.brand_truth_card_id, brandTruthVersion: row.brand_truth_version, status: row.status, provider: row.provider,
  model: row.model, promptVersion: row.prompt_version, evidenceId: row.evidence_id, errorCode: row.error_code,
  requestedAt: row.requested_at.toISOString(), completedAt: row.completed_at.toISOString() });
const mapPanel = (row: PanelRow): QuestionPanel => questionPanelSchema.parse({ id: row.id, tenantId: row.tenant_id, version: row.version,
  status: row.status, brandTruthCardId: row.brand_truth_card_id, brandTruthVersion: row.brand_truth_version,
  generationRunId: row.generation_run_id, candidates: row.candidates, mix: row.mix, createdAt: row.created_at.toISOString() });

export class QuestionIntelligenceRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createRun(input: QuestionGenerationRun, actorId = "question-intelligence.v1"): Promise<QuestionGenerationRun> {
    const run = questionGenerationRunSchema.parse(input);
    return withTenantTransaction(this.pool, run.tenantId, async (client) => {
      const result = await client.query<RunRow>(`insert into question_generation_runs
        (id,tenant_id,brand_truth_card_id,brand_truth_version,status,provider,model,prompt_version,evidence_id,error_code,requested_at,completed_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        returning id,tenant_id,brand_truth_card_id,brand_truth_version,status,provider,model,prompt_version,evidence_id,error_code,requested_at,completed_at`,
        [run.id, run.tenantId, run.brandTruthCardId, run.brandTruthVersion, run.status, run.provider, run.model, run.promptVersion,
          run.evidenceId, run.errorCode, run.requestedAt, run.completedAt]);
      const row = result.rows[0]; if (!row) throw new Error("Question generation run insert returned no row.");
      await appendAuditEvent(client, createAuditEvent({ tenantId: run.tenantId, actorType: "agent", actorId, traceId: run.id,
        action: `question_generation.${run.status}`, resourceType: "question_generation_run", resourceId: run.id,
        detail: { provider: run.provider, model: run.model, promptVersion: run.promptVersion, evidenceId: run.evidenceId, errorCode: run.errorCode } }));
      return mapRun(row);
    });
  }

  async createPanel(input: QuestionPanel, actorId = "question-intelligence.v1"): Promise<QuestionPanel> {
    const panel = questionPanelSchema.parse(input);
    return withTenantTransaction(this.pool, panel.tenantId, async (client) => {
      const result = await client.query<PanelRow>(`insert into question_panels
        (id,tenant_id,version,status,brand_truth_card_id,brand_truth_version,generation_run_id,candidates,mix,created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
        returning id,tenant_id,version,status,brand_truth_card_id,brand_truth_version,generation_run_id,candidates,mix,created_at`,
        [panel.id, panel.tenantId, panel.version, panel.status, panel.brandTruthCardId, panel.brandTruthVersion, panel.generationRunId,
          JSON.stringify(panel.candidates), JSON.stringify(panel.mix), panel.createdAt]);
      const row = result.rows[0]; if (!row) throw new Error("Question panel insert returned no row.");
      await appendAuditEvent(client, createAuditEvent({ tenantId: panel.tenantId, actorType: panel.status === "approved" ? "user" : "agent",
        actorId, traceId: panel.generationRunId, action: panel.status === "approved" ? "question_panel.approved" : "question_panel.drafted",
        resourceType: "question_panel", resourceId: panel.id, detail: { version: panel.version, included: panel.mix.actualTotal } }));
      return mapPanel(row);
    });
  }

  async latestPanel(tenantId: string, panelId: string): Promise<QuestionPanel | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query<PanelRow>(`select id,tenant_id,version,status,brand_truth_card_id,brand_truth_version,
        generation_run_id,candidates,mix,created_at from question_panels where tenant_id=$1 and id=$2 order by version desc limit 1`,
        [tenantId, panelId]);
      return result.rows[0] ? mapPanel(result.rows[0]) : null;
    });
  }
}
