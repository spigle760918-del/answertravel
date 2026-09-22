import type pg from "pg";
import {
  aiVisibilitySchema,
  competitorScopeSchema,
  competitorAnalysisSchema,
  observationPlanDetailSchema,
  observationPlanListSchema,
  observationPlanSummarySchema,
  productOverviewSchema,
  questionInsightSchema,
  questionPerformanceSchema,
  questionPanelDetailSchema,
  questionPanelListSchema,
  questionPanelSummarySchema,
  rawAnswerDetailSchema,
  sourceAnalysisSchema,
  workspaceSchema,
  type ObservationPlanSummary,
} from "../../../contracts/product-read.js";
import { withTenantTransaction } from "../../platform/database.js";

const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const countQuestions = (candidates: unknown): { includedCount: number; excludedCount: number } => {
  const items = Array.isArray(candidates) ? candidates : [];
  const includedCount = items.filter((item) => Boolean((item as { included?: unknown }).included)).length;
  return { includedCount, excludedCount: items.length - includedCount };
};

export class ProductReadRepository {
  constructor(private readonly pool: pg.Pool, private readonly environment: "development" | "test" | "production") {}

  async workspace(tenantId: string) {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const result = await client.query(`select t.id,t.display_name,
        (select brand_name from brand_truth_cards where status='approved' order by created_at desc,version desc limit 1) brand_name
        from tenants t where t.id=$1`, [tenantId]);
      const row = result.rows[0];
      if (!row) return null;
      return workspaceSchema.parse({ tenantId: row.id, brandName: row.brand_name ?? row.display_name, environment: this.environment,
        permissions: { viewQuestions: true, viewObservations: true, viewEvidence: true } });
    });
  }

  private panelSummary(row: any) {
    return questionPanelSummarySchema.parse({ id: row.id, version: row.version, status: row.status,
      ...countQuestions(row.candidates), createdAt: iso(row.created_at) });
  }

  async questionPanels(tenantId: string) {
    return withTenantTransaction(this.pool, tenantId, async (client) => questionPanelListSchema.parse({
      items: (await client.query(`select id,version,status,candidates,created_at from question_panels order by created_at desc,version desc limit 100`)).rows.map((row) => this.panelSummary(row)),
    }));
  }

  async questionPanel(tenantId: string, panelId: string, version: number) {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const row = (await client.query(`select id,version,status,brand_truth_version,candidates,mix,created_at from question_panels where id=$1 and version=$2`, [panelId, version])).rows[0];
      if (!row) return null;
      const summary = this.panelSummary(row);
      return questionPanelDetailSchema.parse({ ...summary, brandTruthVersion: row.brand_truth_version, mix: row.mix,
        questions: (row.candidates as any[]).map((item) => ({ id:item.id,text:item.text,journeyStage:item.journeyStage,objectType:item.objectType,panelRole:item.panelRole,
          intentCluster:item.intentCluster,audience:item.audience ?? null,scenario:item.scenario ?? null,included:item.included,exclusionReason:item.exclusionReason ?? null })) });
    });
  }

  private planSummary(row: any): ObservationPlanSummary {
    return observationPlanSummarySchema.parse({ id:row.id,questionPanelId:row.question_panel_id,questionPanelVersion:row.question_panel_version,
      provider:row.provider,model:row.model,surface:row.surface,cycleKey:row.cycle_key ?? null,authorized:Boolean(row.authorization_id),
      plannedSamples:Number(row.planned_samples),succeeded:Number(row.succeeded ?? 0),failed:Number(row.failed ?? 0),budgetStopped:Number(row.budget_stopped ?? 0),
      usedTokens:Number(row.used_tokens ?? 0),createdAt:iso(row.created_at) });
  }

  private planSelect = `select p.*,
    count(distinct t.id) filter(where latest.status='succeeded')::int succeeded,
    count(distinct t.id) filter(where latest.status in('retryable_failure','terminal_failure'))::int failed,
    count(distinct t.id) filter(where latest.status='budget_stopped')::int budget_stopped,
    coalesce(sum(latest.total_tokens),0)::int used_tokens
    from observation_plans p left join observation_targets t on t.tenant_id=p.tenant_id and t.plan_id=p.id
    left join lateral (select status,total_tokens from observation_attempts where tenant_id=t.tenant_id and target_id=t.id order by attempt desc limit 1) latest on true`;

  async observationPlans(tenantId: string) {
    return withTenantTransaction(this.pool, tenantId, async (client) => observationPlanListSchema.parse({ items:
      (await client.query(`${this.planSelect} group by p.tenant_id,p.id order by p.created_at desc limit 100`)).rows.map((row) => this.planSummary(row)) }));
  }

  async observationPlan(tenantId: string, planId: string) {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const row = (await client.query(`${this.planSelect} where p.id=$1 group by p.tenant_id,p.id`, [planId])).rows[0];
      if (!row) return null;
      const targets = (await client.query(`select t.*,
        latest.status latest_status,latest.attempt attempt_count,latest.error_code,latest.http_status,latest.total_tokens used_tokens,latest.completed_at,
        r.id answer_id from observation_targets t
        left join lateral (select * from observation_attempts where target_id=t.id order by attempt desc limit 1) latest on true
        left join raw_answers r on r.tenant_id=t.tenant_id and r.target_id=t.id where t.plan_id=$1 order by t.question_text,t.round`, [planId])).rows;
      return observationPlanDetailSchema.parse({ ...this.planSummary(row), rules: row.rules, targets: targets.map((item) => ({ id:item.id,questionCandidateId:item.question_candidate_id,
        question:item.question_text,round:item.round,language:item.context?.language ?? null,region:item.context?.regionContext ?? null,latestStatus:item.latest_status ?? null,
        attemptCount:Number(item.attempt_count ?? 0),errorCode:item.error_code ?? null,httpStatus:item.http_status ?? null,usedTokens:Number(item.used_tokens ?? 0),
        completedAt:item.completed_at ? iso(item.completed_at) : null,answerId:item.answer_id ?? null })) });
    });
  }

  async rawAnswer(tenantId: string, answerId: string) {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const row = (await client.query(`select r.*,t.plan_id,t.question_text,t.round,a.attempt,a.status,a.http_status,a.prompt_tokens,a.completion_tokens,a.total_tokens,a.completed_at,
        coalesce(cs.status,'pending') citation_status,coalesce(cs.candidate_count,0)::int citation_candidate_count,coalesce(g.status,'pending') geo_status
        from raw_answers r join observation_targets t on t.tenant_id=r.tenant_id and t.id=r.target_id
        join observation_attempts a on a.tenant_id=r.tenant_id and a.id=r.attempt_id
        left join lateral(select status,candidate_count from citation_scans where answer_id=r.id order by scanned_at desc limit 1) cs on true
        left join lateral(select status from geo_analysis_runs where answer_id=r.id order by analyzed_at desc limit 1) g on true where r.id=$1`, [answerId])).rows[0];
      if (!row) return null;
      return rawAnswerDetailSchema.parse({ id:row.id,planId:row.plan_id,targetId:row.target_id,question:row.question_text,round:row.round,answerText:row.answer_text,
        provider:"deepseek",model:row.model,surface:row.surface,finishReason:row.finish_reason,providerResponseId:row.provider_response_id,payloadSha256:row.payload_sha256,
        capturedAt:iso(row.captured_at),tokens:{prompt:row.prompt_tokens,completion:row.completion_tokens,total:row.total_tokens},
        attempt:{number:row.attempt,status:row.status,httpStatus:row.http_status ?? null,completedAt:iso(row.completed_at)},
        evidence:{citationStatus:row.citation_status,citationCandidateCount:row.citation_candidate_count,geoAnalysisStatus:row.geo_status} });
    });
  }

  async overview(tenantId: string) {
    const [panels, plans] = await Promise.all([this.questionPanels(tenantId), this.observationPlans(tenantId)]);
    const questionPanel = panels.items.find((item) => item.status === "approved") ?? panels.items[0] ?? null;
    const latestPlan = plans.items[0] ?? null;
    const totals = plans.items.reduce((sum, item) => ({ plans:sum.plans+1,plannedSamples:sum.plannedSamples+item.plannedSamples,succeeded:sum.succeeded+item.succeeded,
      failed:sum.failed+item.failed,budgetStopped:0,usedTokens:sum.usedTokens+item.usedTokens }), { plans:0,plannedSamples:0,succeeded:0,failed:0,budgetStopped:0,usedTokens:0 });
    const nextStep = !questionPanel || questionPanel.status !== "approved" ? "approve_questions" : !latestPlan ? "create_plan" : latestPlan.failed > 0 ? "review_failures" : "review_run";
    return productOverviewSchema.parse({ questionPanel, latestPlan, totals, nextStep });
  }

  async questionInsight(tenantId: string, requestedQuestionId?: string) {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const panel = (await client.query(`select id,version,candidates from question_panels
        order by case status when 'approved' then 0 else 1 end,created_at desc,version desc limit 1`)).rows[0];
      if (!panel) return questionInsightSchema.parse({ context:null,questions:[],selectedQuestionId:null,answers:[],entities:[],
        sources:{structuredCitations:0,inlineLinks:0,sourceListItems:0,absorptionCandidates:0,snapshots:0,successfulSnapshots:0},decision:null });

      const candidates: Array<{id:string;text:string;objectType:string;journeyStage:string;audience:string|null;scenario:string|null;included:boolean;plannedSamples:number;succeeded:number;failed:number}> = (Array.isArray(panel.candidates) ? panel.candidates : []).map((item: any) => ({
        id:item.id,text:item.text,objectType:item.objectType,journeyStage:item.journeyStage,audience:item.audience ?? null,
        scenario:item.scenario ?? null,included:Boolean(item.included),plannedSamples:0,succeeded:0,failed:0,
      }));
      const plans = (await client.query(`select id,provider,model,surface,rules,created_at from observation_plans
        where question_panel_id=$1 and question_panel_version=$2 order by created_at desc`,[panel.id,panel.version])).rows;
      const planIds = plans.map((item) => item.id as string);
      const targetCounts = planIds.length ? (await client.query(`select t.question_candidate_id,
        count(*)::int planned_samples,
        count(*) filter(where latest.status='succeeded')::int succeeded,
        count(*) filter(where latest.status in('retryable_failure','terminal_failure','budget_stopped'))::int failed
        from observation_targets t left join lateral(select status from observation_attempts where target_id=t.id order by attempt desc limit 1) latest on true
        where t.plan_id=any($1::uuid[]) group by t.question_candidate_id`,[planIds])).rows : [];
      const counts = new Map(targetCounts.map((item) => [item.question_candidate_id as string,item]));
      for (const item of candidates) { const count=counts.get(item.id); if(count){item.plannedSamples=Number(count.planned_samples);item.succeeded=Number(count.succeeded);item.failed=Number(count.failed);} }
      const selectable = candidates.filter((item) => item.included);
      const selected = selectable.find((item) => item.id===requestedQuestionId) ?? selectable[0] ?? candidates[0] ?? null;
      const targets = selected && planIds.length ? (await client.query(`select t.id,t.round,t.context,p.model,p.surface,
        latest.status,latest.error_code,latest.completed_at,r.id answer_id,r.captured_at,
        coalesce(cs.status,'pending') citation_status,coalesce(cs.candidate_count,0)::int citation_candidates,
        coalesce(ss.snapshot_count,0)::int source_snapshots,coalesce(ga.status,'pending') geo_status
        from observation_targets t join observation_plans p on p.tenant_id=t.tenant_id and p.id=t.plan_id
        left join lateral(select status,error_code,completed_at from observation_attempts where target_id=t.id order by attempt desc limit 1) latest on true
        left join raw_answers r on r.tenant_id=t.tenant_id and r.target_id=t.id
        left join lateral(select status,candidate_count from citation_scans where answer_id=r.id order by scanned_at desc limit 1) cs on true
        left join lateral(select count(s.id)::int snapshot_count from citation_events e join source_snapshots s on s.tenant_id=e.tenant_id and s.citation_event_id=e.id where e.answer_id=r.id) ss on true
        left join lateral(select status from geo_analysis_runs where answer_id=r.id order by analyzed_at desc limit 1) ga on true
        where t.plan_id=any($1::uuid[]) and t.question_candidate_id=$2 order by p.created_at desc,t.round`,[planIds,selected.id])).rows : [];
      const answerIds = targets.map((item) => item.answer_id as string | null).filter((item):item is string=>Boolean(item));
      const latestPlan = plans[0];
      const rules = latestPlan?.rules ?? {};
      const effectiveSamples=targets.filter((item)=>item.status==="succeeded").length;
      const failedSamples=targets.filter((item)=>["retryable_failure","terminal_failure","budget_stopped"].includes(item.status)).length;
      const providers=[...new Set(plans.map((item)=>item.provider))];
      const context = { panelId:panel.id,panelVersion:panel.version,planCount:plans.length,provider:latestPlan?.provider ?? null,model:latestPlan?.model ?? null,
        surface:latestPlan?.surface ?? null,language:rules.language ?? null,region:rules.regionContext ?? null,rulesVersion:rules.version ?? null,
        effectiveSamples,failedSamples,comparisonStatus:effectiveSamples===0?"insufficient":providers.length<2?"single_platform":"comparable" };

      const entitySet = (await client.query(`select brand,competitors from geo_entity_sets where status='approved' order by created_at desc,version desc limit 1`)).rows[0];
      const entityDefinitions = entitySet ? [{...entitySet.brand,role:"brand"},...(entitySet.competitors ?? []).map((item:any)=>({...item,role:"competitor"}))] : [];
      const mentionRows = answerIds.length ? (await client.query(`select m.entity_id,count(distinct m.answer_id)::int mentioned_answers,
        count(*) filter(where m.certainty='certain')::int certain_mentions
        from geo_entity_mentions m where m.answer_id=any($1::uuid[]) group by m.entity_id`,[answerIds])).rows : [];
      const claimRows = answerIds.length ? (await client.query(`select c.entity_id,count(*)::int claim_count from geo_claim_facts c
        join geo_analysis_runs g on g.tenant_id=c.tenant_id and g.id=c.run_id where g.answer_id=any($1::uuid[]) group by c.entity_id`,[answerIds])).rows : [];
      const rankRows = answerIds.length ? (await client.query(`select f.entity_id,array_agg(f.rank order by f.rank) filter(where f.applicability='applicable') ranks
        from geo_ranking_facts f join geo_analysis_runs g on g.tenant_id=f.tenant_id and g.id=f.run_id where g.answer_id=any($1::uuid[]) group by f.entity_id`,[answerIds])).rows : [];
      const byEntity=(rows:any[])=>new Map(rows.map((item)=>[item.entity_id as string,item]));
      const mentions=byEntity(mentionRows),claims=byEntity(claimRows),ranks=byEntity(rankRows);
      const entities=entityDefinitions.map((item:any)=>({id:item.id,name:item.name,role:item.role,mentionedAnswers:Number(mentions.get(item.id)?.mentioned_answers ?? 0),
        certainMentions:Number(mentions.get(item.id)?.certain_mentions ?? 0),claimCount:Number(claims.get(item.id)?.claim_count ?? 0),applicableRanks:(ranks.get(item.id)?.ranks ?? []).map(Number)}));

      const sourceRows = answerIds.length ? (await client.query(`select e.kind,count(*)::int count from citation_events e where e.answer_id=any($1::uuid[]) group by e.kind`,[answerIds])).rows : [];
      const sourceCounts=new Map(sourceRows.map((item)=>[item.kind as string,Number(item.count)]));
      const snapshotRow=answerIds.length ? (await client.query(`select count(s.id)::int snapshots,count(s.id) filter(where s.status='succeeded')::int successful
        from citation_events e join source_snapshots s on s.tenant_id=e.tenant_id and s.citation_event_id=e.id where e.answer_id=any($1::uuid[])`,[answerIds])).rows[0] : null;
      const sources={structuredCitations:sourceCounts.get("provider_citation")??0,inlineLinks:sourceCounts.get("inline_link")??0,
        sourceListItems:sourceCounts.get("source_list")??0,absorptionCandidates:sourceCounts.get("content_absorption_candidate")??0,
        snapshots:Number(snapshotRow?.snapshots??0),successfulSnapshots:Number(snapshotRow?.successful??0)};

      const diagnosis=(await client.query(`select * from geo_diagnosis_snapshots where status='completed' order by created_at desc,id desc limit 1`)).rows[0];
      const actionRows=diagnosis?(await client.query(`select * from geo_action_proposals where diagnosis_id=$1 order by case priority when 'high' then 1 when 'medium' then 2 else 3 end,created_at,id`,[diagnosis.id])).rows:[];
      const decision=diagnosis?{scope:"workspace_latest" as const,rulesVersion:diagnosis.rules_version,factLevel:diagnosis.fact_level,evidenceStatus:diagnosis.evidence_status,
        summary:diagnosis.summary,rootCause:diagnosis.primary_root_cause,sampleCount:Number(diagnosis.sample_count),missingEvidence:diagnosis.missing_evidence,
        actions:actionRows.map((item)=>({id:item.id,type:item.action_type,title:item.title,rationale:item.rationale,priority:item.priority,risk:item.risk,requiresApproval:item.requires_approval,factLevel:item.fact_level}))}:null;

      return questionInsightSchema.parse({context,questions:candidates,selectedQuestionId:selected?.id??null,
        answers:targets.map((item)=>({id:item.answer_id??null,round:item.round,status:item.status??"pending",errorCode:item.error_code??null,model:item.model,surface:item.surface,
          capturedAt:item.captured_at?iso(item.captured_at):null,citationStatus:item.citation_status,citationCandidates:Number(item.citation_candidates),sourceSnapshots:Number(item.source_snapshots),geoStatus:item.geo_status})),
        entities,sources,decision});
    });
  }

  async questionPerformance(tenantId: string) {
    return withTenantTransaction(this.pool, tenantId, async (client) => {
      const panel = (await client.query(`select id,version,candidates from question_panels
        order by case status when 'approved' then 0 else 1 end,created_at desc,version desc limit 1`)).rows[0];
      if (!panel) return questionPerformanceSchema.parse({context:null,items:[]});
      const candidates = (Array.isArray(panel.candidates) ? panel.candidates : []).filter((item:any)=>Boolean(item.included));
      const plans = (await client.query(`select id,provider,model,surface,rules,created_at from observation_plans
        where question_panel_id=$1 and question_panel_version=$2 order by created_at desc`,[panel.id,panel.version])).rows;
      const planIds=plans.map((item)=>item.id as string);
      const rows=planIds.length?(await client.query(`select t.question_candidate_id,latest.status,r.id answer_id,
        coalesce(geo.analyzed,false) geo_analyzed,coalesce(geo.brand_mentioned,false) brand_mentioned,
        coalesce(geo.competitor_mentioned,false) competitor_mentioned,coalesce(citations.candidates,0)::int citation_candidates,
        coalesce(citations.snapshots,0)::int source_snapshots
        from observation_targets t
        left join lateral(select status from observation_attempts where target_id=t.id order by attempt desc limit 1) latest on true
        left join raw_answers r on r.tenant_id=t.tenant_id and r.target_id=t.id
        left join lateral(select count(distinct g.id)>0 analyzed,
          coalesce(bool_or(m.entity_role='brand' and m.certainty='certain'),false) brand_mentioned,
          coalesce(bool_or(m.entity_role='competitor' and m.certainty='certain'),false) competitor_mentioned
          from geo_analysis_runs g left join geo_entity_mentions m on m.tenant_id=g.tenant_id and m.run_id=g.id
          where g.answer_id=r.id and g.status='completed') geo on true
        left join lateral(select coalesce(max(s.candidate_count),0)::int candidates,count(distinct snap.id)::int snapshots
          from citation_scans s left join citation_events e on e.tenant_id=s.tenant_id and e.scan_id=s.id
          left join source_snapshots snap on snap.tenant_id=e.tenant_id and snap.citation_event_id=e.id where s.answer_id=r.id) citations on true
        where t.plan_id=any($1::uuid[])`,[planIds])).rows:[];
      const byQuestion=new Map<string,any[]>();
      for(const row of rows){const values=byQuestion.get(row.question_candidate_id)??[];values.push(row);byQuestion.set(row.question_candidate_id,values);}
      const latest=plans[0];const rules=latest?.rules??{};
      const effectiveSamples=rows.filter((item)=>item.status==='succeeded').length;
      const failedSamples=rows.filter((item)=>['retryable_failure','terminal_failure','budget_stopped'].includes(item.status)).length;
      return questionPerformanceSchema.parse({context:{panelId:panel.id,panelVersion:panel.version,planCount:plans.length,provider:latest?.provider??null,
        model:latest?.model??null,surface:latest?.surface??null,rulesVersion:rules.version??null,effectiveSamples,failedSamples},
        items:candidates.map((candidate:any)=>{const samples=byQuestion.get(candidate.id)??[];return {id:candidate.id,text:candidate.text,objectType:candidate.objectType,
          journeyStage:candidate.journeyStage,audience:candidate.audience??null,scenario:candidate.scenario??null,plannedSamples:samples.length,
          effectiveAnswers:samples.filter((item)=>item.status==='succeeded').length,failedSamples:samples.filter((item)=>['retryable_failure','terminal_failure','budget_stopped'].includes(item.status)).length,
          geoAnalyzedAnswers:samples.filter((item)=>item.geo_analyzed).length,brandMentionAnswers:samples.filter((item)=>item.brand_mentioned).length,
          competitorMentionAnswers:samples.filter((item)=>item.competitor_mentioned).length,citationCandidates:samples.reduce((sum,item)=>sum+Number(item.citation_candidates),0),
          sourceSnapshots:samples.reduce((sum,item)=>sum+Number(item.source_snapshots),0)};})});
    });
  }

  async aiVisibility(tenantId:string){
    return withTenantTransaction(this.pool,tenantId,async(client)=>{
      const panel=(await client.query(`select id,version,candidates from question_panels order by case status when 'approved' then 0 else 1 end,created_at desc,version desc limit 1`)).rows[0];
      if(!panel)return aiVisibilitySchema.parse({context:null,brand:null,items:[]});
      const candidates=(Array.isArray(panel.candidates)?panel.candidates:[]).filter((item:any)=>Boolean(item.included));
      const plans=(await client.query(`select id,provider,model,surface,rules from observation_plans where question_panel_id=$1 and question_panel_version=$2 order by created_at desc`,[panel.id,panel.version])).rows;
      const planIds=plans.map(item=>item.id as string);
      const entitySet=(await client.query(`select brand from geo_entity_sets where status='approved' order by created_at desc,version desc limit 1`)).rows[0];
      const brand=entitySet?.brand?{id:String(entitySet.brand.id),name:String(entitySet.brand.name)}:null;
      const rows=planIds.length?(await client.query(`select t.question_candidate_id,latest.status,r.id answer_id,
        exists(select 1 from geo_analysis_runs g where g.answer_id=r.id and g.status='completed') analyzed,
        exists(select 1 from geo_entity_mentions m where m.answer_id=r.id and m.entity_role='brand' and m.certainty='certain') mentioned,
        (select count(*)::int from geo_entity_mentions m where m.answer_id=r.id and m.entity_role='brand' and m.certainty='certain') certain_mentions,
        (select count(*)::int from geo_claim_facts c join geo_analysis_runs g on g.tenant_id=c.tenant_id and g.id=c.run_id where g.answer_id=r.id and c.entity_id=$2) claim_count,
        (select count(*)::int from geo_claim_facts c join geo_analysis_runs g on g.tenant_id=c.tenant_id and g.id=c.run_id where g.answer_id=r.id and c.entity_id=$2 and c.sentiment='positive') positive_claims,
        (select count(*)::int from geo_claim_facts c join geo_analysis_runs g on g.tenant_id=c.tenant_id and g.id=c.run_id where g.answer_id=r.id and c.entity_id=$2 and c.sentiment='negative') negative_claims,
        (select array_agg(f.rank order by f.rank) from geo_ranking_facts f join geo_analysis_runs g on g.tenant_id=f.tenant_id and g.id=f.run_id where g.answer_id=r.id and f.entity_id=$2 and f.applicability='applicable') ranks
        from observation_targets t left join lateral(select status from observation_attempts where target_id=t.id order by attempt desc limit 1) latest on true
        left join raw_answers r on r.tenant_id=t.tenant_id and r.target_id=t.id where t.plan_id=any($1::uuid[])`,[planIds,brand?.id??""])).rows:[];
      const byQuestion=new Map<string,any[]>();for(const row of rows){const list=byQuestion.get(row.question_candidate_id)??[];list.push(row);byQuestion.set(row.question_candidate_id,list);}
      const latest=plans[0],rules=latest?.rules??{};const effectiveSamples=rows.filter(x=>x.status==='succeeded').length;const failedSamples=rows.filter(x=>['retryable_failure','terminal_failure','budget_stopped'].includes(x.status)).length;
      return aiVisibilitySchema.parse({context:{panelId:panel.id,panelVersion:panel.version,planCount:plans.length,provider:latest?.provider??null,model:latest?.model??null,surface:latest?.surface??null,rulesVersion:rules.version??null,effectiveSamples,failedSamples},brand,
        items:candidates.map((candidate:any)=>{const samples=byQuestion.get(candidate.id)??[];return{id:candidate.id,text:candidate.text,objectType:candidate.objectType,journeyStage:candidate.journeyStage,audience:candidate.audience??null,plannedSamples:samples.length,effectiveAnswers:samples.filter(x=>x.status==='succeeded').length,failedSamples:samples.filter(x=>['retryable_failure','terminal_failure','budget_stopped'].includes(x.status)).length,analyzedAnswers:samples.filter(x=>x.analyzed).length,mentionedAnswers:samples.filter(x=>x.mentioned).length,certainMentions:samples.reduce((n,x)=>n+Number(x.certain_mentions??0),0),claimCount:samples.reduce((n,x)=>n+Number(x.claim_count??0),0),positiveClaims:samples.reduce((n,x)=>n+Number(x.positive_claims??0),0),negativeClaims:samples.reduce((n,x)=>n+Number(x.negative_claims??0),0),applicableRanks:samples.flatMap(x=>(x.ranks??[]).map(Number))};})});
    });
  }

  async sourceAnalysis(tenantId:string){
    return withTenantTransaction(this.pool,tenantId,async(client)=>{
      const panel=(await client.query(`select id,version,candidates from question_panels order by case status when 'approved' then 0 else 1 end,created_at desc,version desc limit 1`)).rows[0];
      if(!panel)return sourceAnalysisSchema.parse({context:null,items:[],evidence:[]});
      const candidates=(Array.isArray(panel.candidates)?panel.candidates:[]).filter((item:any)=>Boolean(item.included));
      const plans=(await client.query(`select id,provider,model,surface,rules from observation_plans where question_panel_id=$1 and question_panel_version=$2 order by created_at desc`,[panel.id,panel.version])).rows;const planIds=plans.map(item=>item.id as string);
      const samples=planIds.length?(await client.query(`select t.question_candidate_id,latest.status,r.id answer_id,exists(select 1 from citation_scans cs where cs.answer_id=r.id) scanned from observation_targets t left join lateral(select status from observation_attempts where target_id=t.id order by attempt desc limit 1) latest on true left join raw_answers r on r.tenant_id=t.tenant_id and r.target_id=t.id where t.plan_id=any($1::uuid[])`,[planIds])).rows:[];
      const events=planIds.length?(await client.query(`select e.*,t.question_candidate_id,t.question_text,r.id answer_id,s.id snapshot_id,s.status snapshot_status,s.http_status,s.title snapshot_title,s.captured_at snapshot_captured_at,s.error_code snapshot_error_code
        from citation_events e join raw_answers r on r.tenant_id=e.tenant_id and r.id=e.answer_id join observation_targets t on t.tenant_id=r.tenant_id and t.id=r.target_id
        left join lateral(select * from source_snapshots where citation_event_id=e.id order by attempt desc limit 1) s on true where t.plan_id=any($1::uuid[]) order by e.created_at desc,e.id`,[planIds])).rows:[];
      const byQuestion=new Map<string,any[]>();for(const row of samples){const list=byQuestion.get(row.question_candidate_id)??[];list.push(row);byQuestion.set(row.question_candidate_id,list);}const eventsByQuestion=new Map<string,any[]>();for(const row of events){const list=eventsByQuestion.get(row.question_candidate_id)??[];list.push(row);eventsByQuestion.set(row.question_candidate_id,list);}
      const latest=plans[0],rules=latest?.rules??{};const effectiveSamples=samples.filter(x=>x.status==='succeeded').length;const failedSamples=samples.filter(x=>['retryable_failure','terminal_failure','budget_stopped'].includes(x.status)).length;
      return sourceAnalysisSchema.parse({context:{panelId:panel.id,panelVersion:panel.version,planCount:plans.length,provider:latest?.provider??null,model:latest?.model??null,surface:latest?.surface??null,rulesVersion:rules.version??null,effectiveSamples,failedSamples},items:candidates.map((candidate:any)=>{const qs=byQuestion.get(candidate.id)??[],qe=eventsByQuestion.get(candidate.id)??[];return{id:candidate.id,text:candidate.text,objectType:candidate.objectType,journeyStage:candidate.journeyStage,effectiveAnswers:qs.filter(x=>x.status==='succeeded').length,failedSamples:qs.filter(x=>['retryable_failure','terminal_failure','budget_stopped'].includes(x.status)).length,scannedAnswers:qs.filter(x=>x.scanned).length,inlineLinks:qe.filter(x=>x.kind==='inline_link').length,sourceListItems:qe.filter(x=>x.kind==='source_list').length,structuredCitations:qe.filter(x=>x.kind==='provider_citation').length,absorptionCandidates:qe.filter(x=>x.kind==='content_absorption_candidate').length,successfulSnapshots:qe.filter(x=>x.snapshot_status==='succeeded').length,blockedSnapshots:qe.filter(x=>x.snapshot_status==='blocked').length,failedSnapshots:qe.filter(x=>x.snapshot_status==='failed').length};}),evidence:events.map(row=>({id:row.id,questionId:row.question_candidate_id,question:row.question_text,answerId:row.answer_id,kind:row.kind,rawValue:row.raw_value,canonicalUrl:row.canonical_url??null,domain:row.domain??null,evidenceStatus:row.evidence_status,createdAt:iso(row.created_at),snapshot:row.snapshot_id?{id:row.snapshot_id,status:row.snapshot_status,httpStatus:row.http_status??null,title:row.snapshot_title??null,capturedAt:iso(row.snapshot_captured_at),errorCode:row.snapshot_error_code??null}:null}))});
    });
  }

  async competitorScope(tenantId:string){
    return withTenantTransaction(this.pool,tenantId,async(client)=>{
      const versions=(await client.query(`select v.id,v.version,v.status,v.effective_from,v.effective_to,v.region,v.created_at,count(e.id)::int entity_count from competitor_scope_versions v left join competitor_scope_entities e on e.tenant_id=v.tenant_id and e.scope_id=v.id and e.scope_version=v.version where v.tenant_id=current_setting('app.tenant_id')::uuid group by v.tenant_id,v.id order by v.version desc`)).rows;
      const current=versions.find(item=>item.status==='approved')??versions[0]??null;
      const entities=current?(await client.query(`select id,entity_id,name,aliases,relationship_type,overlapping_offerings,region,effective_from,effective_to,status,evidence_note,source_reference from competitor_scope_entities where scope_id=$1 and scope_version=$2 order by name,id`,[current.id,current.version])).rows:[];
      const scopeRow=current?(await client.query(`select * from competitor_scope_versions where id=$1 and version=$2`,[current.id,current.version])).rows[0]:null;
      return competitorScopeSchema.parse({status:!current?'not_established':current.status==='approved'?'approved':'not_comparable',current:scopeRow?{id:scopeRow.id,version:scopeRow.version,status:scopeRow.status,brandTruthVersion:scopeRow.brand_truth_version,effectiveFrom:scopeRow.effective_from.toISOString().slice(0,10),effectiveTo:scopeRow.effective_to?scopeRow.effective_to.toISOString().slice(0,10):null,region:scopeRow.region,evidenceNote:scopeRow.evidence_note,sourceReference:scopeRow.source_reference,confirmedAt:scopeRow.confirmed_at?iso(scopeRow.confirmed_at):null,createdAt:iso(scopeRow.created_at)}:null,versions:versions.map(item=>({id:item.id,version:item.version,status:item.status,effectiveFrom:item.effective_from.toISOString().slice(0,10),effectiveTo:item.effective_to?item.effective_to.toISOString().slice(0,10):null,region:item.region,entityCount:Number(item.entity_count),createdAt:iso(item.created_at)})),entities:entities.map(item=>({id:item.id,entityId:item.entity_id,name:item.name,aliases:item.aliases,relationshipType:item.relationship_type,overlappingOfferings:item.overlapping_offerings,region:item.region,effectiveFrom:item.effective_from.toISOString().slice(0,10),effectiveTo:item.effective_to?item.effective_to.toISOString().slice(0,10):null,status:item.status,evidenceNote:item.evidence_note,sourceReference:item.source_reference}))});
    });
  }

  async competitorAnalysis(tenantId:string){
    return withTenantTransaction(this.pool,tenantId,async(client)=>{
      const panel=(await client.query(`select id,version,candidates from question_panels order by case status when 'approved' then 0 else 1 end,created_at desc,version desc limit 1`)).rows[0];
      if(!panel)return competitorAnalysisSchema.parse({context:null,scope:null,items:[]});
      const plans=(await client.query(`select id,provider,model,surface,rules from observation_plans where question_panel_id=$1 and question_panel_version=$2 order by created_at desc`,[panel.id,panel.version])).rows;const planIds=plans.map(item=>item.id as string);
      const scope=(await client.query(`select id,version,region,effective_from,effective_to from competitor_scope_versions where status='approved' order by version desc limit 1`)).rows[0];
      const scopeEntities=scope?(await client.query(`select entity_id,name,relationship_type from competitor_scope_entities where scope_id=$1 and scope_version=$2 and status='approved' and relationship_type in ('direct_competitor','alternative') order by name`,[scope.id,scope.version])).rows:[];
      const entitySet=(await client.query(`select brand from geo_entity_sets where status='approved' order by created_at desc,version desc limit 1`)).rows[0];const brand=entitySet?.brand??null;
      const candidates=(Array.isArray(panel.candidates)?panel.candidates:[]).filter((item:any)=>Boolean(item.included));
      const samples=planIds.length?(await client.query(`select t.question_candidate_id,t.question_text,latest.status,r.id answer_id,ga.id geo_id from observation_targets t left join lateral(select status from observation_attempts where target_id=t.id order by attempt desc limit 1) latest on true left join raw_answers r on r.tenant_id=t.tenant_id and r.target_id=t.id left join geo_analysis_runs ga on ga.tenant_id=r.tenant_id and ga.answer_id=r.id and ga.status='completed' where t.plan_id=any($1::uuid[])`,[planIds])).rows:[];
      const mentions=planIds.length?(await client.query(`select t.question_candidate_id,r.id answer_id,m.entity_id,m.certainty,rf.rank from observation_targets t join raw_answers r on r.tenant_id=t.tenant_id and r.target_id=t.id join geo_analysis_runs ga on ga.tenant_id=r.tenant_id and ga.answer_id=r.id and ga.status='completed' join geo_entity_mentions m on m.tenant_id=ga.tenant_id and m.run_id=ga.id left join geo_ranking_facts rf on rf.tenant_id=ga.tenant_id and rf.run_id=ga.id and rf.entity_id=m.entity_id and rf.applicability='applicable' where t.plan_id=any($1::uuid[])`,[planIds])).rows:[];
      const latest=plans[0],rules=latest?.rules??{};const effectiveSamples=samples.filter(x=>x.status==='succeeded'&&x.answer_id).length;const failedSamples=samples.filter(x=>['retryable_failure','terminal_failure','budget_stopped'].includes(x.status)).length;
      const entityMetric=(entityId:string,entityName:string,relationshipType:"brand"|"direct_competitor"|"alternative",questionSamples:any[],questionMentions:any[])=>{const entityRows=questionMentions.filter(x=>x.entity_id===entityId);return {entityId,name:entityName,relationshipType:relationshipType==='brand'?undefined:relationshipType,analyzedAnswers:new Set(questionSamples.filter(x=>x.geo_id).map(x=>x.answer_id)).size,mentionedAnswers:new Set(entityRows.filter(x=>x.certainty==='certain').map(x=>x.answer_id)).size,certainMentions:entityRows.filter(x=>x.certainty==='certain').length,applicableRanks:[...new Set(entityRows.filter(x=>x.rank).map(x=>Number(x.rank)))].sort((a,b)=>a-b)};};
      return competitorAnalysisSchema.parse({context:{panelId:panel.id,panelVersion:panel.version,planCount:plans.length,provider:latest?.provider??null,model:latest?.model??null,surface:latest?.surface??null,rulesVersion:rules.version??null,effectiveSamples,failedSamples},scope:scope?{version:scope.version,region:scope.region,effectiveFrom:scope.effective_from.toISOString().slice(0,10),effectiveTo:scope.effective_to?scope.effective_to.toISOString().slice(0,10):null}:null,items:candidates.map((candidate:any)=>{const questionSamples=samples.filter(x=>x.question_candidate_id===candidate.id),questionMentions=mentions.filter(x=>x.question_candidate_id===candidate.id);const analyzedAnswers=new Set(questionSamples.filter(x=>x.geo_id).map(x=>x.answer_id)).size;const brandMetric=brand?entityMetric(String(brand.id),String(brand.name),'brand',questionSamples,questionMentions):{entityId:"",name:"本品牌",analyzedAnswers,mentionedAnswers:0,certainMentions:0,applicableRanks:[]};const competitors=scopeEntities.map((entity:any)=>entityMetric(entity.entity_id,entity.name,entity.relationship_type,questionSamples,questionMentions));const comparable=Boolean(scope&&brand&&competitors.length&&analyzedAnswers>0);return{id:candidate.id,text:candidate.text,objectType:candidate.objectType,journeyStage:candidate.journeyStage,comparability:!scope||!competitors.length?"not_comparable":comparable?"comparable":"insufficient",reason:!scope?"未建立已批准竞争范围":!competitors.length?"当前范围没有可比较实体":!analyzedAnswers?"该游客提问尚无完成 GEO 分析的有效回答":"同一采集口径下已有品牌与竞争实体分析证据",brand:{name:brandMetric.name,analyzedAnswers:brandMetric.analyzedAnswers,mentionedAnswers:brandMetric.mentionedAnswers,certainMentions:brandMetric.certainMentions,applicableRanks:brandMetric.applicableRanks},competitors:competitors.map((x:any)=>({entityId:x.entityId,name:x.name,relationshipType:x.relationshipType,analyzedAnswers:x.analyzedAnswers,mentionedAnswers:x.mentionedAnswers,certainMentions:x.certainMentions,applicableRanks:x.applicableRanks}))};})});
    });
  }
}
