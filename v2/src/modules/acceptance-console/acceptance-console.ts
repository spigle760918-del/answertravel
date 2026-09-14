import type pg from "pg";
import { withTenantTransaction } from "../../platform/database.js";

export type AcceptanceOverview = {
  environment: "acceptance_test";
  brand: {
    name: string;
    version: number;
    status: string;
    facts: Array<{
      statement: string;
      category: string;
      status: string;
      visibility: string;
      source: string;
    }>;
  };
  truthQuality: {
    issues: Array<{ type: string; message: string; certainty: string }>;
  };
  questions: {
    panelVersion: number;
    status: string;
    mix: unknown;
    items: Array<{
      id: string;
      text: string;
      objectType: string;
      panelRole: string;
      included: boolean;
      exclusionReason: string | null;
    }>;
  };
  observations: {
    plans: Array<{
      id: string;
      model: string;
      surface: string;
      plannedSamples: number;
      createdAt: string;
      success: number;
      failed: number;
      budgetStopped: number;
      tokens: number;
    }>;
    answers: Array<{
      id: string;
      planId: string;
      question: string;
      round: number;
      answerText: string;
      model: string;
      surface: string;
      finishReason: string;
      capturedAt: string;
      tokens: number;
      attempts: number;
      citationEvidence: {
        scanStatus: "pending" | "completed" | "failed";
        candidateCount: number;
        events: Array<{
          id: string;
          kind: string;
          rawUrl: string | null;
          canonicalUrl: string | null;
          domain: string | null;
          evidenceStatus: string;
          snapshot: null | {
            status: string;
            httpStatus: number | null;
            title: string | null;
            author: string | null;
            publishedAt: string | null;
            textExcerpt: string | null;
            contentSha256: string | null;
            errorCode: string | null;
            capturedAt: string;
          };
        }>;
      };
    }>;
    failures: Array<{
      question: string;
      round: number;
      status: string;
      errorCode: string | null;
      attempt: number;
      completedAt: string;
    }>;
  };
  limitations: string[];
};

