import type pg from "pg";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { withTenantTransaction } from "../../platform/database.js";
import {
  optimizationActionPlanSchema,
  type OptimizationActionPlan,
} from "../optimization-action-plan/optimization-action-plan.js";
import {
  actionFactIntakeSchema,
  type ActionFactIntake,
} from "./action-fact-intake.js";

export class ActionFactIntakeRepository {
  constructor(private readonly pool: pg.Pool) {}

  async input(tenantId: string): Promise<OptimizationActionPlan> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query(
        "select * from optimization_action_plan_snapshots order by created_at desc,id desc limit 1",
      );
      if (!result.rows[0])
        throw new Error("Optimization action plan is required.");
      const row = result.rows[0];
      return optimizationActionPlanSchema.parse({
        id: row.id,
        tenantId: row.tenant_id,
        rulesVersion: row.rules_version,
        sourceRoutingSnapshotId: row.source_routing_snapshot_id,
        inputSha256: row.input_sha256,
        status: row.status,
        sourceFindingCount: row.source_finding_count,
        sourceClusterCount: row.source_cluster_count,
        packageCount: row.package_count,
        packages: row.packages,
        executionOrder: row.execution_order,
        createdAt: row.created_at.toISOString(),
      });
    });
  }

  async byHash(tenantId: string, inputSha256: string) {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query(
        "select * from action_fact_intake_snapshots where input_sha256=$1",
        [inputSha256],
      );
      return result.rows[0] ? this.map(result.rows[0]) : null;
    });
  }

  async save(raw: ActionFactIntake) {
    const intake = actionFactIntakeSchema.parse(raw);
    return withTenantTransaction(this.pool, intake.tenantId, async (client) => {
      const result = await client.query(
        "insert into action_fact_intake_snapshots(id,tenant_id,rules_version,action_plan_id,action_package_id,action_package_key,action_package_title,input_sha256,status,fact_level,personalization_mode,source_finding_count,core_envelope_fields,focus_count,focus_areas,response_options,acceptance_criteria,completeness_rules,missing_inputs,fact_draft_authorized,publication_authorized,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22) returning *",
        [
          intake.id,
          intake.tenantId,
          intake.rulesVersion,
          intake.actionPlanId,
          intake.actionPackageId,
          intake.actionPackageKey,
          intake.actionPackageTitle,
          intake.inputSha256,
          intake.status,
          intake.factLevel,
          intake.personalizationMode,
          intake.sourceFindingCount,
          JSON.stringify(intake.coreEnvelopeFields),
          intake.focusCount,
          JSON.stringify(intake.focusAreas),
          JSON.stringify(intake.responseOptions),
          JSON.stringify(intake.acceptanceCriteria),
          JSON.stringify(intake.completenessRules),
          JSON.stringify(intake.missingInputs),
          intake.factDraftAuthorized,
          intake.publicationAuthorized,
          intake.createdAt,
        ],
      );
      await appendAuditEvent(
        client,
        createAuditEvent({
          tenantId: intake.tenantId,
          actorType: "agent",
          actorId: "action-fact-intake.v1",
          traceId: intake.id,
          action: "action_fact_intake.prepared",
          resourceType: "action_fact_intake",
          resourceId: intake.id,
          detail: {
            actionPackageKey: intake.actionPackageKey,
            sourceFindingCount: intake.sourceFindingCount,
            focusCount: intake.focusCount,
            personalizationMode: intake.personalizationMode,
            factDraftAuthorized: false,
            publicationAuthorized: false,
          },
        }),
      );
      return this.map(result.rows[0]);
    });
  }

  async latest(tenantId: string) {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query(
        "select * from action_fact_intake_snapshots order by created_at desc,id desc limit 1",
      );
      return result.rows[0] ? this.map(result.rows[0]) : null;
    });
  }

  private map(row: any) {
    return actionFactIntakeSchema.parse({
      id: row.id,
      tenantId: row.tenant_id,
      rulesVersion: row.rules_version,
      actionPlanId: row.action_plan_id,
      actionPackageId: row.action_package_id,
      actionPackageKey: row.action_package_key,
      actionPackageTitle: row.action_package_title,
      inputSha256: row.input_sha256,
      status: row.status,
      factLevel: row.fact_level,
      personalizationMode: row.personalization_mode,
      sourceFindingCount: row.source_finding_count,
      coreEnvelopeFields: row.core_envelope_fields,
      focusCount: row.focus_count,
      focusAreas: row.focus_areas,
      responseOptions: row.response_options,
      acceptanceCriteria: row.acceptance_criteria,
      completenessRules: row.completeness_rules,
      missingInputs: row.missing_inputs,
      factDraftAuthorized: row.fact_draft_authorized,
      publicationAuthorized: row.publication_authorized,
      createdAt: row.created_at.toISOString(),
    });
  }
}
