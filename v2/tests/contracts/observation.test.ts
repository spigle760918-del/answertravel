import {randomUUID} from "node:crypto";import {describe,expect,it} from "vitest";import {createObservationPlan} from "../../src/modules/observation/observation.js";
import {questionPanelSchema} from "../../src/modules/question-intelligence/question-intelligence.js";
const tenantId="22222222-2222-4222-8222-222222222222";const questionId="33333333-3333-4333-8333-333333333333";
const panel=(status:"draft"|"approved"="approved")=>questionPanelSchema.parse({id:"11111111-1111-4111-8111-111111111111",tenantId,version:2,status,
 brandTruthCardId:"44444444-4444-4444-8444-444444444444",brandTruthVersion:2,generationRunId:"55555555-5555-4555-8555-555555555555",createdAt:"2026-09-14T00:00:00.000Z",
 candidates:[{id:questionId,text:"云南亲子游怎么规划？",journeyStage:"planning",objectType:"neutral_category",panelRole:"baseline",intentCluster:"规划",audience:"亲子家庭",scenario:"云南",supportingFactIds:[],rationale:"基准",rawIndex:0,included:true,canonicalCandidateId:questionId,exclusionReason:null}],
 mix:{requestedTotal:1,actualTotal:1,baseline:{target:1,actual:1},exploration:{target:0,actual:0},trigger:{target:0,actual:0}}});
const rules={version:"deepseek-sampling.v1" as const,rounds:3,language:"简体中文",regionContext:"中国大陆",temperature:0.2,maxTokens:1000,timeoutMs:30000,maxAttempts:3,maxTotalTokens:10000};
describe("observation contracts",()=>{
 it("creates deterministic question-by-round targets for an approved panel",()=>{const first=createObservationPlan({id:randomUUID(),panel:panel(),rules,createdAt:new Date().toISOString()});
  const second=createObservationPlan({id:randomUUID(),panel:panel(),rules,createdAt:new Date().toISOString()});expect(first.plan).toMatchObject({provider:"deepseek",surface:"api",plannedSamples:3});
  expect(first.targets.map(x=>x.idempotencyKey)).toEqual(second.targets.map(x=>x.idempotencyKey));expect(first.targets.map(x=>x.round)).toEqual([1,2,3]);});
 it("refuses a draft panel",()=>expect(()=>createObservationPlan({id:randomUUID(),panel:panel("draft"),rules,createdAt:new Date().toISOString()})).toThrow("approved"));
});
