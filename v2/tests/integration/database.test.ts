import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvidenceEnvelope } from "../../src/kernel/evidence-envelope.js";
import { EvidenceRepository } from "../../src/modules/evidence/evidence-repository.js";
import { withTenantTransaction } from "../../src/platform/database.js";
import { testDatabaseUrl } from "../support/environment.js";
import { appendAuditEvent } from "../../src/platform/audit.js";
import { createAuditEvent } from "../../src/kernel/audit-event.js";

const databaseUrl = testDatabaseUrl();
const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
const integration = describe.runIf(Boolean(databaseUrl && adminUrl));

integration("PostgreSQL evidence guarantees", () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const admin = new pg.Pool({ connectionString: adminUrl });
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const repository = new EvidenceRepository(pool);

  beforeAll(async () => {
    const role = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname=current_user");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await admin.query("insert into tenants(id, slug, display_name) values ($1, $2, $3), ($4, $5, $6)", [
      tenantA,
      `tenant-${tenantA.slice(0, 8)}`,
      "测试租户 A",
      tenantB,
      `tenant-${tenantB.slice(0, 8)}`,
      "测试租户 B"
    ]);
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  function fixture() {
    return createEvidenceEnvelope({ tenantId: tenantA, artifactType: "model.raw_answer", factLevel: "F1", schemaVersion: 1,
      source: { system: "integration-test", reference: `fixture://${randomUUID()}`, capturedAt: new Date().toISOString(), surface: "internal" },
      payload: { answer: "仅用于隔离测试的回答" } });
  }

  it("is idempotent and isolated by tenant", async () => {
    const evidence = createEvidenceEnvelope({
      tenantId: tenantA,
      artifactType: "model.raw_answer",
      factLevel: "F1",
      schemaVersion: 1,
      source: {
        system: "integration-test",
        reference: `fixture://${randomUUID()}`,
        capturedAt: new Date().toISOString(),
        surface: "internal"
      },
      payload: { answer: "测试回答" }
    });
    const first = await repository.append(evidence);
    const duplicate = await repository.append(evidence);
    expect(duplicate.id).toBe(first.id);
    expect(await repository.findById(tenantB, first.id)).toBeNull();
  });

  it("rejects updates to immutable evidence", async () => {
    const saved = await repository.append(fixture());
    await expect(
      withTenantTransaction(pool, tenantA, async (client) => {
        await client.query("update evidence_artifacts set payload = '{}'::jsonb where id = $1", [saved.id]);
      })
    ).rejects.toThrow("append-only");
  });

  it("commits one audit with concurrent duplicate evidence and preserves the exact payload", async () => {
    const envelope = fixture();
    const outputs = await Promise.all(Array.from({ length: 8 }, () => repository.append(envelope)));
    expect(new Set(outputs.map((value) => value.id)).size).toBe(1);
    expect(await repository.findById(tenantA, envelope.id)).toEqual(envelope);
    const audit = await withTenantTransaction(pool, tenantA, (client) =>
      client.query("select detail from audit_events where resource_id=$1", [envelope.id]));
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].detail.payloadSha256).toBe(envelope.payloadSha256);
  });

  it("rolls back evidence when audit validation fails, allowing a clean retry", async () => {
    const envelope = fixture();
    await expect(repository.append(envelope, { actorType: "system", actorId: "", traceId: "test" })).rejects.toThrow();
    expect(await repository.findById(tenantA, envelope.id)).toBeNull();
    expect((await repository.append(envelope)).id).toBe(envelope.id);
  });

  it("rejects reusing evidence identity with changed collection context", async () => {
    const envelope = fixture();
    await repository.append(envelope);
    await expect(repository.append({ ...envelope, source: { ...envelope.source, model: "different-model" } })).rejects.toThrow("collection context");
    expect((await repository.findById(tenantA, envelope.id))!.source).toEqual(envelope.source);
  });

  it("rejects cross-tenant audit writes and hides tenant metadata", async () => {
    const event = createAuditEvent({ tenantId: tenantB, actorType: "system", actorId: "test", action: "test.event",
      resourceType: "test.resource", resourceId: "test", traceId: "test", detail: {} });
    await expect(withTenantTransaction(pool, tenantA, (client) => appendAuditEvent(client, event))).rejects.toThrow(/row-level security/);
    const tenants = await withTenantTransaction(pool, tenantA, (client) => client.query("select id from tenants"));
    expect(tenants.rows).toEqual([{ id: tenantA }]);
  });

  it("clears tenant context on both commit and rollback", async () => {
    const reused = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await new EvidenceRepository(reused).append(fixture());
      expect((await reused.query("select id from evidence_artifacts")).rowCount).toBe(0);
      await expect(withTenantTransaction(reused, tenantA, async () => { throw new Error("fixture failure"); })).rejects.toThrow("fixture failure");
      expect((await reused.query("select id from evidence_artifacts")).rowCount).toBe(0);
    } finally { await reused.end(); }
  });

  it("refuses superuser application connections", async () => {
    await expect(new EvidenceRepository(admin).append(fixture())).rejects.toThrow("Unsafe application database role");
  });

  it.each(["update", "delete"] as const)("rejects %s of audit records", async (operation) => {
    const saved = await repository.append(fixture());
    const sql = operation === "update" ? "update audit_events set detail='{}'::jsonb where resource_id=$1" : "delete from audit_events where resource_id=$1";
    await expect(withTenantTransaction(pool, tenantA, (client) => client.query(sql, [saved.id]))).rejects.toThrow("append-only");
  });

  it("rejects evidence deletion and table truncation", async () => {
    const saved = await repository.append(fixture());
    await expect(withTenantTransaction(pool, tenantA, (client) => client.query("delete from evidence_artifacts where id=$1", [saved.id]))).rejects.toThrow("append-only");
    await expect(pool.query("truncate evidence_artifacts")).rejects.toThrow(/append-only|foreign key constraint/);
    await expect(pool.query("truncate audit_events")).rejects.toThrow("append-only");
  });
});
