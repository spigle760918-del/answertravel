import { createHash } from "node:crypto";
import pg from "pg";
import { createEvidenceEnvelope } from "../src/kernel/evidence-envelope.js";
import { approveBrandTruth, brandTruthCardSchema } from "../src/modules/brand-truth/brand-truth.js";
import { BrandTruthRepository } from "../src/modules/brand-truth/brand-truth-repository.js";
import { EvidenceRepository } from "../src/modules/evidence/evidence-repository.js";
import { geoEntitySetSchema } from "../src/modules/geo-intelligence/geo-intelligence.js";
import { GeoIntelligenceRepository } from "../src/modules/geo-intelligence/geo-intelligence-repository.js";
import { JIACHENG_APPROVED_QUESTIONS } from "../src/modules/question-intelligence/jiacheng-question-snapshot.js";
import {
  approveQuestionPanel,
  createQuestionPanelDraft,
  questionGenerationRunSchema,
  questionPanelSchema,
} from "../src/modules/question-intelligence/question-intelligence.js";
import { QuestionIntelligenceRepository } from "../src/modules/question-intelligence/question-intelligence-repository.js";
import {
  buildBenchmarkFactPack,
  buildBrandTruthDraftFromBenchmark,
} from "../src/modules/real-brand-onboarding/benchmark-fact-pack.js";
import {
  buildOnboardingPackage,
  createIntakeSource,
} from "../src/modules/real-brand-onboarding/real-brand-onboarding.js";
import { RealBrandOnboardingRepository } from "../src/modules/real-brand-onboarding/real-brand-onboarding-repository.js";
import { createDatabasePool, withTenantTransaction } from "../src/platform/database.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const stableUuid = (seed: string): string => {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};

const tenantId = stableUuid("answertravel-v2:production:beijing-jiacheng");
const tenantSlug = "beijing-jiacheng";
const brandName = "北京珈程国际旅行社";
const pool = createDatabasePool(databaseUrl);

