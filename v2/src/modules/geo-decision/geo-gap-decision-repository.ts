import type pg from "pg";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { withTenantTransaction } from "../../platform/database.js";
import {
  actionProposalSchema, deepDiveRecommendationSchema, diagnosisSnapshotSchema, gapDecisionInputSchema,
  type ActionProposal, type DeepDiveRecommendation, type DiagnosisSnapshot, type GapDecisionInput,
} from "./geo-gap-decision.js";

export type PersistedGeoDecision = { diagnosis: DiagnosisSnapshot; actions: ActionProposal[]; deepDive: DeepDiveRecommendation };

export class GeoGapDecisionRepository {
  constructor(private readonly pool: pg.Pool) {}

  async input(tenantId: string): Promise<GapDecisionInput> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const runs = await client.query(`select g.id,g.answer_id,t.plan_id from geo_analysis_runs g
        join raw_answers r on r.tenant_id=g.tenant_id and r.id=g.answer_id
        join observation_targets t on t.tenant_id=r.tenant_id and t.id=r.target_id
        where g.status='completed' and g.rules_version='basic-geo.v1' and g.question_object_type='neutral_category' order by g.analyzed_at,g.id`);
      const runIds = runs.rows.map((row) => row.id as string);
      const planIds = [...new Set(runs.rows.map((row) => row.plan_id as string))];
      const mentions = runIds.length ? await client.query(`select m.run_id,m.entity_id,m.entity_role,m.certainty from geo_entity_mentions m
        where m.run_id=any($1::uuid[])`, [runIds]) : { rows: [] };
      const brandMentionRuns = new Set(mentions.rows.filter((row) => row.entity_role === "brand" && row.certainty === "certain").map((row) => row.run_id));
      const competitorRuns = new Map<string, Set<string>>();
      for (const row of mentions.rows.filter((item) => item.entity_role === "competitor" && item.certainty === "certain")) {
        const current = competitorRuns.get(row.entity_id) ?? new Set<string>(); current.add(row.run_id); competitorRuns.set(row.entity_id, current);
      }
      const truth = await client.query(`select facts from brand_truth_cards where status='approved' order by version desc limit 1`);
      const citations = runIds.length ? await client.query(`select count(*)::int count from citation_events where answer_id=any($1::uuid[])`, [runs.rows.map((row) => row.answer_id)]) : { rows: [{ count: 0 }] };
      return gapDecisionInputSchema.parse({
        tenantId, naturalSampleCount: runIds.length, observationPlanCount: planIds.length,
        brandMentionCount: brandMentionRuns.size,
        competitorMentions: [...competitorRuns.entries()].map(([entityId, ids]) => ({ entityId, count: ids.size })),
        brandTruthFactCount: Array.isArray(truth.rows[0]?.facts) ? truth.rows[0].facts.length : 0,
        citationCandidateCount: citations.rows[0]?.count ?? 0, geoRunIds: runIds, planIds,
        verifiedSignals: [], websiteEvidenceConnected: false,
      });
    });
  }

  async byInputHash(tenantId: string, inputSha256: string): Promise<PersistedGeoDecision | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query(`select * from geo_diagnosis_snapshots where rules_version='geo-gap-decision.v1' and input_sha256=$1 limit 1`, [inputSha256]);
      return result.rows[0] ? this.hydrate(client, result.rows[0]) : null;
    });
  }

  async latest(tenantId: string): Promise<PersistedGeoDecision | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query(`select * from geo_diagnosis_snapshots where rules_version='geo-gap-decision.v1' order by created_at desc,id desc limit 1`);
      return result.rows[0] ? this.hydrate(client, result.rows[0]) : null;
    });
  }

  async save(input: PersistedGeoDecision): Promise<void> {
    const diagnosis = diagnosisSnapshotSchema.parse(input.diagnosis);
    const actions = input.actions.map((item) => actionProposalSchema.parse(item));
    const deepDive = deepDiveRecommendationSchema.parse(input.deepDive);
    if (actions.some((item) => item.tenantId !== diagnosis.tenantId || item.diagnosisId !== diagnosis.id) || deepDive.tenantId !== diagnosis.tenantId || deepDive.diagnosisId !== diagnosis.id)
      throw new Error("GEO decision artifacts do not match diagnosis.");
    await withTenantTransaction(this.pool, diagnosis.tenantId, async (client) => {
      await client.query(`insert into geo_diagnosis_snapshots(id,tenant_id,rules_version,input_sha256,status,evidence_status,fact_level,sample_count,observation_plan_count,brand_mention_count,strongest_competitor_id,strongest_competitor_mention_count,primary_root_cause,summary,alternatives,missing_evidence,evidence_refs,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18)`,
        [diagnosis.id,diagnosis.tenantId,diagnosis.rulesVersion,diagnosis.inputSha256,diagnosis.status,diagnosis.evidenceStatus,diagnosis.factLevel,diagnosis.sampleCount,diagnosis.observationPlanCount,diagnosis.brandMentionCount,diagnosis.strongestCompetitorId,diagnosis.strongestCompetitorMentionCount,diagnosis.primaryRootCause,diagnosis.summary,JSON.stringify(diagnosis.alternatives),JSON.stringify(diagnosis.missingEvidence),JSON.stringify(diagnosis.evidenceRefs),diagnosis.createdAt]);
      for (const action of actions) await client.query(`insert into geo_action_proposals(id,tenant_id,diagnosis_id,action_type,fact_level,title,rationale,priority,risk,requires_approval,owner_type,expected_window,success_metric,verification_plan,evidence_refs,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16)`,
        [action.id,action.tenantId,action.diagnosisId,action.actionType,action.factLevel,action.title,action.rationale,action.priority,action.risk,action.requiresApproval,action.ownerType,action.expectedWindow,action.successMetric,JSON.stringify(action.verificationPlan),JSON.stringify(action.evidenceRefs),action.createdAt]);
      await client.query(`insert into competitor_deep_dive_recommendations(id,tenant_id,diagnosis_id,decision,fact_level,reason,proposed_sample_budget,question_themes,stop_conditions,requires_approval,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
        [deepDive.id,deepDive.tenantId,deepDive.diagnosisId,deepDive.decision,deepDive.factLevel,deepDive.reason,deepDive.proposedSampleBudget,JSON.stringify(deepDive.questionThemes),JSON.stringify(deepDive.stopConditions),deepDive.requiresApproval,deepDive.createdAt]);
      await appendAuditEvent(client, createAuditEvent({ tenantId: diagnosis.tenantId, actorType: "worker", actorId: "geo-gap-decision.v1", traceId: diagnosis.id,
        action: "geo_diagnosis.completed", resourceType: "geo_diagnosis_snapshot", resourceId: diagnosis.id,
        detail: { evidenceStatus: diagnosis.evidenceStatus, rootCause: diagnosis.primaryRootCause, actions: actions.length, deepDive: deepDive.decision } }));
    });
  }

  private async hydrate(client: pg.PoolClient, row: any): Promise<PersistedGeoDecision> {
    const actions = await client.query(`select * from geo_action_proposals where diagnosis_id=$1 order by case priority when 'high' then 1 when 'medium' then 2 else 3 end,created_at,id`, [row.id]);
    const deep = await client.query(`select * from competitor_deep_dive_recommendations where diagnosis_id=$1 limit 1`, [row.id]);
    const diagnosis = diagnosisSnapshotSchema.parse({ id:row.id,tenantId:row.tenant_id,rulesVersion:row.rules_version,inputSha256:row.input_sha256,status:row.status,evidenceStatus:row.evidence_status,factLevel:row.fact_level,
      sampleCount:row.sample_count,observationPlanCount:row.observation_plan_count,brandMentionCount:row.brand_mention_count,strongestCompetitorId:row.strongest_competitor_id,strongestCompetitorMentionCount:row.strongest_competitor_mention_count,
      primaryRootCause:row.primary_root_cause,summary:row.summary,alternatives:row.alternatives,missingEvidence:row.missing_evidence,evidenceRefs:row.evidence_refs,createdAt:row.created_at.toISOString() });
    return { diagnosis, actions: actions.rows.map((item) => actionProposalSchema.parse({ id:item.id,tenantId:item.tenant_id,diagnosisId:item.diagnosis_id,actionType:item.action_type,factLevel:item.fact_level,title:item.title,rationale:item.rationale,priority:item.priority,risk:item.risk,requiresApproval:item.requires_approval,ownerType:item.owner_type,expectedWindow:item.expected_window,successMetric:item.success_metric,verificationPlan:item.verification_plan,evidenceRefs:item.evidence_refs,createdAt:item.created_at.toISOString() })),
      deepDive: deepDiveRecommendationSchema.parse({ id:deep.rows[0].id,tenantId:deep.rows[0].tenant_id,diagnosisId:deep.rows[0].diagnosis_id,decision:deep.rows[0].decision,factLevel:deep.rows[0].fact_level,reason:deep.rows[0].reason,proposedSampleBudget:deep.rows[0].proposed_sample_budget,questionThemes:deep.rows[0].question_themes,stopConditions:deep.rows[0].stop_conditions,requiresApproval:deep.rows[0].requires_approval,createdAt:deep.rows[0].created_at.toISOString() }) };
  }
}
