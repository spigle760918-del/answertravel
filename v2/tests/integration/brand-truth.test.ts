import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveBrandTruth, createBrandTruthDraft } from "../../src/modules/brand-truth/brand-truth.js";
import { BrandTruthRepository } from "../../src/modules/brand-truth/brand-truth-repository.js";
import { withTenantTransaction } from "../../src/platform/database.js";
import { testDatabaseUrl } from "../support/environment.js";

const url = testDatabaseUrl();
const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
const integration = describe.runIf(Boolean(url && adminUrl));

integration("PostgreSQL brand truth guarantees", () => {
  const pool = new pg.Pool({ connectionString: url });
  const admin = new pg.Pool({ connectionString: adminUrl });
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const repo = new BrandTruthRepository(pool);
  function draft() {
    return createBrandTruthDraft({ id: randomUUID(), tenantId: tenantA, brandName: "品牌 A", facts: [{ id: randomUUID(), statement: "真实服务", category: "service", status: "draft", factLevel: "F0", public: true, source: { type: "human", reference: "企业确认" } }], createdAt: new Date().toISOString() });
  }
  beforeAll(async () => {
    await admin.query("insert into tenants(id,slug,display_name) values ($1,$2,$3),($4,$5,$6)", [tenantA, `brand-${tenantA.slice(0,8)}`, "品牌 A", tenantB, `brand-${tenantB.slice(0,8)}`, "品牌 B"]);
  });
  afterAll(async () => { await pool.end(); await admin.end(); });
  it("persists an audited card and isolates tenants", async () => {
    const card = draft();
    const saved = await repo.create(card);
    expect(await repo.latest(tenantA, saved.id)).toEqual(saved);
    expect(await repo.latest(tenantB, saved.id)).toBeNull();
    const audit = await withTenantTransaction(pool, tenantA, (client) => client.query("select action from audit_events where resource_id=$1", [saved.id]));
    expect(audit.rows).toEqual([{ action: "brand_truth.drafted" }]);
  });

  it("keeps the draft and approval as separate immutable versions", async () => {
    const first = await repo.create(draft());
    const reviewed = { ...first, facts: first.facts.map((fact) => ({ ...fact, status: "approved" as const })) };
    const approved = await repo.create(approveBrandTruth(reviewed), "reviewer-1");
    expect(approved.version).toBe(2);
    expect((await repo.latest(tenantA, first.id))?.status).toBe("approved");
    const versions = await withTenantTransaction(pool, tenantA, (client) => client.query("select version,status from brand_truth_cards where id=$1 order by version", [first.id]));
    expect(versions.rows).toEqual([{ version: 1, status: "draft" }, { version: 2, status: "approved" }]);
  });

  it("rolls back the card when audit validation fails", async () => {
    const card = draft();
    await expect(repo.create(card, "")).rejects.toThrow();
    expect(await repo.latest(tenantA, card.id)).toBeNull();
  });

  it.each(["update", "delete"] as const)("rejects %s of stored versions", async (operation) => {
    const saved = await repo.create(draft());
    const sql = operation === "update" ? "update brand_truth_cards set brand_name='changed' where id=$1" : "delete from brand_truth_cards where id=$1";
    await expect(withTenantTransaction(pool, tenantA, (client) => client.query(sql, [saved.id]))).rejects.toThrow("append-only");
  });

  it("rejects truncating all brand truth history", async () => {
    await expect(pool.query("truncate brand_truth_cards")).rejects.toThrow("append-only");
  });
});
