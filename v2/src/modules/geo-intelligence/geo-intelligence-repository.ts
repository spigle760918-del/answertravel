import type pg from "pg";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { withTenantTransaction } from "../../platform/database.js";
import { geoAnalysisRunSchema, geoClaimSchema, geoEntitySetSchema, geoMentionSchema, geoRankingSchema,
  type GeoAnalysisRun, type GeoClaim, type GeoEntitySet, type GeoMention, type GeoRanking } from "./geo-intelligence.js";

export class GeoIntelligenceRepository {
  constructor(private readonly pool: pg.Pool) {}
  async createEntitySet(input: GeoEntitySet, actorId = "geo-intelligence.v1"): Promise<void> {
    const set = geoEntitySetSchema.parse(input);
    await withTenantTransaction(this.pool, set.tenantId, async (client) => {
      await client.query(`insert into geo_entity_sets(id,tenant_id,version,status,brand,competitors,created_at) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
        [set.id,set.tenantId,set.version,set.status,JSON.stringify(set.brand),JSON.stringify(set.competitors),set.createdAt]);
      await appendAuditEvent(client,createAuditEvent({tenantId:set.tenantId,actorType:set.status==="approved"?"user":"agent",actorId,traceId:set.id,
        action:`geo_entity_set.${set.status}`,resourceType:"geo_entity_set",resourceId:set.id,detail:{version:set.version,competitors:set.competitors.length}}));
    });
  }
  async latestApprovedEntitySet(tenantId:string):Promise<GeoEntitySet|null>{return withTenantTransaction(this.pool,tenantId,async client=>{
    const result=await client.query(`select id,tenant_id,version,status,brand,competitors,created_at from geo_entity_sets where status='approved' order by created_at desc,version desc limit 1`);const row=result.rows[0];
    return row?geoEntitySetSchema.parse({id:row.id,tenantId:row.tenant_id,version:row.version,status:row.status,brand:row.brand,competitors:row.competitors,createdAt:row.created_at.toISOString()}):null;});}
  async answerContext(tenantId:string,answerId:string):Promise<{answerText:string;questionObjectType:string}|null>{return withTenantTransaction(this.pool,tenantId,async client=>{
    const result=await client.query(`select r.answer_text, candidate.item->>'objectType' question_object_type from raw_answers r
      join observation_targets t on t.tenant_id=r.tenant_id and t.id=r.target_id join observation_plans p on p.tenant_id=t.tenant_id and p.id=t.plan_id
      join question_panels q on q.tenant_id=p.tenant_id and q.id=p.question_panel_id and q.version=p.question_panel_version
      left join lateral jsonb_array_elements(q.candidates) candidate(item) on candidate.item->>'id'=t.question_candidate_id::text where r.id=$1`,[answerId]);
    const row=result.rows[0];return row?{answerText:row.answer_text,questionObjectType:row.question_object_type??"unknown"}:null;});}
  async runForAnswer(tenantId:string,answerId:string):Promise<GeoAnalysisRun|null>{return withTenantTransaction(this.pool,tenantId,async client=>{
    const result=await client.query(`select id,tenant_id,answer_id,entity_set_id,entity_set_version,rules_version,status,question_object_type,error_code,analyzed_at
      from geo_analysis_runs where answer_id=$1 and rules_version='basic-geo.v1' order by analyzed_at desc limit 1`,[answerId]);const row=result.rows[0];
    return row?geoAnalysisRunSchema.parse({id:row.id,tenantId:row.tenant_id,answerId:row.answer_id,entitySetId:row.entity_set_id,entitySetVersion:row.entity_set_version,
      rulesVersion:row.rules_version,status:row.status,questionObjectType:row.question_object_type,errorCode:row.error_code,analyzedAt:row.analyzed_at.toISOString()}):null;});}
  async save(runInput:GeoAnalysisRun,mentionsInput:GeoMention[],rankingsInput:GeoRanking[],claimsInput:GeoClaim[]):Promise<void>{const run=geoAnalysisRunSchema.parse(runInput);
    const mentions=mentionsInput.map(item=>geoMentionSchema.parse(item)),rankings=rankingsInput.map(item=>geoRankingSchema.parse(item)),claims=claimsInput.map(item=>geoClaimSchema.parse(item));
    if([...mentions,...rankings,...claims].some(item=>item.tenantId!==run.tenantId||item.runId!==run.id))throw new Error("GEO facts do not match analysis run.");
    await withTenantTransaction(this.pool,run.tenantId,async client=>{await client.query(`insert into geo_analysis_runs(id,tenant_id,answer_id,entity_set_id,entity_set_version,rules_version,status,question_object_type,error_code,analyzed_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[run.id,run.tenantId,run.answerId,run.entitySetId,run.entitySetVersion,run.rulesVersion,run.status,run.questionObjectType,run.errorCode,run.analyzedAt]);
      for(const item of mentions)await client.query(`insert into geo_entity_mentions(id,tenant_id,run_id,answer_id,entity_id,entity_role,matched_alias,start_offset,end_offset,excerpt,certainty,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[item.id,item.tenantId,item.runId,item.answerId,item.entityId,item.entityRole,item.matchedAlias,item.startOffset,item.endOffset,item.excerpt,item.certainty,item.createdAt]);
      for(const item of rankings)await client.query(`insert into geo_ranking_facts(id,tenant_id,run_id,entity_id,applicability,rank,reason,evidence_excerpt,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [item.id,item.tenantId,item.runId,item.entityId,item.applicability,item.rank,item.reason,item.evidenceExcerpt,item.createdAt]);
      for(const item of claims)await client.query(`insert into geo_claim_facts(id,tenant_id,run_id,entity_id,claim_text,sentiment,certainty,evidence_excerpt,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [item.id,item.tenantId,item.runId,item.entityId,item.claimText,item.sentiment,item.certainty,item.evidenceExcerpt,item.createdAt]);
      await appendAuditEvent(client,createAuditEvent({tenantId:run.tenantId,actorType:"worker",actorId:"basic-geo.v1",traceId:run.answerId,action:"geo_analysis.completed",resourceType:"geo_analysis_run",resourceId:run.id,
        detail:{mentions:mentions.length,claims:claims.length,applicableRankings:rankings.filter(item=>item.applicability==="applicable").length}}));});}
}
