import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {createDailyMonitoringSchedule,planScheduledCycle} from "../../src/modules/periodic-monitoring/periodic-monitoring.js";
import {questionPanelSchema} from "../../src/modules/question-intelligence/question-intelligence.js";

const tenantId=randomUUID(),panelId=randomUUID();
const panel=questionPanelSchema.parse({id:panelId,tenantId,version:2,status:"approved",brandTruthCardId:randomUUID(),brandTruthVersion:2,generationRunId:randomUUID(),createdAt:new Date().toISOString(),
  candidates:Array.from({length:20},(_,i)=>({id:randomUUID(),text:`北京旅行测试问题${i+1}是什么？`,journeyStage:"planning",objectType:"neutral_category",panelRole:i<12?"baseline":i<17?"exploration":"trigger",intentCluster:"规划",audience:null,scenario:null,supportingFactIds:[],rationale:"测试",rawIndex:i,included:true,canonicalCandidateId:randomUUID(),exclusionReason:null})),
  mix:{requestedTotal:20,actualTotal:20,baseline:{target:12,actual:12},exploration:{target:5,actual:5},trigger:{target:3,actual:3}}});

describe("periodic monitoring contracts",()=>{
  it("creates a bounded daily schedule and exactly forty targets",()=>{const now="2026-09-14T14:00:00.000Z";const s=createDailyMonitoringSchedule({tenantId,panel,nextRunAt:now,decisionReference:"Gate A 2026-09-14",createdAt:now});const x=planScheduledCycle(s,panel,now,now);expect(s).toMatchObject({cadence:"daily",maxSamplesPerCycle:40,rules:{maxTotalTokens:60000}});expect(x.targets).toHaveLength(40);expect(x.nextRunAt).toBe("2026-09-15T14:00:00.000Z");});
  it("blocks paused schedules and changed question panels",()=>{const now="2026-09-14T14:00:00.000Z";const s=createDailyMonitoringSchedule({tenantId,panel,nextRunAt:now,decisionReference:"Gate A",createdAt:now});expect(()=>planScheduledCycle({...s,status:"paused"},panel,now,now)).toThrow("Paused");expect(()=>planScheduledCycle(s,{...panel,version:3},now,now)).toThrow("changed");});
});
