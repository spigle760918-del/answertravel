import { describe, expect, it } from "vitest";
import { aiVisibilitySchema, competitorAnalysisSchema, competitorScopeSchema, observationPlanSummarySchema, productOverviewSchema, questionInsightSchema, questionPanelDetailSchema, questionPerformanceSchema, rawAnswerDetailSchema, sourceAnalysisSchema, workspaceSchema } from "../../contracts/product-read.js";

describe("product read contracts", () => {
  it("requires tenant-scoped workspace permissions", () => {
    const workspace = workspaceSchema.parse({ tenantId:"00000000-0000-4000-8000-000000000001",brandName:"品牌甲",environment:"test",permissions:{viewQuestions:true,viewObservations:true,viewEvidence:true} });
    expect(workspace.permissions.viewQuestions).toBe(true);
    expect(() => workspaceSchema.parse({ ...workspace, permissions:{...workspace.permissions,viewQuestions:false} })).toThrow();
  });
  it("keeps overview counts and next step explicit", () => {
    const overview = productOverviewSchema.parse({ questionPanel:null,latestPlan:null,totals:{plans:0,plannedSamples:0,succeeded:0,failed:0,usedTokens:0},nextStep:"approve_questions" });
    expect(overview.nextStep).toBe("approve_questions");
  });
  it("does not allow a read answer to omit its immutable payload hash", () => {
    expect(() => rawAnswerDetailSchema.parse({ id:"00000000-0000-4000-8000-000000000001",planId:"00000000-0000-4000-8000-000000000002",targetId:"00000000-0000-4000-8000-000000000003",question:"问题",round:1,answerText:"回答",provider:"deepseek",model:"deepseek-chat",surface:"api",finishReason:"stop",providerResponseId:"response",payloadSha256:"bad",capturedAt:new Date().toISOString(),tokens:{prompt:1,completion:1,total:2},attempt:{number:1,status:"succeeded",httpStatus:200,completedAt:new Date().toISOString()},evidence:{citationStatus:"pending",citationCandidateCount:0,geoAnalysisStatus:"pending"} })).toThrow();
  });
  it("keeps list schemas independent from mutable UI state", () => {
    const plan = observationPlanSummarySchema.parse({ id:"00000000-0000-4000-8000-000000000001",questionPanelId:"00000000-0000-4000-8000-000000000002",questionPanelVersion:1,provider:"deepseek",model:"deepseek-chat",surface:"api",cycleKey:null,authorized:false,plannedSamples:1,succeeded:0,failed:1,budgetStopped:0,usedTokens:0,createdAt:new Date().toISOString() });
    expect(plan.failed).toBe(1);
    expect(() => questionPanelDetailSchema.parse({ ...plan })).toThrow();
  });
  it("keeps question insight evidence gaps explicit instead of inventing analysis", () => {
    const insight=questionInsightSchema.parse({context:null,questions:[],selectedQuestionId:null,answers:[],entities:[],sources:{structuredCitations:0,inlineLinks:0,sourceListItems:0,absorptionCandidates:0,snapshots:0,successfulSnapshots:0},decision:null});
    expect(insight.entities).toEqual([]);
    expect(insight.decision).toBeNull();
    expect(() => questionInsightSchema.parse({...insight,decision:{scope:"question",rulesVersion:"x",factLevel:"F4",evidenceStatus:"insufficient",summary:"临时结论",rootCause:"content_coverage_gap",sampleCount:0,missingEvidence:[],actions:[]}})).toThrow();
  });
  it("keeps question performance as evidence counts instead of an invented opportunity score", () => {
    const performance=questionPerformanceSchema.parse({context:null,items:[{id:"00000000-0000-4000-8000-000000000001",text:"游客提问",objectType:"neutral_category",journeyStage:"planning",audience:null,scenario:null,plannedSamples:1,effectiveAnswers:1,failedSamples:0,geoAnalyzedAnswers:0,brandMentionAnswers:0,competitorMentionAnswers:0,citationCandidates:0,sourceSnapshots:0}]});
    expect(performance.items[0]).not.toHaveProperty("opportunityScore");
    expect(performance.items[0]?.effectiveAnswers).toBe(1);
  });
  it("keeps AI visibility scoped to tourist questions without a composite score",()=>{
    const value=aiVisibilitySchema.parse({context:null,brand:null,items:[{id:"00000000-0000-4000-8000-000000000001",text:"游客提问",objectType:"neutral_category",journeyStage:"planning",audience:null,plannedSamples:1,effectiveAnswers:1,failedSamples:0,analyzedAnswers:1,mentionedAnswers:0,certainMentions:0,claimCount:0,positiveClaims:0,negativeClaims:0,applicableRanks:[]}]});
    expect(value.items[0]).not.toHaveProperty("visibilityScore");
    expect(value.items[0]?.applicableRanks).toEqual([]);
  });
  it("separates source candidates, structured citations, and snapshots",()=>{
    const value=sourceAnalysisSchema.parse({context:null,items:[{id:"00000000-0000-4000-8000-000000000001",text:"游客提问",objectType:"neutral_category",journeyStage:"planning",effectiveAnswers:1,failedSamples:0,scannedAnswers:1,inlineLinks:1,sourceListItems:0,structuredCitations:0,absorptionCandidates:0,successfulSnapshots:0,blockedSnapshots:1,failedSnapshots:0}],evidence:[]});
    expect(value.items[0]).toMatchObject({inlineLinks:1,structuredCitations:0,blockedSnapshots:1});
  });
  it("keeps competitor scope versioned and honest when no scope exists",()=>{
    const value=competitorScopeSchema.parse({status:"not_established",current:null,versions:[],entities:[]});
    expect(value.status).toBe("not_established");
    expect(value).not.toHaveProperty("marketShare");
  });
  it("keeps competitor analysis question-scoped without invented market scores",()=>{
    const value=competitorAnalysisSchema.parse({context:null,scope:null,items:[{id:"00000000-0000-4000-8000-000000000001",text:"游客提问",objectType:"neutral_category",journeyStage:"planning",comparability:"not_comparable",reason:"未建立已批准竞争范围",brand:{name:"品牌甲",analyzedAnswers:0,mentionedAnswers:0,certainMentions:0,applicableRanks:[]},competitors:[]}]});
    expect(value.items[0]).not.toHaveProperty("marketShare");
    expect(value.items[0]).not.toHaveProperty("competitiveScore");
  });
});
