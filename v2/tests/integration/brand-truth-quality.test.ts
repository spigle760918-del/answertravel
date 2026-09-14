import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrandTruthDraft } from "../../src/modules/brand-truth/brand-truth.js";
import { analyzeBrandTruthQuality, applyQualityDecisions } from "../../src/modules/brand-truth/brand-truth-quality.js";
import { BrandTruthQualityRepository } from "../../src/modules/brand-truth/brand-truth-quality-repository.js";
import { BrandTruthRepository } from "../../src/modules/brand-truth/brand-truth-repository.js";
import { withTenantTransaction } from "../../src/platform/database.js";
import { testDatabaseUrl } from "../support/environment.js";

const url = testDatabaseUrl();
const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
const integration = describe.runIf(Boolean(url && adminUrl));

integration("PostgreSQL brand truth quality guarantees", () => {
  const pool = new pg.Pool({ connectionString: url });
  const admin = new pg.Pool({ connectionString: adminUrl });
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const truthRepo = new BrandTruthRepository(pool);
  const qualityRepo = new BrandTruthQualityRepository(pool);
  beforeAll(async () => {
    await admin.query("insert into tenants(id,slug,display_name) values ($1,$2,$3),($4,$5,$6)",
      [tenantA, `quality-${tenantA.slice(0, 8)}`, "品牌 A", tenantB, `quality-${tenantB.slice(0, 8)}`, "品牌 B"]);
  });
  afterAll(async () => { await pool.end(); await admin.end(); });

  async function savedReport() {
    const card = createBrandTruthDraft({ id: randomUUID(), tenantId: tenantA, brandName: "品牌 A", createdAt: new Date().toISOString(), facts: [
      { id: randomUUID(), statement: "内部合同价仅供员工使用", category: "restriction", status: "draft", factLevel: "F0", public: false,
        source: { type: "human", reference: "企业确认" } },
    ] });
    const savedCard = await truthRepo.create(card);
    return qualityRepo.create(analyzeBrandTruthQuality(savedCard, { id: randomUUID(), createdAt: new Date().toISOString() }));
  }

  it("persists an audited immutable report and isolates tenants", async () => {
    const report = await savedReport();
    expect(await qualityRepo.findById(tenantA, report.id)).toEqual(report);
    expect(await qualityRepo.findById(tenantB, report.id)).toBeNull();
    const audit = await withTenantTransaction(pool, tenantA, (client) => client.query(
      "select action, detail->>'rulesVersion' as rules_version from audit_events where resource_id=$1", [report.id]));
    expect(audit.rows).toEqual([{ action: "brand_truth.quality_analyzed", rules_version: "brand-truth-quality.v1" }]);
  });

  it.each(["update", "delete"] as const)("rejects %s of a quality report", async (operation) => {
    const report = await savedReport();
    const sql = operation === "update" ? "update brand_truth_quality_reports set rules_version='brand-truth-quality.v2' where id=$1"
      : "delete from brand_truth_quality_reports where id=$1";
    await expect(withTenantTransaction(pool, tenantA, (client) => client.query(sql, [report.id]))).rejects.toThrow("append-only");
  });

  it("rejects truncating quality history", async () => {
    await expect(pool.query("truncate brand_truth_quality_reports")).rejects.toThrow("append-only");
  });

  it("rolls back the report when audit validation fails", async () => {
    const card = createBrandTruthDraft({ id: randomUUID(), tenantId: tenantA, brandName: "品牌 A", createdAt: new Date().toISOString(), facts: [
      { id: randomUUID(), statement: "可验证的真实服务说明", category: "service", status: "draft", factLevel: "F0", public: true,
        source: { type: "human", reference: "企业确认" } },
    ] });
    const saved = await truthRepo.create(card);
    const report = analyzeBrandTruthQuality(saved, { id: randomUUID(), createdAt: new Date().toISOString() });
    await expect(qualityRepo.create(report, "")).rejects.toThrow();
    expect(await qualityRepo.findById(tenantA, report.id)).toBeNull();
  });

  it("stores a human-confirmed resolution as a new card version without overwriting history", async () => {
    const keepId = randomUUID(); const removeId = randomUUID();
    const card = createBrandTruthDraft({ id: randomUUID(), tenantId: tenantA, brandName: "品牌 A", createdAt: new Date().toISOString(), facts: [
      { id: keepId, statement: "最多服务 20 人", category: "product", status: "draft", factLevel: "F0", public: false,
        subject: "亲子研学团", attribute: "人数上限", source: { type: "human", reference: "负责人确认" } },
      { id: removeId, statement: "最多服务 30 人", category: "product", status: "draft", factLevel: "F0", public: false,
        subject: "亲子研学团", attribute: "人数上限", source: { type: "official", reference: "旧版产品手册" } },
    ] });
    const first = await truthRepo.create(card);
    const report = await qualityRepo.create(analyzeBrandTruthQuality(first, { id: randomUUID(), createdAt: new Date().toISOString() }));
    const decisions = report.confirmationItems.filter((item) => item.kind !== "truth_input").map((item) => item.kind === "fact_selection"
      ? { confirmationItemId: item.id, selectedFactIds: [keepId], scopeByFactId: {} }
      : { confirmationItemId: item.id, selectedFactIds: [], scopeByFactId: Object.fromEntries(item.factIds.map((id) => [id, "internal" as const])) });
    const next = applyQualityDecisions(first, report, decisions, new Date().toISOString());
    await truthRepo.create(next, "brand-owner");
    const versions = await withTenantTransaction(pool, tenantA, (client) => client.query(
      "select version, facts from brand_truth_cards where id=$1 order by version", [first.id]));
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[0].facts).toHaveLength(2);
    expect(versions.rows[1]).toMatchObject({ version: 2 });
    expect(versions.rows[1].facts).toEqual([expect.objectContaining({ id: keepId, visibility: "internal", public: false })]);
  });
});
