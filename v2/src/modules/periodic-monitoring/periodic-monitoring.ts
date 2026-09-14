import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createObservationPlan, samplingRulesSchema, type ObservationPlan, type ObservationTarget } from "../observation/observation.js";
import { questionPanelSchema, type QuestionPanel } from "../question-intelligence/question-intelligence.js";

export const monitoringScheduleSchema = z.object({
  id:z.string().uuid(), tenantId:z.string().uuid(), status:z.enum(["active","paused"]), cadence:z.literal("daily"), timezone:z.literal("Asia/Shanghai"),
  questionPanelId:z.string().uuid(), questionPanelVersion:z.number().int().positive(), rules:samplingRulesSchema,
  maxSamplesPerCycle:z.number().int().min(1).max(100), nextRunAt:z.string().datetime({offset:true}), decisionReference:z.string().trim().min(1).max(500), createdAt:z.string().datetime({offset:true}),
});
export const monitoringCycleSchema = z.object({
  id:z.string().uuid(), tenantId:z.string().uuid(), scheduleId:z.string().uuid(), observationPlanId:z.string().uuid(), cycleKey:z.string().min(1).max(120),
  scheduledFor:z.string().datetime({offset:true}), status:z.literal("planned"), scopeSha256:z.string().regex(/^[a-f0-9]{64}$/), createdAt:z.string().datetime({offset:true}),
});
export type MonitoringSchedule=z.infer<typeof monitoringScheduleSchema>;
export type MonitoringCycle=z.infer<typeof monitoringCycleSchema>;

export function createDailyMonitoringSchedule(input:{id?:string;tenantId:string;panel:QuestionPanel;nextRunAt:string;decisionReference:string;createdAt:string}):MonitoringSchedule{
  const panel=questionPanelSchema.parse(input.panel); if(panel.status!=="approved") throw new Error("Periodic monitoring requires an approved question panel.");
  const included=panel.candidates.filter((item)=>item.included).length; if(included!==20) throw new Error("Periodic monitoring V1 requires the approved twenty-question panel.");
  return monitoringScheduleSchema.parse({id:input.id??randomUUID(),tenantId:input.tenantId,status:"active",cadence:"daily",timezone:"Asia/Shanghai",questionPanelId:panel.id,questionPanelVersion:panel.version,
    rules:{version:"deepseek-sampling.v1",rounds:2,language:"简体中文",regionContext:"中国大陆游客计划北京旅行",temperature:0.2,maxTokens:1000,timeoutMs:60000,maxAttempts:3,maxTotalTokens:60000},
    maxSamplesPerCycle:40,nextRunAt:input.nextRunAt,decisionReference:input.decisionReference,createdAt:input.createdAt});
}

export function planScheduledCycle(scheduleInput:MonitoringSchedule,panelInput:QuestionPanel,scheduledFor:string,createdAt:string):{cycle:MonitoringCycle;plan:ObservationPlan;targets:ObservationTarget[];nextRunAt:string}{
  const schedule=monitoringScheduleSchema.parse(scheduleInput), panel=questionPanelSchema.parse(panelInput);
  if(schedule.status!=="active") throw new Error("Paused monitoring schedules cannot produce cycles.");
  if(panel.id!==schedule.questionPanelId||panel.version!==schedule.questionPanelVersion||panel.tenantId!==schedule.tenantId) throw new Error("Monitoring schedule question panel changed; trend comparison is blocked.");
  const instant=new Date(scheduledFor); if(!Number.isFinite(instant.getTime())) throw new Error("Invalid scheduled time.");
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:schedule.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(instant);
  const cycleKey=`daily-${date}`; const planId=randomUUID();
  const observation=createObservationPlan({id:planId,panel,rules:schedule.rules,cycleKey,createdAt});
  if(observation.targets.length!==schedule.maxSamplesPerCycle) throw new Error("Scheduled cycle exceeds its approved sample scope.");
  const scopeSha256=createHash("sha256").update(JSON.stringify({scheduleId:schedule.id,scheduledFor,cycleKey,panelId:panel.id,panelVersion:panel.version,rules:schedule.rules})).digest("hex");
  return {cycle:monitoringCycleSchema.parse({id:randomUUID(),tenantId:schedule.tenantId,scheduleId:schedule.id,observationPlanId:planId,cycleKey,scheduledFor,status:"planned",scopeSha256,createdAt}),
    plan:observation.plan,targets:observation.targets,nextRunAt:new Date(instant.getTime()+86400000).toISOString()};
}
