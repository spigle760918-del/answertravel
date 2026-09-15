import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { approveBrandTruth, createBrandTruthDraft } from "../../src/modules/brand-truth/brand-truth.js";
import { BrandTruthRepository } from "../../src/modules/brand-truth/brand-truth-repository.js";
import { EvidenceRepository } from "../../src/modules/evidence/evidence-repository.js";
import { DeepSeekQuestionGenerator } from "../../src/modules/question-intelligence/deepseek-question-generator.js";
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
  const config = (tenantId?: string): AppConfig => ({
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: 4274, DATABASE_URL: databaseUrl!, REDIS_URL: redisUrl!,
    LOG_LEVEL: "silent", ...(tenantId ? { ACCEPTANCE_TENANT_ID: tenantId } : {}),
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
    await service.generateDraft({ id: randomUUID(), tenantId: tenantA, panelId: randomUUID(), brandAliases: [], destinations: ["云南"],
      competitors: [], seedQuestions: [], requestedTotal: 4, promptVersion: "question-expansion.v1", createdAt: new Date().toISOString() }, approved, []);
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
      expect(response.json()).toMatchObject({ environment: "acceptance_test", brand: { name: "验收品牌甲" }, observations: { plans: [], answers: [] }, alphaReadiness:{rulesVersion:"alpha-readiness.v1",overallStatus:"blocked",blockedCount:1,notInAlphaCount:3} });
      expect(response.body).not.toContain("fixture-key-never-persist");
      expect(response.body).not.toContain("browser-secret");
      expect(response.body).not.toContain("header-secret");
      expect(response.body).not.toContain(databaseUrl!);
      expect(response.body).not.toContain("91110112");
      expect(response.body).not.toContain("齐正春");
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
});