try {
  const tenant = await withTenantTransaction(pool, tenantId, async (client) => {
    await client.query(
      `insert into tenants(id,slug,display_name) values($1,$2,$3)
       on conflict (id) do nothing`,
      [tenantId, tenantSlug, brandName],
    );
    const result = await client.query<{ id: string; slug: string; display_name: string }>(
      "select id,slug,display_name from tenants where id=$1",
      [tenantId],
    );
    return result.rows[0];
  });
  if (tenant?.slug !== tenantSlug || tenant.display_name !== brandName) {
    throw new Error("The deterministic Jiacheng tenant identity conflicts with existing data.");
  }

  const truthRepository = new BrandTruthRepository(pool);
  const storedTruth = await withTenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query(
      "select id,tenant_id,brand_name,version,status,facts,created_at from brand_truth_cards order by version desc limit 1",
    );
    return result.rows[0]
      ? brandTruthCardSchema.parse({
          id: result.rows[0].id,
          tenantId: result.rows[0].tenant_id,
          brandName: result.rows[0].brand_name,
          version: result.rows[0].version,
          status: result.rows[0].status,
          facts: result.rows[0].facts,
          createdAt: result.rows[0].created_at.toISOString(),
        })
      : null;
  });
  let approvedTruth = storedTruth;
  if (!approvedTruth) {
    const draft = buildBrandTruthDraftFromBenchmark({ tenantId, brandName });
    await truthRepository.create(draft, "jiacheng-production-bootstrap.v1");
    approvedTruth = await truthRepository.create(
      approveBrandTruth({
        ...draft,
        facts: draft.facts.map((fact) => ({ ...fact, status: "approved" as const })),
      }),
      "jiacheng-production-bootstrap.v1",
    );
  } else if (approvedTruth.status === "draft") {
    approvedTruth = await truthRepository.create(
      approveBrandTruth({
        ...approvedTruth,
        facts: approvedTruth.facts.map((fact) => ({ ...fact, status: "approved" as const })),
      }),
      "jiacheng-production-bootstrap.v1",
    );
  }
  if (approvedTruth.status !== "approved" || approvedTruth.brandName !== brandName) {
    throw new Error("Jiacheng approved brand truth is incomplete or conflicts with the production identity.");
  }

  const pack = buildBenchmarkFactPack("2026-09-14T00:00:00+08:00");
  const onboardingRepository = new RealBrandOnboardingRepository(pool);
  if (!(await onboardingRepository.latest(tenantId))) {
    const source = createIntakeSource({
      tenantId,
      sourceType: "manual",
      reference: "用户确认的北京珈程 GEO 基准事实包",
      capturedAt: pack.capturedAt,
      sensitive: true,
      content: pack,
    });
    await onboardingRepository.create(
      buildOnboardingPackage({
        tenantId,
        brandName,
        source,
        facts: pack.facts.map((fact) => ({
          statement: fact.statement,
          category: fact.category,
          factLevel: "F0" as const,
          visibility: fact.visibility,
          confidence: fact.accepted ? ("high" as const) : ("low" as const),
          needsHumanConfirmation: !fact.accepted,
        })),
        competitors: pack.competitors.map((competitor) => ({
          name: competitor.name,
          aliases: competitor.aliases,
          needsHumanConfirmation: false,
        })),
        seedQuestions: [
          { text: "第一次来北京，5天4晚跟团游怎么选？", group: "行程规划" },
          { text: "北京12人小团适合哪些游客？", group: "产品比较" },
          { text: "北京纯玩团如何确认没有购物和自费？", group: "风险确认" },
        ],
        gaps: [],
        conflicts: pack.contradictions,
      }),
    );
  }

  const entityRepository = new GeoIntelligenceRepository(pool);
  if (!(await entityRepository.latestApprovedEntitySet(tenantId))) {
    await entityRepository.createEntitySet(
      geoEntitySetSchema.parse({
        id: stableUuid("answertravel-v2:jiacheng:entity-set:v1"),
        tenantId,
        version: 1,
        status: "approved",
        createdAt: new Date().toISOString(),
        brand: { id: "brand", name: brandName, aliases: ["北京珈程"] },
        competitors: pack.competitors.map((competitor, index) => ({
          id: `competitor-${index + 1}`,
          name: competitor.name,
          aliases: competitor.aliases,
        })),
      }),
      "jiacheng-production-bootstrap.v1",
    );
  }

  const panelState = await withTenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query(
      "select id,tenant_id,version,status,brand_truth_card_id,brand_truth_version,generation_run_id,candidates,mix,created_at from question_panels order by created_at desc,version desc limit 1",
    );
    const row = result.rows[0];
    return row
      ? questionPanelSchema.parse({
          id: row.id,
          tenantId: row.tenant_id,
          version: row.version,
          status: row.status,
          brandTruthCardId: row.brand_truth_card_id,
          brandTruthVersion: row.brand_truth_version,
          generationRunId: row.generation_run_id,
          candidates: row.candidates,
          mix: row.mix,
          createdAt: row.created_at.toISOString(),
        })
      : null;
  });
  let approvedPanel = panelState;
  if (!approvedPanel) {
    const createdAt = new Date().toISOString();
    const generationId = stableUuid("answertravel-v2:jiacheng:question-generation:v1");
    const panelId = stableUuid("answertravel-v2:jiacheng:question-panel:v1");
    const snapshotEvidence = await new EvidenceRepository(pool).append(
      createEvidenceEnvelope({
        id: stableUuid("answertravel-v2:jiacheng:question-snapshot-evidence:v1"),
        tenantId,
        artifactType: "question_panel.user_approved_snapshot",
        factLevel: "F0",
        schemaVersion: 1,
        source: {
          system: "answertravel-v2-knowledge-base",
          reference: "docs/v2-knowledge-base/25-real-question-panel-intent-card.md",
          capturedAt: "2026-09-14T00:00:00+08:00",
          surface: "manual",
        },
        payload: {
          gate: "YES，通过真实游客问题组 Gate E",
          snapshotVersion: "question-snapshot.v1",
          questions: JIACHENG_APPROVED_QUESTIONS.map((item, index) => ({ index: index + 1, ...item })),
        },
      }),
      { actorType: "user", actorId: "jiacheng-production-bootstrap.v1", traceId: generationId },
    );
    const questions = new QuestionIntelligenceRepository(pool);
    const runInput = questionGenerationRunSchema.parse({
        id: generationId,
        tenantId,
        brandTruthCardId: approvedTruth.id,
        brandTruthVersion: approvedTruth.version,
        status: "succeeded",
        provider: "user_approved_snapshot",
        model: "not_applicable",
        promptVersion: "question-snapshot.v1",
        evidenceId: snapshotEvidence.id,
        errorCode: null,
        requestedAt: createdAt,
        completedAt: createdAt,
      });
    const existingRun = await withTenantTransaction(pool, tenantId, async (client) => {
      const result = await client.query(
        "select id from question_generation_runs where id=$1 limit 1",
        [generationId],
      );
      return Boolean(result.rows[0]);
    });
    const run = existingRun
      ? runInput
      : await questions.createRun(runInput, "jiacheng-production-bootstrap.v1");
    const draft = await questions.createPanel(
      createQuestionPanelDraft({
        panelId,
        generationRunId: run.id,
        brandTruth: approvedTruth,
        generated: JIACHENG_APPROVED_QUESTIONS,
        generation: {
          id: generationId,
          tenantId,
          panelId,
          brandAliases: ["北京珈程"],
          destinations: ["北京"],
          competitors: pack.competitors.map((item) => item.name),
          questionScope: "brand_and_neutral_only",
          seedQuestions: [],
          requestedTotal: 20,
          promptVersion: "question-expansion.v2",
          createdAt,
        },
        forbiddenExpressions: pack.forbiddenExpressions,
        createdAt,
      }),
      "jiacheng-production-bootstrap.v1",
    );
    approvedPanel = await questions.createPanel(
      approveQuestionPanel(draft, [], new Date().toISOString()),
      "jiacheng-production-bootstrap.v1",
    );
  } else if (approvedPanel.status === "draft") {
    approvedPanel = await new QuestionIntelligenceRepository(pool).createPanel(
      approveQuestionPanel(approvedPanel, [], new Date().toISOString()),
      "jiacheng-production-bootstrap.v1",
    );
  }
  if (approvedPanel.status !== "approved" || approvedPanel.mix.actualTotal !== 20) {
    throw new Error("Jiacheng approved question panel is incomplete.");
  }

  const counts = await withTenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query<{
      truths: string;
      onboarding: string;
      entities: string;
      panels: string;
      plans: string;
      answers: string;
      schedules: string;
    }>(`select
      (select count(*) from brand_truth_cards)::text truths,
      (select count(*) from real_brand_onboarding_packages)::text onboarding,
      (select count(*) from geo_entity_sets)::text entities,
      (select count(*) from question_panels)::text panels,
      (select count(*) from observation_plans)::text plans,
      (select count(*) from raw_answers)::text answers,
      (select count(*) from monitoring_schedules)::text schedules`);
    return result.rows[0];
  });
  console.log(
    JSON.stringify({
      event: "jiacheng.production_initialized",
      tenantId,
      tenantSlug,
      brandName,
      brandTruthVersion: approvedTruth.version,
      approvedQuestions: approvedPanel.mix.actualTotal,
      observationPlans: Number(counts?.plans ?? 0),
      rawAnswers: Number(counts?.answers ?? 0),
      monitoringSchedules: Number(counts?.schedules ?? 0),
      deepseekCalled: false,
      publicationAuthorized: false,
    }),
  );
} finally {
  await pool.end();
}
