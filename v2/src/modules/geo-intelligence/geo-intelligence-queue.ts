import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type pg from "pg";
import { sha256OfJson } from "../../kernel/canonical-json.js";
import { JobContractSchema, type JobContract } from "../../kernel/job-contract.js";
import type { RawAnswer } from "../observation/observation.js";
import { createGeoDecisionQueue, enqueueGeoDecision, geoDecisionJob } from "../geo-decision/geo-gap-decision-queue.js";
import { GeoIntelligenceRepository } from "./geo-intelligence-repository.js";
import { GeoIntelligenceService } from "./geo-intelligence-service.js";

export const GEO_INTELLIGENCE_QUEUE = "answertravel-v2-geo-intelligence";
const jobId = (contract: JobContract) => sha256OfJson([contract.tenantId, contract.name, contract.version, contract.idempotencyKey]);
export function geoAnalysisJob(answer: RawAnswer): JobContract { return JobContractSchema.parse({ name: "geo.analyze", version: 1, tenantId: answer.tenantId,
  idempotencyKey: answer.id, requestedAt: new Date().toISOString(), traceId: answer.id, payload: { answerId: answer.id } }); }
export function createGeoIntelligenceQueue(redisUrl: string) { const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const queue = new Queue(GEO_INTELLIGENCE_QUEUE, { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 500 }, removeOnComplete: false, removeOnFail: false } });
  return { queue, close: async () => { await queue.close(); connection.disconnect(); } }; }
export async function enqueueGeoAnalysis(queue: Queue, input: JobContract): Promise<Job> { const contract = JobContractSchema.parse(input);
  if (contract.name !== "geo.analyze" || contract.version !== 1) throw new Error("Unsupported GEO analysis job contract."); const id = jobId(contract);
  await queue.add(contract.name, contract, { jobId: id }); const stored = await queue.getJob(id); if (!stored) throw new Error("Persisted GEO analysis job is missing.");
  if (sha256OfJson(stored.data.payload) !== sha256OfJson(contract.payload)) throw new Error("GEO analysis idempotency key belongs to different payload."); return stored; }
export function createGeoIntelligenceWorker(redisUrl: string, pool: pg.Pool) { const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const decisionProducer = createGeoDecisionQueue(redisUrl); const service = new GeoIntelligenceService(new GeoIntelligenceRepository(pool)); const worker = new Worker(GEO_INTELLIGENCE_QUEUE, async (job) => {
    const parsed = JobContractSchema.safeParse(job.data); if (!parsed.success || parsed.data.name !== "geo.analyze" || parsed.data.version !== 1) throw new UnrecoverableError("Unsupported GEO analysis job contract.");
    const answerId = parsed.data.payload.answerId; if (typeof answerId !== "string") throw new UnrecoverableError("GEO analysis answer is missing.");
    const result = await service.analyzeAnswer(parsed.data.tenantId, answerId); await enqueueGeoDecision(decisionProducer.queue, geoDecisionJob(parsed.data.tenantId, answerId)); return result; }, { connection, concurrency: 2 });
  return { worker, close: async () => { await worker.close(); await decisionProducer.close(); connection.disconnect(); } }; }
