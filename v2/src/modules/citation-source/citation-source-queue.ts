import { randomUUID } from "node:crypto";
import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type pg from "pg";
import { sha256OfJson } from "../../kernel/canonical-json.js";
import {
  JobContractSchema,
  type JobContract,
} from "../../kernel/job-contract.js";
import type { RawAnswer } from "../observation/observation.js";
import { sourceSnapshotSchema } from "./citation-source.js";
import { CitationSourceRepository } from "./citation-source-repository.js";
import { CitationSourceService } from "./citation-source-service.js";
import { SafeSourceFetcher } from "./safe-source-fetcher.js";

export const CITATION_SOURCE_QUEUE = "answertravel-v2-citation-source";
const jobId = (contract: JobContract) =>
  sha256OfJson([
    contract.tenantId,
    contract.name,
    contract.version,
    contract.idempotencyKey,
  ]);
export function citationScanJob(answer: RawAnswer): JobContract {
  return JobContractSchema.parse({
    name: "citation.scan",
    version: 1,
    tenantId: answer.tenantId,
    idempotencyKey: answer.id,
    requestedAt: new Date().toISOString(),
    traceId: answer.id,
    payload: { answerId: answer.id },
  });
}
export function sourceCaptureJob(event: {
  id: string;
  tenantId: string;
  canonicalUrl: string;
}): JobContract {
  return JobContractSchema.parse({
    name: "source.capture",
    version: 1,
    tenantId: event.tenantId,
    idempotencyKey: event.id,
    requestedAt: new Date().toISOString(),
    traceId: event.id,
    payload: { eventId: event.id, canonicalUrl: event.canonicalUrl },
  });
}

export function createCitationSourceQueue(redisUrl: string) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const queue = new Queue(CITATION_SOURCE_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: false,
      removeOnFail: false,
    },
  });
  return {
    queue,
    close: async () => {
      await queue.close();
      connection.disconnect();
    },
  };
}
export async function enqueueCitationSource(
  queue: Queue,
  input: JobContract,
): Promise<Job> {
  const contract = JobContractSchema.parse(input);
  if (
    !(
      contract.version === 1 &&
      ["citation.scan", "source.capture"].includes(contract.name)
    )
  )
    throw new Error("Unsupported citation/source job contract.");
  const id = jobId(contract);
  await queue.add(contract.name, contract, { jobId: id });
  const stored = await queue.getJob(id);
  if (!stored) throw new Error("Persisted citation/source job is missing.");
  if (sha256OfJson(stored.data.payload) !== sha256OfJson(contract.payload))
    throw new Error(
      "Citation/source idempotency key belongs to different payload.",
    );
  return stored;
}

export function createCitationSourceWorker(
  redisUrl: string,
  pool: pg.Pool,
  options: {
    fetchImpl?: typeof fetch;
    lookupAddresses?: (hostname: string) => Promise<string[]>;
    allowedDomains?: string[];
  } = {},
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const producer = createCitationSourceQueue(redisUrl);
  const repository = new CitationSourceRepository(pool);
  const service = new CitationSourceService(repository);
  const fetcher = new SafeSourceFetcher(options);
  const worker = new Worker(
    CITATION_SOURCE_QUEUE,
    async (job) => {
      const parsed = JobContractSchema.safeParse(job.data);
      if (!parsed.success || parsed.data.version !== 1)
        throw new UnrecoverableError(
          "Unsupported citation/source job contract.",
        );
      const contract = parsed.data;
      if (contract.name === "citation.scan") {
        const answerId = contract.payload.answerId;
        if (typeof answerId !== "string")
          throw new UnrecoverableError("Citation scan answer is missing.");
        const scanned = await service.scanAnswer(contract.tenantId, answerId);
        for (const eventId of scanned.eventIds) {
          const event = await repository.event(contract.tenantId, eventId);
          if (event?.canonicalUrl)
            await enqueueCitationSource(
              producer.queue,
              sourceCaptureJob({
                id: event.id,
                tenantId: event.tenantId,
                canonicalUrl: event.canonicalUrl,
              }),
            );
        }
        return { ...scanned, candidateCount: scanned.eventIds.length };
      }
      if (contract.name !== "source.capture")
        throw new UnrecoverableError("Unsupported citation/source job name.");
      const eventId = contract.payload.eventId;
      if (typeof eventId !== "string")
        throw new UnrecoverableError("Source event is missing.");
      const event = await repository.event(contract.tenantId, eventId);
      if (!event?.canonicalUrl)
        throw new UnrecoverableError("Citation event is not fetchable.");
      const snapshots = await repository.snapshots(contract.tenantId, event.id);
      const successful = snapshots.find(
        (snapshot) =>
          snapshot.status === "succeeded" || snapshot.status === "blocked",
      );
      if (successful) return { snapshotId: successful.id, idempotent: true };
      const attempt = snapshots.length + 1;
      const result = await fetcher.capture(event.canonicalUrl);
      const snapshot = sourceSnapshotSchema.parse({
        id: randomUUID(),
        tenantId: event.tenantId,
        citationEventId: event.id,
        attempt,
        canonicalUrl: event.canonicalUrl,
        ...result,
        capturedAt: new Date().toISOString(),
      });
      await repository.recordSnapshot(snapshot);
      if (result.retryable && attempt < 3)
        throw new Error(result.errorCode ?? "retryable_source_failure");
      if (result.retryable)
        throw new UnrecoverableError(result.errorCode ?? "source_failure");
      return {
        snapshotId: snapshot.id,
        idempotent: false,
        status: snapshot.status,
      };
    },
    { connection, concurrency: 2 },
  );
  return {
    worker,
    close: async () => {
      await worker.close();
      await producer.close();
      connection.disconnect();
    },
  };
}
