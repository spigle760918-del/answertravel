import type pg from "pg";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { withTenantTransaction } from "../../platform/database.js";
import { comparableSnapshotSchema, expansionAuthorizationSchema, type ComparableObservationSnapshot, type ExpansionAuthorization } from "./comparable-observation-cycle.js";

export class ComparableObservationRepository {
  constructor(private readonly pool: pg.Pool) {}
  async authorize(raw: ExpansionAuthorization): Promise<ExpansionAuthorization> {
    const item = expansionAuthorizationSchema.parse(raw);
    return withTenantTransaction(this.pool, item.tenantId, async (client) => {
      const existing = await client.query("select * from sampling_expansion_authorizations where scope_sha256=$1", [item.scopeSha256]);
      if (existing.rows[0]) return expansionAuthorizationSchema.parse({ id:existing.rows[0].id,tenantId:existing.rows[0].tenant_id,decisionReference:existing.rows[0].decision_reference,status:existing.rows[0].status,allowedObjectType:existing.rows[0].allowed_object_type,maxNewSamples:existing.rows[0].max_new_samples,maxTotalTokens:existing.rows[0].max_total_tokens,scopeSha256:existing.rows[0].scope_sha256,approvedAt:existing.rows[0].approved_at.toISOString() });
      await client.query(`insert into sampling_expansion_authorizations(id,tenant_id,decision_reference,status,allowed_object_type,max_new_samples,max_total_tokens,scope_sha256,approved_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [item.id,item.tenantId,item.decisionReference,item.status,item.allowedObjectType,item.maxNewSamples,item.maxTotalTokens,item.scopeSha256,item.approvedAt]);
      await appendAuditEvent(client, createAuditEvent({ tenantId:item.tenantId,actorType:"user",actorId:"gate-a.confirmation",traceId:item.id,action:"sampling_expansion.approved",resourceType:"sampling_expansion_authorization",resourceId:item.id,detail:{maxNewSamples:item.maxNewSamples,maxTotalTokens:item.maxTotalTokens,decisionReference:item.decisionReference} }));
      return item;
    });
  }
  async saveSnapshot(raw: ComparableObservationSnapshot): Promise<ComparableObservationSnapshot> {
    const item = comparableSnapshotSchema.parse(raw);
    return withTenantTransaction(this.pool, item.tenantId, async (client) => {
      const existing = await client.query("select id from comparable_observation_snapshots where input_sha256=$1", [item.inputSha256]);
      if (existing.rows[0]) return item;
      await client.query(`insert into comparable_observation_snapshots(id,tenant_id,authorization_id,baseline_plan_id,comparison_plan_id,rules_version,input_sha256,status,differences,valid_answer_count,observation_plan_count,diagnosis_id,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
        [item.id,item.tenantId,item.authorizationId,item.baselinePlanId,item.comparisonPlanId,item.rulesVersion,item.inputSha256,item.status,JSON.stringify(item.differences),item.validAnswerCount,item.observationPlanCount,item.diagnosisId,item.createdAt]);
      await appendAuditEvent(client, createAuditEvent({ tenantId:item.tenantId,actorType:"worker",actorId:"comparable-observation.v1",traceId:item.id,action:"observation_cycles.compared",resourceType:"comparable_observation_snapshot",resourceId:item.id,detail:{status:item.status,differences:item.differences,validAnswerCount:item.validAnswerCount,diagnosisId:item.diagnosisId} }));
      return item;
    });
  }
  async latest(tenantId: string): Promise<ComparableObservationSnapshot | null> {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query("select * from comparable_observation_snapshots order by created_at desc,id desc limit 1");
      const x = result.rows[0];
      return x ? comparableSnapshotSchema.parse({ id:x.id,tenantId:x.tenant_id,authorizationId:x.authorization_id,baselinePlanId:x.baseline_plan_id,comparisonPlanId:x.comparison_plan_id,rulesVersion:x.rules_version,inputSha256:x.input_sha256,status:x.status,differences:x.differences,validAnswerCount:x.valid_answer_count,observationPlanCount:x.observation_plan_count,diagnosisId:x.diagnosis_id,createdAt:x.created_at.toISOString() }) : null;
    });
  }
}
