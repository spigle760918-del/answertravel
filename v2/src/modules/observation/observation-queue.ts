import {randomUUID} from "node:crypto";import {Queue,Worker,UnrecoverableError,type Job} from "bullmq";import {Redis} from "ioredis";import type pg from "pg";
import {JobContractSchema,type JobContract} from "../../kernel/job-contract.js";import {sha256OfJson} from "../../kernel/canonical-json.js";
import {DeepSeekAnswerClient,DeepSeekAnswerError} from "./deepseek-answer-client.js";import {observationAttemptSchema,rawAnswerSchema,type ObservationTarget} from "./observation.js";import {ObservationRepository} from "./observation-repository.js";
export const OBSERVATION_QUEUE="answertravel-v2-observations";
export function observationJob(target:ObservationTarget):JobContract{return JobContractSchema.parse({name:"observation.capture",version:1,tenantId:target.tenantId,
 idempotencyKey:target.idempotencyKey,requestedAt:new Date().toISOString(),traceId:target.id,payload:{targetId:target.id,planId:target.planId}});}
const jobId=(c:JobContract)=>sha256OfJson([c.tenantId,c.name,c.version,c.idempotencyKey]);
export function createObservationQueue(redisUrl:string){const connection=new Redis(redisUrl,{maxRetriesPerRequest:1});const queue=new Queue(OBSERVATION_QUEUE,{connection,
 defaultJobOptions:{attempts:10,backoff:{type:"exponential",delay:500},removeOnComplete:false,removeOnFail:false}});return{queue,close:async()=>{await queue.close();connection.disconnect();}};}
export async function enqueueObservation(queue:Queue,input:JobContract):Promise<Job>{const c=JobContractSchema.parse(input);if(c.name!=="observation.capture"||c.version!==1)throw new Error("Unsupported observation job contract.");
 await queue.add(c.name,c,{jobId:jobId(c)});const stored=await queue.getJob(jobId(c));if(!stored)throw new Error("Persisted observation job is missing.");
 if(sha256OfJson(stored.data.payload)!==sha256OfJson(c.payload))throw new Error("Observation idempotency key belongs to different payload.");return stored;}
export function createObservationWorker(redisUrl:string,pool:pg.Pool,apiKey:string,fetchImpl?:typeof fetch){const connection=new Redis(redisUrl,{maxRetriesPerRequest:null});
 const repository=new ObservationRepository(pool);const client=new DeepSeekAnswerClient({apiKey,...(fetchImpl?{fetchImpl}:{})});const worker=new Worker(OBSERVATION_QUEUE,async job=>{
  const c=JobContractSchema.safeParse(job.data);if(!c.success||c.data.name!=="observation.capture"||c.data.version!==1)throw new UnrecoverableError("Unsupported observation job contract.");
  const targetId=c.data.payload.targetId;if(typeof targetId!=="string")throw new UnrecoverableError("Observation target is missing.");
  const item=await repository.workItem(c.data.tenantId,targetId);if(!item)throw new UnrecoverableError("Observation target not found.");
  const existing=await repository.answer(item.target.tenantId,item.target.id);if(existing)return{answerId:existing.id,idempotent:true};
  const attempt=job.attemptsMade+1;const startedAt=new Date().toISOString();const used=await repository.usedTokens(item.target.tenantId,item.plan.id);
  if(used>=item.plan.rules.maxTotalTokens){await repository.recordAttempt(observationAttemptSchema.parse({id:randomUUID(),tenantId:item.target.tenantId,targetId:item.target.id,attempt,
   status:"budget_stopped",request:{},response:null,errorCode:"budget_exhausted",httpStatus:null,promptTokens:0,completionTokens:0,totalTokens:0,startedAt,completedAt:new Date().toISOString()}));
   throw new UnrecoverableError("Observation budget exhausted.");}
  try{const result=await client.capture(item.target.questionText,item.target.context,{model:item.plan.model,temperature:item.plan.rules.temperature,maxTokens:item.plan.rules.maxTokens,timeoutMs:item.plan.rules.timeoutMs});
   const attemptId=randomUUID();const capturedAt=new Date().toISOString();const answer=rawAnswerSchema.parse({id:randomUUID(),tenantId:item.target.tenantId,targetId:item.target.id,attemptId,
    answerText:result.answerText,providerResponseId:result.responseId,model:result.model,surface:"api",finishReason:result.finishReason,payloadSha256:result.payloadSha256,capturedAt});
   await repository.recordAttempt(observationAttemptSchema.parse({id:attemptId,tenantId:item.target.tenantId,targetId:item.target.id,attempt,status:"succeeded",request:result.request,
    response:result.response,errorCode:null,httpStatus:200,promptTokens:result.promptTokens,completionTokens:result.completionTokens,totalTokens:result.totalTokens,startedAt,completedAt:capturedAt}),answer);
   return{answerId:answer.id,idempotent:false};
  }catch(error){if(!(error instanceof DeepSeekAnswerError))throw error;await repository.recordAttempt(observationAttemptSchema.parse({id:randomUUID(),tenantId:item.target.tenantId,targetId:item.target.id,attempt,
    status:error.retryable?"retryable_failure":"terminal_failure",request:error.request,response:error.response,errorCode:error.code,httpStatus:error.httpStatus,
    promptTokens:0,completionTokens:0,totalTokens:0,startedAt,completedAt:new Date().toISOString()}));if(error.retryable&&attempt<item.plan.rules.maxAttempts)throw error;
   throw new UnrecoverableError(error.message);}
 },{connection,concurrency:1});return{worker,close:async()=>{await worker.close();connection.disconnect();}};}
