import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveBrandTruth, createBrandTruthDraft } from "../../src/modules/brand-truth/brand-truth.js";
import { BrandTruthRepository } from "../../src/modules/brand-truth/brand-truth-repository.js";
import { EvidenceRepository } from "../../src/modules/evidence/evidence-repository.js";
import { DeepSeekQuestionError, DeepSeekQuestionGenerator } from "../../src/modules/question-intelligence/deepseek-question-generator.js";
import { approveQuestionPanel } from "../../src/modules/question-intelligence/question-intelligence.js";
import { QuestionIntelligenceRepository } from "../../src/modules/question-intelligence/question-intelligence-repository.js";
import { QuestionIntelligenceService } from "../../src/modules/question-intelligence/question-intelligence-service.js";
import { withTenantTransaction } from "../../src/platform/database.js";
import { testDatabaseUrl } from "../support/environment.js";

const url = testDatabaseUrl(); const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
const integration = describe.runIf(Boolean(url && adminUrl));

integration("PostgreSQL question intelligence guarantees", () => {
  const pool = new pg.Pool({ connectionString: url }); const admin = new pg.Pool({ connectionString: adminUrl });
  const tenantA = randomUUID(); const tenantB = randomUUID(); const truthRepo = new BrandTruthRepository(pool);
  const repository = new QuestionIntelligenceRepository(pool); const evidence = new EvidenceRepository(pool);
  beforeAll(async () => { await admin.query("insert into tenants(id,slug,display_name) values ($1,$2,$3),($4,$5,$6)",
    [tenantA, `questions-${tenantA.slice(0, 8)}`, "品牌甲", tenantB, `questions-${tenantB.slice(0, 8)}`, "品牌乙"]); });
  afterAll(async () => { await pool.end(); await admin.end(); });

  async function truth() {
    const draft = createBrandTruthDraft({ id: randomUUID(), tenantId: tenantA, brandName: "品牌甲", createdAt: new Date().toISOString(), facts: [
      { id: randomUUID(), statement: "提供适合六至十二岁儿童的云南亲子定制行程", category: "service", status: "draft", factLevel: "F0",
        public: true, visibility: "public", source: { type: "human", reference: "负责人确认" } },
    ] });
    await truthRepo.create(draft);
    const approved = approveBrandTruth({ ...draft, facts: draft.facts.map((item) => ({ ...item, status: "approved" as const })) });
    return truthRepo.create(approved, "brand-owner");
  }
  const input = (brandTruth: Awaited<ReturnType<typeof truth>>) => ({ id: randomUUID(), tenantId: tenantA, panelId: randomUUID(),
    brandAliases: ["甲旅行"], destinations: ["云南"], competitors: ["竞品乙"], seedQuestions: [], requestedTotal: 4,
    promptVersion: "question-expansion.v1" as const,
    createdAt: new Date().toISOString(), brandTruth });
  const generated = (factId: string) => ({ questions: [
    { text: "云南亲子旅行如何规划？", journeyStage: "planning", objectType: "neutral_category", panelRole: "baseline", intentCluster: "规划",
      audience: "亲子家庭", scenario: "五日游", supportingFactIds: [], rationale: "基准问题" },
    { text: "云南亲子游有哪些避坑事项？", journeyStage: "risk_confirmation", objectType: "neutral_category", panelRole: "baseline", intentCluster: "风险",
      audience: "亲子家庭", scenario: "出发前", supportingFactIds: [], rationale: "风险确认" },
    { text: "品牌甲适合六至十二岁儿童吗？", journeyStage: "comparison", objectType: "brand_direct", panelRole: "exploration", intentCluster: "适用人群",
      audience: "亲子家庭", scenario: null, supportingFactIds: [factId], rationale: "品牌适配" },
    { text: "品牌甲和竞品乙哪个更适合云南亲子游？", journeyStage: "comparison", objectType: "brand_vs_competitor", panelRole: "trigger", intentCluster: "品牌对比",
      audience: "亲子家庭", scenario: "云南", supportingFactIds: [factId], rationale: "竞品触发" },
  ] });
  const successFetch = (body: unknown) => (async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer integration-secret");
    return new Response(JSON.stringify({ id: "chatcmpl-integration", model: "deepseek-chat", choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(body) } }], usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } }), { status: 200 });
  }) as typeof fetch;

  it("persists evidence, an audited run and isolated versioned panels", async () => {
    const brandTruth = await truth(); const generation = input(brandTruth);
    const service = new QuestionIntelligenceService(new DeepSeekQuestionGenerator({ apiKey: "integration-secret", fetchImpl: successFetch(generated(brandTruth.facts[0]!.id)) }), evidence, repository);
    const panel = await service.generateDraft(generation, brandTruth, ["绝对保证"]);
    expect(panel).toMatchObject({ status: "draft", version: 1, mix: { requestedTotal: 4, actualTotal: 4 } });
    expect(await repository.latestPanel(tenantB, panel.id)).toBeNull();
    const approved = await repository.createPanel(approveQuestionPanel(panel, [], new Date().toISOString()), "brand-owner");
    expect((await repository.latestPanel(tenantA, panel.id))?.status).toBe("approved");
    const rows = await withTenantTransaction(pool, tenantA, (client) => client.query(`select r.status, r.error_code, e.payload, p.version, p.status as panel_status
      from question_generation_runs r join evidence_artifacts e on e.tenant_id=r.tenant_id and e.id=r.evidence_id
      join question_panels p on p.tenant_id=r.tenant_id and p.generation_run_id=r.id
      where r.id=$1 order by p.version`, [generation.id]));
    expect(rows.rows.map((row) => ({ status: row.status, error: row.error_code, version: row.version, panel: row.panel_status }))).toEqual([
      { status: "succeeded", error: null, version: 1, panel: "draft" }, { status: "succeeded", error: null, version: 2, panel: "approved" },
    ]);
    expect(JSON.stringify(rows.rows[0].payload)).not.toContain("integration-secret");
    expect(approved.version).toBe(2);
  });

  it("persists an explicit failed run and raw failure evidence without creating a panel", async () => {
    const brandTruth = await truth(); const generation = input(brandTruth);
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: "invalid request" } }), { status: 400 })) as typeof fetch;
    const service = new QuestionIntelligenceService(new DeepSeekQuestionGenerator({ apiKey: "integration-secret", fetchImpl }), evidence, repository);
    await expect(service.generateDraft(generation, brandTruth, [])).rejects.toMatchObject({ code: "http_400" } satisfies Partial<DeepSeekQuestionError>);
    const run = await withTenantTransaction(pool, tenantA, (client) => client.query(`select r.status,r.error_code,e.artifact_type,e.payload
      from question_generation_runs r join evidence_artifacts e on e.tenant_id=r.tenant_id and e.id=r.evidence_id where r.id=$1`, [generation.id]));
    expect(run.rows).toHaveLength(1);
    expect(run.rows[0]).toMatchObject({ status: "failed", error_code: "http_400", artifact_type: "question_generation.deepseek_failure" });
    expect(JSON.stringify(run.rows[0].payload)).not.toContain("integration-secret");
    expect(await repository.latestPanel(tenantA, generation.panelId)).toBeNull();
  });

  it("rejects mutation of generation and panel history", async () => {
    const brandTruth = await truth(); const generation = input(brandTruth);
    const service = new QuestionIntelligenceService(new DeepSeekQuestionGenerator({ apiKey: "integration-secret", fetchImpl: successFetch(generated(brandTruth.facts[0]!.id)) }), evidence, repository);
    const panel = await service.generateDraft(generation, brandTruth, []);
    await expect(withTenantTransaction(pool, tenantA, (client) => client.query("update question_panels set status='approved' where id=$1", [panel.id]))).rejects.toThrow("append-only");
    await expect(withTenantTransaction(pool, tenantA, (client) => client.query("delete from question_generation_runs where id=$1", [generation.id]))).rejects.toThrow("append-only");
  });
});
