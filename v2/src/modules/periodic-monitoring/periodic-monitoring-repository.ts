import type pg from "pg";
import { createAuditEvent } from "../../kernel/audit-event.js";
import { appendAuditEvent } from "../../platform/audit.js";
import { withTenantTransaction } from "../../platform/database.js";
import { monitoringCycleSchema,monitoringScheduleSchema,type MonitoringCycle,type MonitoringSchedule } from "./periodic-monitoring.js";

export class PeriodicMonitoringRepository{
  constructor(private readonly pool:pg.Pool){}
  async createSchedule(raw:MonitoringSchedule):Promise<MonitoringSchedule>{const item=monitoringScheduleSchema.parse(raw);return withTenantTransaction(this.pool,item.tenantId,async c=>{
    const existing=await c.query("select * from monitoring_schedules where decision_reference=$1",[item.decisionReference]); if(existing.rows[0]) return this.mapSchedule(existing.rows[0]);
    const result=await c.query("insert into monitoring_schedules(id,tenant_id,status,cadence,timezone,question_panel_id,question_panel_version,rules,max_samples_per_cycle,next_run_at,decision_reference,created_at) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) returning *",
      [item.id,item.tenantId,item.status,item.cadence,item.timezone,item.questionPanelId,item.questionPanelVersion,JSON.stringify(item.rules),item.maxSamplesPerCycle,item.nextRunAt,item.decisionReference,item.createdAt]);
    await appendAuditEvent(c,createAuditEvent({tenantId:item.tenantId,actorType:"user",actorId:"periodic-monitoring.gate-a",traceId:item.id,action:"monitoring_schedule.approved",resourceType:"monitoring_schedule",resourceId:item.id,detail:{cadence:item.cadence,maxSamplesPerCycle:item.maxSamplesPerCycle,maxTotalTokens:item.rules.maxTotalTokens,decisionReference:item.decisionReference}})); return this.mapSchedule(result.rows[0]);});}
  async saveCycle(raw:MonitoringCycle,nextRunAt:string):Promise<MonitoringCycle>{const item=monitoringCycleSchema.parse(raw);return withTenantTransaction(this.pool,item.tenantId,async c=>{
    const existing=await c.query("select * from monitoring_cycles where schedule_id=$1 and scheduled_for=$2",[item.scheduleId,item.scheduledFor]); if(existing.rows[0]) return this.mapCycle(existing.rows[0]);
    const result=await c.query("insert into monitoring_cycles(id,tenant_id,schedule_id,observation_plan_id,cycle_key,scheduled_for,status,scope_sha256,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *",[item.id,item.tenantId,item.scheduleId,item.observationPlanId,item.cycleKey,item.scheduledFor,item.status,item.scopeSha256,item.createdAt]);
    await c.query("update monitoring_schedules set next_run_at=$1 where id=$2 and status='active'",[nextRunAt,item.scheduleId]);
    await appendAuditEvent(c,createAuditEvent({tenantId:item.tenantId,actorType:"worker",actorId:"periodic-monitoring.v1",traceId:item.id,action:"monitoring_cycle.planned",resourceType:"monitoring_cycle",resourceId:item.id,detail:{cycleKey:item.cycleKey,observationPlanId:item.observationPlanId,scheduledFor:item.scheduledFor}})); return this.mapCycle(result.rows[0]);});}
  async latestSchedule(tenantId:string):Promise<MonitoringSchedule|null>{return withTenantTransaction(this.pool,tenantId,async c=>{const r=await c.query("select * from monitoring_schedules order by created_at desc limit 1");return r.rows[0]?this.mapSchedule(r.rows[0]):null;});}
  async cycles(tenantId:string):Promise<MonitoringCycle[]>{return withTenantTransaction(this.pool,tenantId,async c=>(await c.query("select * from monitoring_cycles order by scheduled_for desc")).rows.map(x=>this.mapCycle(x)));}
  private mapSchedule(x:any):MonitoringSchedule{return monitoringScheduleSchema.parse({id:x.id,tenantId:x.tenant_id,status:x.status,cadence:x.cadence,timezone:x.timezone,questionPanelId:x.question_panel_id,questionPanelVersion:x.question_panel_version,rules:x.rules,maxSamplesPerCycle:x.max_samples_per_cycle,nextRunAt:x.next_run_at.toISOString(),decisionReference:x.decision_reference,createdAt:x.created_at.toISOString()});}
  private mapCycle(x:any):MonitoringCycle{return monitoringCycleSchema.parse({id:x.id,tenantId:x.tenant_id,scheduleId:x.schedule_id,observationPlanId:x.observation_plan_id,cycleKey:x.cycle_key,scheduledFor:x.scheduled_for.toISOString(),status:x.status,scopeSha256:x.scope_sha256,createdAt:x.created_at.toISOString()});}
}
