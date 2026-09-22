import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { approveBrandTruth, createBrandTruthDraft } from "../../src/modules/brand-truth/brand-truth.js";
import { BrandTruthRepository } from "../../src/modules/brand-truth/brand-truth-repository.js";
import { EvidenceRepository } from "../../src/modules/evidence/evidence-repository.js";
import { DeepSeekQuestionGenerator } from "../../src/modules/question-intelligence/deepseek-question-generator.js";
import { createObservationPlan } from "../../src/modules/observation/observation.js";
import { ObservationRepository } from "../../src/modules/observation/observation-repository.js";
import { approveQuestionPanel } from "../../src/modules/question-intelligence/question-intelligence.js";
import { QuestionIntelligenceRepository } from "../../src/modules/question-intelligence/question-intelligence-repository.js";
import { QuestionIntelligenceService } from "../../src/modules/question-intelligence/question-intelligence-service.js";
import type { AppConfig } from "../../src/platform/config.js";
import { testDatabaseUrl, testRedisUrl } from "../support/environment.js";

const databaseUrl = testDatabaseUrl();
const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
const redisUrl = testRedisUrl();

describe.runIf(Boolean(databaseUrl && adminUrl && redisUrl))("acceptance console API boundaries", () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const admin = new pg.Pool({ connectionString: adminUrl });
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const planId = randomUUID();
  let answerId = "";
  const config = (tenantId?: string): AppConfig => ({
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: 4274, DATABASE_URL: databaseUrl!, REDIS_URL: redisUrl!,
    LOG_LEVEL: "silent", ...(tenantId ? { ACCEPTANCE_TENANT_ID: tenantId, PRODUCT_TENANT_ID: tenantId } : {}),
  });

  beforeAll(async () => {
    await admin.query("insert into tenants(id,slug,display_name) values ($1,$2,$3),($4,$5,$6)",
      [tenantA, `console-${tenantA.slice(0, 8)}`, "验收品牌甲", tenantB, `console-${tenantB.slice(0, 8)}`, "验收品牌乙"]);
    const truthRepository = new BrandTruthRepository(pool);
    const draft = createBrandTruthDraft({ id: randomUUID(), tenantId: tenantA, brandName: "验收品牌甲", createdAt: new Date().toISOString(), facts: [
      { id: randomUUID(), statement: "提供云南亲子行程咨询", category: "service", status: "draft", factLevel: "F0",
        public: true, visibility: "public", source: { type: "human", reference: "测试负责人确认" } },
    ] });
    await truthRepository.create(draft, "acceptance-test");
    const approved = await truthRepository.create(approveBrandTruth({ ...draft,
      facts: draft.facts.map((fact) => ({ ...fact, status: "approved" as const })) }), "acceptance-test");
    const generated = { questions: [
      { text: "云南亲子旅行如何规划？", journeyStage: "planning", objectType: "neutral_category", panelRole: "baseline", intentCluster: "规划", audience: "亲子家庭", scenario: "云南", supportingFactIds: [], rationale: "基准" },
      { text: "亲子出行有哪些风险？", journeyStage: "risk_confirmation", objectType: "neutral_category", panelRole: "baseline", intentCluster: "风险", audience: "亲子家庭", scenario: "出发前", supportingFactIds: [], rationale: "基准" },
      { text: "验收品牌甲怎么样？", journeyStage: "comparison", objectType: "brand_direct", panelRole: "exploration", intentCluster: "品牌", audience: "亲子家庭", scenario: null, supportingFactIds: [approved.facts[0]!.id], rationale: "品牌" },
      { text: "验收品牌甲适合云南亲子游吗？", journeyStage: "comparison", objectType: "brand_direct", panelRole: "trigger", intentCluster: "品牌", audience: "亲子家庭", scenario: "云南", supportingFactIds: [approved.facts[0]!.id], rationale: "触发" },
    ] };
    const fetchImpl = (async () => new Response(JSON.stringify({ id: "test-response", model: "deepseek-chat", choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(generated) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200 })) as typeof fetch;
    const service = new QuestionIntelligenceService(new DeepSeekQuestionGenerator({ apiKey: "fixture-key-never-persist", fetchImpl }),
      new EvidenceRepository(pool), new QuestionIntelligenceRepository(pool));
    const panel = await service.generateDraft({ id: randomUUID(), tenantId: tenantA, panelId: randomUUID(), brandAliases: [], destinations: ["云南"],
      competitors: [], seedQuestions: [], requestedTotal: 4, promptVersion: "question-expansion.v1", createdAt: new Date().toISOString() }, approved, []);
    const approvedPanel = await new QuestionIntelligenceRepository(pool).createPanel(
      approveQuestionPanel(panel, [], new Date().toISOString()),
      "acceptance-test",
    );
    const made = createObservationPlan({
      id: planId,
      panel: approvedPanel,
      cycleKey: "readonly-evidence-fixture",
      rules: {
        version: "deepseek-sampling.v1",
        rounds: 1,
        language: "简体中文",
        regionContext: "中国大陆",
        temperature: 0.2,
        maxTokens: 1000,
        timeoutMs: 30000,
        maxAttempts: 2,
        maxTotalTokens: 1000,
      },
      createdAt: new Date().toISOString(),
    });
    const observations = new ObservationRepository(pool);
    await observations.createPlan(made.plan, made.targets);
    const successfulTarget = made.targets[0]!;
    const failedTarget = made.targets[1]!;
    const firstAttemptAt = new Date(Date.now() - 2000).toISOString();
    await observations.recordAttempt({
      id: randomUUID(), tenantId: tenantA, targetId: successfulTarget.id, attempt: 1, status: "retryable_failure",
      request: { fixture: true }, response: null, errorCode: "network_error", httpStatus: null,
      promptTokens: 0, completionTokens: 0, totalTokens: 0, startedAt: firstAttemptAt, completedAt: firstAttemptAt,
    });
    const successAttemptId = randomUUID();
    const completedAt = new Date().toISOString();
    answerId = randomUUID();
    await observations.recordAttempt({
      id: successAttemptId, tenantId: tenantA, targetId: successfulTarget.id, attempt: 2, status: "succeeded",
      request: { fixture: true }, response: { id: "fixture-response" }, errorCode: null, httpStatus: 200,
      promptTokens: 10, completionTokens: 20, totalTokens: 30, startedAt: completedAt, completedAt,
    }, {
      id: answerId, tenantId: tenantA, targetId: successfulTarget.id, attemptId: successAttemptId,
      answerText: "这是一条用于验证只读证据下钻的原始回答。", providerResponseId: "fixture-response",
      model: "deepseek-chat", surface: "api", finishReason: "stop", payloadSha256: "a".repeat(64), capturedAt: completedAt,
    });
    await observations.recordAttempt({
      id: randomUUID(), tenantId: tenantA, targetId: failedTarget.id, attempt: 1, status: "terminal_failure",
      request: { fixture: true }, response: null, errorCode: "incomplete_response", httpStatus: 200,
      promptTokens: 0, completionTokens: 0, totalTokens: 0, startedAt: completedAt, completedAt,
    });
  });

  afterAll(async () => { await pool.end(); await admin.end(); });

  it("returns 404 when no fixed acceptance tenant is configured", async () => {
    const app = buildApp(config());
    try {
      const response = await app.inject({ url: "/api/acceptance/overview" });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "acceptance_console_disabled" });
    } finally { await app.close(); }
  });

  it("returns a traceable overview without leaking credentials", async () => {
    const app = buildApp(config(tenantA));
    try {
      const response = await app.inject({ url: "/api/acceptance/overview", headers: { authorization: "Bearer browser-secret", "x-api-key": "header-secret" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ environment: "acceptance_test", brand: { name: "验收品牌甲" }, observations: { plans: [expect.objectContaining({ id: planId })], answers: [expect.objectContaining({ id: answerId })] }, alphaReadiness:{rulesVersion:"alpha-readiness.v1",overallStatus:"blocked",blockedCount:1,notInAlphaCount:3} });
      expect(response.body).not.toContain("fixture-key-never-persist");
      expect(response.body).not.toContain("browser-secret");
      expect(response.body).not.toContain("header-secret");
      expect(response.body).not.toContain(databaseUrl!);
      expect(response.body).not.toContain("91110112");
      expect(response.body).not.toContain("齐正春");
    } finally { await app.close(); }
  });

  it("marks cloud runtime, HTTPS, and backup restore ready only when current-instance evidence is configured", async () => {
    const app = buildApp({
      ...config(tenantA),
      ALIYUN_RUNTIME_EVIDENCE: "阿里云容器运行证据",
      PUBLIC_HTTPS_EVIDENCE: "公网 HTTPS 验收证据",
      CLOUD_BACKUP_RESTORE_EVIDENCE: "生产备份与隔离恢复演练证据",
    });
    try {
      const response = await app.inject({ url: "/api/acceptance/overview" });
      expect(response.statusCode).toBe(200);
      const overview = response.json();
      expect(overview.alphaReadiness.blockedCount).toBe(0);
      expect(overview.alphaReadiness.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "aliyun_native", status: "ready", evidence: "阿里云容器运行证据" }),
          expect.objectContaining({ key: "https_domain", status: "ready", evidence: "公网 HTTPS 验收证据" }),
          expect.objectContaining({ key: "cloud_backup", status: "ready", evidence: "生产备份与隔离恢复演练证据" }),
        ]),
      );
    } finally { await app.close(); }
  });

  it("ignores arbitrary tenant query parameters and does not cross tenant boundaries", async () => {
    const app = buildApp(config(tenantB));
    try {
      const response = await app.inject({ url: `/api/acceptance/overview?tenantId=${tenantA}` });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ code: "acceptance_data_unavailable", message: "验收数据暂时不可用，请稍后重试。" });
      expect(response.body).not.toContain("验收品牌甲");
    } finally { await app.close(); }
  });

  it("serves page-scoped product reads without accepting a browser tenant override", async () => {
    const app = buildApp(config(tenantA));
    try {
      const workspace = await app.inject({ url: `/api/v1/workspace?tenantId=${tenantB}` });
      expect(workspace.statusCode).toBe(200);
      expect(workspace.json()).toMatchObject({ tenantId: tenantA, brandName: "验收品牌甲", permissions: { viewQuestions: true, viewObservations: true, viewEvidence: true } });
      expect(workspace.body).not.toContain(tenantB);

      const panels = await app.inject({ url: `/api/v1/question-panels?tenantId=${tenantB}` });
      expect(panels.statusCode).toBe(200);
      expect(panels.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ status: "draft", includedCount: 4 })]));
      expect(panels.body).not.toContain("品牌乙");

      const overview = await app.inject({ url: "/api/v1/overview" });
      expect(overview.statusCode).toBe(200);
      expect(overview.json()).toMatchObject({ totals: { plans: 1, plannedSamples: 4, succeeded: 1, failed: 1, usedTokens: 30 }, nextStep: "review_failures" });

      const insight = await app.inject({ url: `/api/v1/question-insights?tenantId=${tenantB}` });
      expect(insight.statusCode).toBe(200);
      expect(insight.json()).toMatchObject({ context:{panelVersion:expect.any(Number),provider:"deepseek",model:"deepseek-chat",surface:"api",effectiveSamples:1,comparisonStatus:"single_platform"},
        selectedQuestionId:expect.any(String),sources:{structuredCitations:0,inlineLinks:0,snapshots:0},entities:[],decision:null });
      expect(insight.json().context.panelVersion).toBeGreaterThan(0);
      expect(insight.body).not.toContain(tenantB);

      const performance=await app.inject({url:`/api/v1/question-performance?tenantId=${tenantB}`});
      expect(performance.statusCode).toBe(200);
      expect(performance.json()).toMatchObject({context:{panelVersion:expect.any(Number),provider:"deepseek",effectiveSamples:1,failedSamples:1},items:expect.arrayContaining([
        expect.objectContaining({text:"云南亲子旅行如何规划？",plannedSamples:1,effectiveAnswers:1,failedSamples:0,brandMentionAnswers:0,competitorMentionAnswers:0,citationCandidates:0,sourceSnapshots:0}),
        expect.objectContaining({text:"亲子出行有哪些风险？",plannedSamples:1,effectiveAnswers:0,failedSamples:1}),
      ])});
      expect(performance.body).not.toContain(tenantB);

      const visibility=await app.inject({url:`/api/v1/ai-visibility?tenantId=${tenantB}`});
      expect(visibility.statusCode).toBe(200);
      expect(visibility.json()).toMatchObject({context:{panelVersion:expect.any(Number),effectiveSamples:1,failedSamples:1},items:expect.arrayContaining([
        expect.objectContaining({text:"云南亲子旅行如何规划？",effectiveAnswers:1,failedSamples:0,analyzedAnswers:0,mentionedAnswers:0,applicableRanks:[]}),
      ])});
      expect(visibility.json()).not.toHaveProperty("visibilityScore");
      expect(visibility.body).not.toContain(tenantB);

      const sources=await app.inject({url:`/api/v1/source-analysis?tenantId=${tenantB}`});
      expect(sources.statusCode).toBe(200);
      expect(sources.json()).toMatchObject({context:{panelVersion:expect.any(Number),effectiveSamples:1,failedSamples:1},evidence:[],items:expect.arrayContaining([
        expect.objectContaining({text:"云南亲子旅行如何规划？",effectiveAnswers:1,scannedAnswers:0,inlineLinks:0,structuredCitations:0,successfulSnapshots:0}),
      ])});
      expect(sources.body).not.toContain(tenantB);

      const competitors=await app.inject({url:`/api/v1/competitor-analysis?tenantId=${tenantB}`});
      expect(competitors.statusCode).toBe(200);
      expect(competitors.json()).toMatchObject({scope:null,items:expect.any(Array)});
      expect(competitors.json()).not.toHaveProperty("marketShare");
      expect(competitors.body).not.toContain("品牌乙");
    } finally { await app.close(); }
  });

  it("reads populated run and answer details using only each target's latest attempt", async () => {
    const app = buildApp(config(tenantA));
    try {
      const plans = await app.inject({ url: "/api/v1/observation-plans" });
      expect(plans.statusCode).toBe(200);
      expect(plans.json().items[0]).toMatchObject({ id: planId, plannedSamples: 4, succeeded: 1, failed: 1, usedTokens: 30 });

      const run = await app.inject({ url: `/api/v1/observation-plans/${planId}` });
      expect(run.statusCode).toBe(200);
      expect(run.json()).toMatchObject({ id: planId, succeeded: 1, failed: 1, usedTokens: 30 });
      expect(run.json().targets).toEqual(expect.arrayContaining([
        expect.objectContaining({ latestStatus: "succeeded", attemptCount: 2, usedTokens: 30, answerId }),
        expect.objectContaining({ latestStatus: "terminal_failure", attemptCount: 1, errorCode: "incomplete_response", usedTokens: 0, answerId: null }),
      ]));

      const answer = await app.inject({ url: `/api/v1/raw-answers/${answerId}` });
      expect(answer.statusCode).toBe(200);
      expect(answer.json()).toMatchObject({ id: answerId, planId, provider: "deepseek", model: "deepseek-chat",
        tokens: { prompt: 10, completion: 20, total: 30 }, attempt: { number: 2, status: "succeeded", httpStatus: 200 },
        evidence: { citationStatus: "pending", citationCandidateCount: 0, geoAnalysisStatus: "pending" } });
      expect(answer.body).not.toContain("fixture-key-never-persist");
    } finally { await app.close(); }
  });

  it("returns 404 for another tenant's plan and answer without leaking their existence", async () => {
    const app = buildApp(config(tenantB));
    try {
      for (const url of [`/api/v1/observation-plans/${planId}`, `/api/v1/raw-answers/${answerId}`]) {
        const response = await app.inject({ url });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ code: "resource_not_found", message: "未找到该记录。" });
        expect(response.body).not.toContain(tenantA);
      }
    } finally { await app.close(); }
  });

  it("keeps product routes disabled without a trusted server-side tenant", async () => {
    const app = buildApp(config());
    try {
      const response = await app.inject({ url: `/api/v1/workspace?tenantId=${tenantA}` });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "product_workspace_disabled", message: "产品工作台尚未配置。" });
    } finally { await app.close(); }
  });
});
