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
      cycleKey: string;
      authorizedExpansion: boolean;
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
      geoAnalysis: {
        status: "pending" | "completed" | "failed";
        questionObjectType: string | null;
        mentions: Array<{ entityId: string; entityName: string; entityRole: string; matchedAlias: string; excerpt: string; certainty: string }>;
        rankings: Array<{ entityId: string; entityName: string; applicability: string; rank: number | null; reason: string; evidenceExcerpt: string | null }>;
        claims: Array<{ entityId: string; entityName: string; claimText: string; sentiment: string; certainty: string }>;
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
  observationCycles: null | {
    rulesVersion: "comparable-observation.v1";
    status: "comparable" | "not_comparable" | "insufficient";
    validAnswerCount: number;
    observationPlanCount: number;
    differences: string[];
    approvedSampleBudget: number;
    approvedTokenBudget: number;
    decisionReference: string;
    diagnosisId: string | null;
    createdAt: string;
  };
  realBrandOnboarding: null | {
    brandName: string;
    status: "draft";
    sources: Array<{ sourceType: string; reference: string; capturedAt: string }>;
    facts: Array<{ statement: string; category: string; visibility: string; confidence: string; needsHumanConfirmation: boolean }>;
    competitors: Array<{ name: string; aliases: string[]; needsHumanConfirmation: boolean }>;
    seedQuestions: Array<{ text: string; group: string }>;
    conflicts: string[];
    gaps: string[];
    readyForApproval: boolean;
  };
  geoIntelligence: {
    rulesVersion: "basic-geo.v1";
    naturalSampleCount: number;
    brandNaturalMentionCount: number;
    brandNaturalMentionRate: number | null;
    competitorNaturalMentions: Array<{ entityId: string; entityName: string; count: number; rate: number | null }>;
    applicableRankingFacts: number;
    claimSentiments: Array<{ sentiment: string; count: number }>;
    note: string;
  };
  decisionIntelligence: null | {
    rulesVersion: "geo-gap-decision.v1";
    factLevel: string;
    evidenceStatus: string;
    sampleCount: number;
    observationPlanCount: number;
    primaryRootCause: string;
    summary: string;
    alternatives: string[];
    missingEvidence: string[];
    strongestCompetitor: null | { entityId: string; entityName: string; mentionCount: number };
    actions: Array<{ actionType: string; factLevel: string; title: string; rationale: string; priority: string; risk: string; requiresApproval: boolean; ownerType: string; expectedWindow: string; successMetric: string }>;
    deepDive: { decision: string; factLevel: string; reason: string; proposedSampleBudget: number; questionThemes: string[]; stopConditions: string[]; requiresApproval: boolean };
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
      const entitySet = await client.query(
        `select brand,competitors from geo_entity_sets where status='approved' order by created_at desc,version desc limit 1`,
      );
      const plans =
        await client.query(`select p.id,p.model,p.surface,p.cycle_key,p.authorization_id,p.planned_samples,p.created_at,
      count(distinct a.id) filter(where a.status='succeeded')::int success,count(distinct a.id) filter(where a.status in('retryable_failure','terminal_failure'))::int failed,
      count(distinct a.id) filter(where a.status='budget_stopped')::int budget_stopped,coalesce(sum(a.total_tokens),0)::int tokens
      from observation_plans p left join observation_targets t on t.tenant_id=p.tenant_id and t.plan_id=p.id left join observation_attempts a on a.tenant_id=t.tenant_id and a.target_id=t.id
      group by p.id,p.model,p.surface,p.cycle_key,p.authorization_id,p.planned_samples,p.created_at order by p.created_at desc`);
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
      const geoRuns = await client.query(`select id,answer_id,status,question_object_type from geo_analysis_runs where rules_version='basic-geo.v1'`);
      const geoMentions = await client.query(`select run_id,entity_id,entity_role,matched_alias,excerpt,certainty from geo_entity_mentions`);
      const geoRankings = await client.query(`select run_id,entity_id,applicability,rank,reason,evidence_excerpt from geo_ranking_facts`);
      const geoClaims = await client.query(`select run_id,entity_id,claim_text,sentiment,certainty from geo_claim_facts`);
      const diagnosis = await client.query(`select * from geo_diagnosis_snapshots where rules_version='geo-gap-decision.v1' order by created_at desc,id desc limit 1`);
      const diagnosisRow = diagnosis.rows[0];
      const decisionActions = diagnosisRow ? await client.query(`select * from geo_action_proposals where diagnosis_id=$1 order by case priority when 'high' then 1 when 'medium' then 2 else 3 end,created_at,id`, [diagnosisRow.id]) : { rows: [] };
      const deepDive = diagnosisRow ? await client.query(`select * from competitor_deep_dive_recommendations where diagnosis_id=$1 limit 1`, [diagnosisRow.id]) : { rows: [] };
      const comparable = await client.query(`select c.*,a.max_new_samples,a.max_total_tokens,a.decision_reference from comparable_observation_snapshots c join sampling_expansion_authorizations a on a.tenant_id=c.tenant_id and a.id=c.authorization_id order by c.created_at desc,c.id desc limit 1`);
      const comparableRow = comparable.rows[0];
      const onboarding = await client.query(`select package,status from real_brand_onboarding_packages order by created_at desc,id desc limit 1`);
      const onboardingRow = onboarding.rows[0];
      const failures = await client.query(
        `select t.question_text,t.round,a.status,a.error_code,a.attempt,a.completed_at from observation_attempts a join observation_targets t on t.tenant_id=a.tenant_id and t.id=a.target_id where a.status<>'succeeded' order by a.completed_at desc`,
      );
      const b = brand.rows[0],
        q = quality.rows[0],
        p = panel.rows[0],
        entities = entitySet.rows[0];
      if (!b || !p) throw new Error("Acceptance dataset is incomplete.");
      const entityNames = new Map<string, string>();
      if (entities?.brand) entityNames.set(entities.brand.id, entities.brand.name);
      for (const competitor of entities?.competitors ?? [])
        entityNames.set(competitor.id, competitor.name);
      const scansByAnswer = new Map(
        citationScans.rows.map((row) => [row.answer_id, row]),
      );
      const eventsByAnswer = new Map<string, typeof citationEvents.rows>();
      for (const event of citationEvents.rows) {
        const current = eventsByAnswer.get(event.answer_id) ?? [];
        current.push(event);
        eventsByAnswer.set(event.answer_id, current);
      }
      const runsByAnswer = new Map(geoRuns.rows.map((row) => [row.answer_id, row]));
      const groupByRun = <T extends { run_id: string }>(rows: T[]) => {
        const grouped = new Map<string, T[]>(); for (const row of rows) { const current = grouped.get(row.run_id) ?? []; current.push(row); grouped.set(row.run_id, current); } return grouped;
      };
      const mentionsByRun = groupByRun(geoMentions.rows), rankingsByRun = groupByRun(geoRankings.rows), claimsByRun = groupByRun(geoClaims.rows);
      const neutralRuns = geoRuns.rows.filter((row) => row.status === "completed" && row.question_object_type === "neutral_category");
      const brandNaturalMentionCount = neutralRuns.filter((run) => (mentionsByRun.get(run.id) ?? []).some((item) => item.entity_role === "brand" && item.certainty === "certain")).length;
      const competitorCounts = new Map<string, number>();
      for (const run of neutralRuns) for (const entityId of new Set((mentionsByRun.get(run.id) ?? []).filter((item) => item.entity_role === "competitor" && item.certainty === "certain").map((item) => item.entity_id)))
        competitorCounts.set(entityId, (competitorCounts.get(entityId) ?? 0) + 1);
      const sentimentCounts = new Map<string, number>(); for (const claim of geoClaims.rows) sentimentCounts.set(claim.sentiment, (sentimentCounts.get(claim.sentiment) ?? 0) + 1);
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
            cycleKey: x.cycle_key,
            authorizedExpansion: Boolean(x.authorization_id),
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
            geoAnalysis: (() => {
              const run = runsByAnswer.get(x.id);
              if (!run) return { status: "pending" as const, questionObjectType: null, mentions: [], rankings: [], claims: [] };
              return { status: run.status, questionObjectType: run.question_object_type,
                mentions: (mentionsByRun.get(run.id) ?? []).map((item) => ({ entityId: item.entity_id, entityName: entityNames.get(item.entity_id) ?? item.entity_id, entityRole: item.entity_role, matchedAlias: item.matched_alias, excerpt: item.excerpt, certainty: item.certainty })),
                rankings: (rankingsByRun.get(run.id) ?? []).map((item) => ({ entityId: item.entity_id, entityName: entityNames.get(item.entity_id) ?? item.entity_id, applicability: item.applicability, rank: item.rank, reason: item.reason, evidenceExcerpt: item.evidence_excerpt })),
                claims: (claimsByRun.get(run.id) ?? []).map((item) => ({ entityId: item.entity_id, entityName: entityNames.get(item.entity_id) ?? item.entity_id, claimText: item.claim_text, sentiment: item.sentiment, certainty: item.certainty })) };
            })(),
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
        geoIntelligence: {
          rulesVersion: "basic-geo.v1",
          naturalSampleCount: neutralRuns.length,
          brandNaturalMentionCount,
          brandNaturalMentionRate: neutralRuns.length ? brandNaturalMentionCount / neutralRuns.length : null,
          competitorNaturalMentions: [...competitorCounts.entries()].map(([entityId, count]) => ({ entityId, entityName: entityNames.get(entityId) ?? entityId, count, rate: neutralRuns.length ? count / neutralRuns.length : null })),
          applicableRankingFacts: geoRankings.rows.filter((row) => row.applicability === "applicable").length,
          claimSentiments: [...sentimentCounts.entries()].map(([sentiment, count]) => ({ sentiment, count })),
          note: "仅统计中性品类问题的自然提及；品牌/竞品直问不进入该分母。",
        },
        decisionIntelligence: diagnosisRow ? {
          rulesVersion: diagnosisRow.rules_version,
          factLevel: diagnosisRow.fact_level,
          evidenceStatus: diagnosisRow.evidence_status,
          sampleCount: diagnosisRow.sample_count,
          observationPlanCount: diagnosisRow.observation_plan_count,
          primaryRootCause: diagnosisRow.primary_root_cause,
          summary: diagnosisRow.summary,
          alternatives: diagnosisRow.alternatives,
          missingEvidence: diagnosisRow.missing_evidence,
          strongestCompetitor: diagnosisRow.strongest_competitor_id ? { entityId: diagnosisRow.strongest_competitor_id, entityName: entityNames.get(diagnosisRow.strongest_competitor_id) ?? diagnosisRow.strongest_competitor_id, mentionCount: diagnosisRow.strongest_competitor_mention_count } : null,
          actions: decisionActions.rows.map((action) => ({ actionType:action.action_type,factLevel:action.fact_level,title:action.title,rationale:action.rationale,priority:action.priority,risk:action.risk,requiresApproval:action.requires_approval,ownerType:action.owner_type,expectedWindow:action.expected_window,successMetric:action.success_metric })),
          deepDive: { decision:deepDive.rows[0].decision,factLevel:deepDive.rows[0].fact_level,reason:deepDive.rows[0].reason,proposedSampleBudget:deepDive.rows[0].proposed_sample_budget,questionThemes:deepDive.rows[0].question_themes,stopConditions:deepDive.rows[0].stop_conditions,requiresApproval:deepDive.rows[0].requires_approval },
        } : null,
        observationCycles: comparableRow ? {
          rulesVersion: comparableRow.rules_version,
          status: comparableRow.status,
          validAnswerCount: comparableRow.valid_answer_count,
          observationPlanCount: comparableRow.observation_plan_count,
          differences: comparableRow.differences,
          approvedSampleBudget: comparableRow.max_new_samples,
          approvedTokenBudget: comparableRow.max_total_tokens,
          decisionReference: comparableRow.decision_reference,
          diagnosisId: comparableRow.diagnosis_id,
          createdAt: comparableRow.created_at.toISOString(),
        } : null,
        realBrandOnboarding: onboardingRow ? {
          brandName: onboardingRow.package.brandName,
          status: onboardingRow.status,
          sources: onboardingRow.package.sources.map((item:any)=>({sourceType:item.sourceType,reference:item.reference,capturedAt:item.capturedAt})),
          facts: onboardingRow.package.facts.map((item:any)=>({statement:item.visibility === "restricted" ? "[受限事实：具体内容不在验收台展示]" : item.statement,category:item.category,visibility:item.visibility,confidence:item.confidence,needsHumanConfirmation:item.needsHumanConfirmation})),
          competitors: onboardingRow.package.competitors.map((item:any)=>({name:item.name,aliases:item.aliases,needsHumanConfirmation:item.needsHumanConfirmation})),
          seedQuestions: onboardingRow.package.seedQuestions.map((item:any)=>({text:item.text,group:item.group})),
          conflicts: onboardingRow.package.conflicts,
          gaps: onboardingRow.package.gaps,
          readyForApproval: onboardingRow.package.gaps.length===0 && onboardingRow.package.facts.length>0 && onboardingRow.package.competitors.length>0,
        } : null,
        limitations: [
          "当前为验收测试数据，不代表真实品牌运营结果",
          "当前仅验证 DeepSeek API，不代表 DeepSeek Web/App 搜索表现",
          "当前仅提供基础提及、条件化排名和规则型主张情感，不代表完整 GEO 决策或趋势",
          "引用候选与页面快照不等于内容被模型吸收或产生因果影响",
          "差距诊断当前先执行确定性证据门禁；网站诊断尚未接入时会明确显示缺失，不由 AI 猜测",
          "第二观察周期只扩充获批的中性样本；竞对直问仍需独立 Yes/No",
        ],
      };
    });
  }
}
