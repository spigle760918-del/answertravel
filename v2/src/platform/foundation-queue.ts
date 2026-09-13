import { Queue, Worker, UnrecoverableError, type Job } from "bullmq";
import { Redis } from "ioredis";
import type pg from "pg";
import { JobContractSchema, type JobContract } from "../kernel/job-contract.js";
import { sha256OfJson } from "../kernel/canonical-json.js";
import { createEvidenceEnvelope } from "../kernel/evidence-envelope.js";
import { EvidenceRepository } from "../modules/evidence/evidence-repository.js";

export const FOUNDATION_QUEUE = "answertravel-v2-foundation";
export type QueueLog = (event: Record<string, unknown>) => void;
const defaultLog: QueueLog = (event) => console.log(JSON.stringify(event));

export function foundationJobId(job: JobContract): string {
  return sha256OfJson([job.tenantId, job.name, job.version, job.idempotencyKey]);
}

export function createFoundationQueue(redisUrl: string): { queue: Queue; close: () => Promise<void> } {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  connection.on("error", () => defaultLog({ event: "queue.connection_error" }));
  const queue = new Queue(FOUNDATION_QUEUE, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 250 }, removeOnComplete: false, removeOnFail: false }
  });
  queue.on("error", () => defaultLog({ event: "queue.error" }));
  return { queue, close: async () => { await queue.close(); connection.disconnect(); } };
}

export async function enqueueFoundationJob(queue: Queue, input: JobContract): Promise<Job> {
  const contract = JobContractSchema.parse(input);
  const jobId = foundationJobId(contract);
  await queue.add(contract.name, contract, { jobId });
  const stored = await queue.getJob(jobId);
  if (!stored) throw new Error("Persisted job is missing after enqueue.");
  // Concurrent callers using one key for different inputs must see a conflict.
  const storedContract = JobContractSchema.parse(stored.data);
  if (sha256OfJson(storedContract.payload) !== sha256OfJson(contract.payload)) {
    throw new Error("Idempotency key already belongs to a different payload.");
  }
  return stored;
}

export function createFoundationWorker(redisUrl: string, pool: pg.Pool, log: QueueLog = defaultLog) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, connectTimeout: 2000 });
  connection.on("error", () => log({ event: "worker.connection_error" }));
  const repository = new EvidenceRepository(pool);
  const worker = new Worker(FOUNDATION_QUEUE, async (job) => {
    const parsed = JobContractSchema.safeParse(job.data);
    if (!parsed.success || parsed.data.name !== "foundation.probe" || parsed.data.version !== 1) {
      throw new UnrecoverableError("Unsupported foundation job contract.");
    }
    const contract = parsed.data;
    const started = performance.now();
    const evidence = await repository.append(createEvidenceEnvelope({
      tenantId: contract.tenantId, artifactType: "foundation.probe", factLevel: "F1", schemaVersion: 1,
      source: { system: "foundation-worker.v1", reference: `queue://${FOUNDATION_QUEUE}/${job.id}`,
        capturedAt: contract.requestedAt, surface: "internal" },
      payload: contract.payload
    }), { actorType: "worker", actorId: "foundation-worker.v1", traceId: contract.traceId });
    log({ event: "job.completed", jobId: job.id, traceId: contract.traceId,
      evidenceId: evidence.id, durationMs: Math.round(performance.now() - started) });
    return { evidenceId: evidence.id, traceId: contract.traceId };
  }, { connection, concurrency: 2 });
  worker.on("failed", (job) => log({ event: "job.failed", jobId: job?.id, attemptsMade: job?.attemptsMade }));
  worker.on("error", () => log({ event: "worker.error" }));
  return { worker, close: async () => { await worker.close(); connection.disconnect(); } };
}