export class AcceptanceConsoleRepository {
  constructor(private readonly pool: pg.Pool) {}
  async overview(tenantId: string): Promise<AcceptanceOverview> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const brand = await client.query(
        `select brand_name,version,status,facts from brand_truth_cards order by version desc limit 1`,
      );
      const quality = await client.query(
        `select issues from brand_truth_quality_reports order by created_at desc limit 1`,
      );
      const panel = await client.query(
        `select version,status,candidates,mix from question_panels order by created_at desc,version desc limit 1`,
      );
      const plans =
        await client.query(`select p.id,p.model,p.surface,p.planned_samples,p.created_at,
      count(distinct a.id) filter(where a.status='succeeded')::int success,count(distinct a.id) filter(where a.status in('retryable_failure','terminal_failure'))::int failed,
      count(distinct a.id) filter(where a.status='budget_stopped')::int budget_stopped,coalesce(sum(a.total_tokens),0)::int tokens
      from observation_plans p left join observation_targets t on t.tenant_id=p.tenant_id and t.plan_id=p.id left join observation_attempts a on a.tenant_id=t.tenant_id and a.target_id=t.id
      group by p.id,p.model,p.surface,p.planned_samples,p.created_at order by p.created_at desc`);
      const answers =
        await client.query(`select r.id,t.plan_id,t.question_text,t.round,r.answer_text,r.model,r.surface,r.finish_reason,r.captured_at,
      a.total_tokens,(select count(*)::int from observation_attempts x where x.tenant_id=t.tenant_id and x.target_id=t.id) attempts
      from raw_answers r join observation_targets t on t.tenant_id=r.tenant_id and t.id=r.target_id join observation_attempts a on a.tenant_id=r.tenant_id and a.id=r.attempt_id order by r.captured_at desc`);
      const citationScans = await client.query(
        `select answer_id,status,candidate_count from citation_scans where extractor_version='citation-extractor.v1'`,
      );
      const citationEvents =
        await client.query(`select e.id,e.answer_id,e.kind,e.raw_url,e.canonical_url,e.domain,e.evidence_status,
        s.status snapshot_status,s.http_status,s.title,s.author,s.published_at,s.text_excerpt,s.content_sha256,s.error_code,s.captured_at
        from citation_events e left join lateral (select status,http_status,title,author,published_at,text_excerpt,content_sha256,error_code,captured_at
          from source_snapshots where tenant_id=e.tenant_id and citation_event_id=e.id order by attempt desc limit 1) s on true
        order by e.created_at,e.id`);
      const failures = await client.query(
        `select t.question_text,t.round,a.status,a.error_code,a.attempt,a.completed_at from observation_attempts a join observation_targets t on t.tenant_id=a.tenant_id and t.id=a.target_id where a.status<>'succeeded' order by a.completed_at desc`,
      );
      const b = brand.rows[0],
        q = quality.rows[0],
        p = panel.rows[0];
      if (!b || !p) throw new Error("Acceptance dataset is incomplete.");
      const scansByAnswer = new Map(
        citationScans.rows.map((row) => [row.answer_id, row]),
      );
      const eventsByAnswer = new Map<string, typeof citationEvents.rows>();
      for (const event of citationEvents.rows) {
        const current = eventsByAnswer.get(event.answer_id) ?? [];
        current.push(event);
        eventsByAnswer.set(event.answer_id, current);
      }
      return {
        environment: "acceptance_test",
        brand: {
          name: b.brand_name,
          version: b.version,
          status: b.status,
          facts: (b.facts as any[]).map((f) => ({
            statement: f.statement,
            category: f.category,
            status: f.status,
            visibility: f.visibility ?? (f.public ? "public" : "undetermined"),
            source: f.source.reference,
          })),
        },
        truthQuality: {
          issues: ((q?.issues ?? []) as any[]).map((x) => ({
            type: x.type,
            message: x.message,
            certainty: x.certainty,
          })),
        },
        questions: {
          panelVersion: p.version,
          status: p.status,
          mix: p.mix,
          items: (p.candidates as any[]).map((x) => ({
            id: x.id,
            text: x.text,
            objectType: x.objectType,
            panelRole: x.panelRole,
            included: x.included,
            exclusionReason: x.exclusionReason,
          })),
        },
        observations: {
          plans: plans.rows.map((x) => ({
            id: x.id,
            model: x.model,
            surface: x.surface,
            plannedSamples: x.planned_samples,
            createdAt: x.created_at.toISOString(),
            success: x.success,
            failed: x.failed,
            budgetStopped: x.budget_stopped,
            tokens: x.tokens,
          })),
          answers: answers.rows.map((x) => ({
            id: x.id,
            planId: x.plan_id,
            question: x.question_text,
            round: x.round,
            answerText: x.answer_text,
            model: x.model,
            surface: x.surface,
            finishReason: x.finish_reason,
            capturedAt: x.captured_at.toISOString(),
            tokens: x.total_tokens,
            attempts: x.attempts,
            citationEvidence: {
              scanStatus: scansByAnswer.get(x.id)?.status ?? "pending",
              candidateCount: scansByAnswer.get(x.id)?.candidate_count ?? 0,
              events: (eventsByAnswer.get(x.id) ?? []).map((event) => ({
                id: event.id,
                kind: event.kind,
                rawUrl: event.raw_url,
                canonicalUrl: event.canonical_url,
                domain: event.domain,
                evidenceStatus: event.evidence_status,
                snapshot: event.snapshot_status
                  ? {
                      status: event.snapshot_status,
                      httpStatus: event.http_status,
                      title: event.title,
                      author: event.author,
                      publishedAt: event.published_at,
                      textExcerpt: event.text_excerpt,
                      contentSha256: event.content_sha256,
                      errorCode: event.error_code,
                      capturedAt: event.captured_at.toISOString(),
                    }
                  : null,
              })),
            },
          })),
          failures: failures.rows.map((x) => ({
            question: x.question_text,
            round: x.round,
            status: x.status,
            errorCode: x.error_code,
            attempt: x.attempt,
            completedAt: x.completed_at.toISOString(),
          })),
        },
        limitations: [
          "当前为验收测试数据，不代表真实品牌运营结果",
          "当前仅验证 DeepSeek API，不代表 DeepSeek Web/App 搜索表现",
          "尚未计算品牌提及率、排名、情感、引用或趋势",
          "引用候选与页面快照不等于内容被模型吸收或产生因果影响",
        ],
      };
    });
  }
}
