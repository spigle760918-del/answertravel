import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFoundationQueue, createFoundationWorker, enqueueFoundationJob } from "../../src/platform/foundation-queue.js";
import { withTenantTransaction } from "../../src/platform/database.js";
import { testDatabaseUrl, testRedisUrl } from "../support/environment.js";

const databaseUrl = testDatabaseUrl();
const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
const redisUrl = testRedisUrl();
describe.runIf(Boolean(databaseUrl && adminUrl && redisUrl))("durable foundation worker", () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const admin = new pg.Pool({ connectionString: adminUrl });
  const tenantId = randomUUID();
  let producer: ReturnType<typeof createFoundationQueue>;
  let consumer: ReturnType<typeof createFoundationWorker>;
  const contract = () => ({ name: "foundation.probe", version: 1, tenantId, idempotencyKey: randomUUID(),
    requestedAt: new Date().toISOString(), traceId: randomUUID(), payload: { testOnly: true } });
  async function createTenant(id: string) {
    await admin.query("insert into tenants(id,slug,display_name) values ($1,$2,$3)", [id, `queue-${id}`, "Queue fixture only"]);
  }
  beforeAll(async () => {
    await createTenant(tenantId);
    producer = createFoundationQueue(redisUrl!);
    consumer = createFoundationWorker(redisUrl!, pool, () => {});
    await consumer.worker.waitUntilReady();
  });
  afterAll(async () => {
    await consumer?.close(); await producer?.close(); await pool.end(); await admin.end();
  });

  it("persists one fact with audit across duplicate enqueue and re-delivery", async () => {
    const input = contract();
    const [first, duplicate] = await Promise.all([enqueueFoundationJob(producer.queue, input), enqueueFoundationJob(producer.queue, input)]);
    expect(duplicate.id).toBe(first.id);
    await vi.waitFor(async () => expect(await first.getState()).toBe("completed"), { timeout: 10000 });
    const completed = await producer.queue.getJob(first.id!);
    const firstEvidenceId = completed!.returnvalue.evidenceId;
    await completed!.remove();
    const replay = await enqueueFoundationJob(producer.queue, input);
    await vi.waitFor(async () => expect(await replay.getState()).toBe("completed"), { timeout: 10000 });
    const replayed = await producer.queue.getJob(replay.id!);
    expect(replayed!.returnvalue.evidenceId).toBe(firstEvidenceId);
    const records = await withTenantTransaction(pool, tenantId, (client) => client.query("select trace_id from audit_events where resource_id=$1", [firstEvidenceId]));
    expect(records.rows).toEqual([{ trace_id: input.traceId }]);
    await expect(enqueueFoundationJob(producer.queue, { ...input, payload: { testOnly: false } })).rejects.toThrow("different payload");
  });

  it("retries a transient database failure then completes", async () => {
    const delayedTenant = randomUUID();
    const job = await enqueueFoundationJob(producer.queue, { ...contract(), tenantId: delayedTenant });
    await vi.waitFor(async () => expect((await producer.queue.getJob(job.id!))!.attemptsMade).toBeGreaterThanOrEqual(1), { timeout: 10000 });
    await createTenant(delayedTenant);
    await vi.waitFor(async () => expect(await job.getState()).toBe("completed"), { timeout: 10000 });
  });

  it("keeps the same idempotency key distinct across tenants", async () => {
    const otherTenant = randomUUID();
    await createTenant(otherTenant);
    const input = contract();
    const first = await enqueueFoundationJob(producer.queue, input);
    const second = await enqueueFoundationJob(producer.queue, { ...input, tenantId: otherTenant });
    expect(first.id).not.toBe(second.id);
    await vi.waitFor(async () => {
      expect(await first.getState()).toBe("completed");
      expect(await second.getState()).toBe("completed");
    }, { timeout: 10000 });
  });

  it("fails unsupported contract versions without a success receipt", async () => {
    const job = await enqueueFoundationJob(producer.queue, { ...contract(), version: 2 });
    await vi.waitFor(async () => expect(await job.getState()).toBe("failed"), { timeout: 10000 });
    const failed = await producer.queue.getJob(job.id!);
    expect(failed!.failedReason).toContain("Unsupported foundation job contract");
    expect(failed!.attemptsMade).toBe(1);
  });
});
