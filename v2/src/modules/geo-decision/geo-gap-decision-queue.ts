import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type pg from "pg";
import { sha256OfJson } from "../../kernel/canonical-json.js";
import { JobContractSchema, type JobContract } from "../../kernel/job-contract.js";
import { GeoGapDecisionRepository } from "./geo-gap-decision-repository.js";
import { GeoGapDecisionService } from "./geo-gap-decision-service.js";

export const GEO_DECISION_QUEUE = "answertravel-v2-geo-decisions";
const jobId = (contract: JobContract) => sha256OfJson([contract.tenantId,contract.name,contract.version,contract.idempotencyKey]);
export function geoDecisionJob(tenantId:string, triggerId:string):JobContract { return JobContractSchema.parse({ name:"geo-decision.evaluate",version:1,tenantId,idempotencyKey:triggerId,requestedAt:new Date().toISOString(),traceId:triggerId,payload:{} }); }
export function createGeoDecisionQueue(redisUrl:string){const connection=new Redis(redisUrl,{maxRetriesPerRequest:1});const queue=new Queue(GEO_DECISION_QUEUE,{connection,defaultJobOptions:{attempts:3,backoff:{type:"exponential",delay:500},removeOnComplete:false,removeOnFail:false}});return{queue,close:async()=>{await queue.close();connection.disconnect();}};}
export async function enqueueGeoDecision(queue:Queue,input:JobContract):Promise<Job>{const contract=JobContractSchema.parse(input);if(contract.name!=="geo-decision.evaluate"||contract.version!==1)throw new Error("Unsupported GEO decision job contract.");const id=jobId(contract);await queue.add(contract.name,contract,{jobId:id});const stored=await queue.getJob(id);if(!stored)throw new Error("Persisted GEO decision job is missing.");return stored;}
export function createGeoDecisionWorker(redisUrl:string,pool:pg.Pool){const connection=new Redis(redisUrl,{maxRetriesPerRequest:null});const service=new GeoGapDecisionService(new GeoGapDecisionRepository(pool));const worker=new Worker(GEO_DECISION_QUEUE,async job=>{const parsed=JobContractSchema.safeParse(job.data);if(!parsed.success||parsed.data.name!=="geo-decision.evaluate"||parsed.data.version!==1)throw new UnrecoverableError("Unsupported GEO decision job contract.");return service.evaluate(parsed.data.tenantId);},{connection,concurrency:1});return{worker,close:async()=>{await worker.close();connection.disconnect();}};}
