create table monitoring_schedules(
  id uuid not null, tenant_id uuid not null, status text not null check(status in('active','paused')), cadence text not null check(cadence='daily'), timezone text not null check(timezone='Asia/Shanghai'),
  question_panel_id uuid not null, question_panel_version integer not null, rules jsonb not null check(jsonb_typeof(rules)='object'), max_samples_per_cycle integer not null check(max_samples_per_cycle between 1 and 100),
  next_run_at timestamptz not null, decision_reference text not null, created_at timestamptz not null, primary key(tenant_id,id), unique(tenant_id,decision_reference),
  foreign key(tenant_id,question_panel_id,question_panel_version) references question_panels(tenant_id,id,version)
);
create table monitoring_cycles(
  id uuid not null, tenant_id uuid not null, schedule_id uuid not null, observation_plan_id uuid not null, cycle_key text not null, scheduled_for timestamptz not null,
  status text not null check(status='planned'), scope_sha256 char(64) not null, created_at timestamptz not null, primary key(tenant_id,id), unique(tenant_id,schedule_id,scheduled_for), unique(tenant_id,scope_sha256),
  foreign key(tenant_id,schedule_id) references monitoring_schedules(tenant_id,id), foreign key(tenant_id,observation_plan_id) references observation_plans(tenant_id,id)
);
create trigger monitoring_cycles_append_only before update or delete on monitoring_cycles for each row execute function reject_immutable_mutation();
alter table monitoring_schedules enable row level security; alter table monitoring_schedules force row level security;
alter table monitoring_cycles enable row level security; alter table monitoring_cycles force row level security;
create policy monitoring_schedules_tenant_isolation on monitoring_schedules using(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) with check(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
create policy monitoring_cycles_tenant_isolation on monitoring_cycles using(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) with check(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
create index monitoring_schedules_due_idx on monitoring_schedules(status,next_run_at);
