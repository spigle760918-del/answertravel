create table action_fact_intake_snapshots(
  id uuid not null,
  tenant_id uuid not null,
  rules_version text not null check(rules_version='action-fact-intake.v1'),
  action_plan_id uuid not null,
  action_package_id uuid not null,
  action_package_key text not null,
  action_package_title text not null,
  input_sha256 char(64) not null,
  status text not null check(status='waiting_facts'),
  fact_level text not null check(fact_level='F4'),
  personalization_mode text not null check(personalization_mode='diagnosis_driven'),
  source_finding_count integer not null check(source_finding_count>0),
  core_envelope_fields jsonb not null check(jsonb_typeof(core_envelope_fields)='array'),
  focus_count integer not null check(focus_count>0),
  focus_areas jsonb not null check(jsonb_typeof(focus_areas)='array'),
  response_options jsonb not null check(jsonb_typeof(response_options)='array'),
  acceptance_criteria jsonb not null check(jsonb_typeof(acceptance_criteria)='array'),
  completeness_rules jsonb not null check(jsonb_typeof(completeness_rules)='array'),
  missing_inputs jsonb not null check(jsonb_typeof(missing_inputs)='array'),
  fact_draft_authorized boolean not null check(fact_draft_authorized=false),
  publication_authorized boolean not null check(publication_authorized=false),
  created_at timestamptz not null,
  primary key(tenant_id,id),
  unique(tenant_id,input_sha256),
  foreign key(tenant_id,action_plan_id) references optimization_action_plan_snapshots(tenant_id,id)
);
create trigger action_fact_intake_snapshots_append_only before update or delete on action_fact_intake_snapshots for each row execute function reject_immutable_mutation();
create trigger action_fact_intake_snapshots_no_truncate before truncate on action_fact_intake_snapshots for each statement execute function reject_immutable_mutation();
alter table action_fact_intake_snapshots enable row level security;
alter table action_fact_intake_snapshots force row level security;
create policy action_fact_intake_snapshots_tenant_isolation on action_fact_intake_snapshots using(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) with check(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
