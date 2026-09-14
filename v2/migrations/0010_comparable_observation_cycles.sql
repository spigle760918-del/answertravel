create table sampling_expansion_authorizations (
  id uuid not null, tenant_id uuid not null,
  decision_reference text not null,
  status text not null check(status='approved'),
  allowed_object_type text not null check(allowed_object_type='neutral_category'),
  max_new_samples integer not null check(max_new_samples between 1 and 20),
  max_total_tokens integer not null check(max_total_tokens > 0),
  scope_sha256 text not null check(scope_sha256 ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz not null,
  primary key(tenant_id,id), unique(tenant_id,scope_sha256)
);

alter table observation_plans add column cycle_key text not null default 'baseline';
alter table observation_plans add column authorization_id uuid;
alter table observation_plans add foreign key(tenant_id,authorization_id)
  references sampling_expansion_authorizations(tenant_id,id);
create unique index observation_plan_cycle_unique
  on observation_plans(tenant_id,question_panel_id,question_panel_version,cycle_key);

create table comparable_observation_snapshots (
  id uuid not null, tenant_id uuid not null, authorization_id uuid not null,
  baseline_plan_id uuid not null, comparison_plan_id uuid not null,
  rules_version text not null check(rules_version='comparable-observation.v1'),
  input_sha256 text not null check(input_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check(status in('comparable','not_comparable','insufficient')),
  differences jsonb not null check(jsonb_typeof(differences)='array'),
  valid_answer_count integer not null check(valid_answer_count >= 0),
  observation_plan_count integer not null check(observation_plan_count >= 0),
  diagnosis_id uuid,
  created_at timestamptz not null,
  primary key(tenant_id,id), unique(tenant_id,input_sha256),
  foreign key(tenant_id,authorization_id) references sampling_expansion_authorizations(tenant_id,id),
  foreign key(tenant_id,baseline_plan_id) references observation_plans(tenant_id,id),
  foreign key(tenant_id,comparison_plan_id) references observation_plans(tenant_id,id),
  foreign key(tenant_id,diagnosis_id) references geo_diagnosis_snapshots(tenant_id,id)
);

do $$ declare table_name text; begin
  foreach table_name in array array['sampling_expansion_authorizations','comparable_observation_snapshots'] loop
    execute format('create trigger %I_append_only before update or delete on %I for each row execute function reject_immutable_mutation()',table_name,table_name);
    execute format('create trigger %I_no_truncate before truncate on %I for each statement execute function reject_immutable_mutation()',table_name,table_name);
    execute format('alter table %I enable row level security',table_name);
    execute format('alter table %I force row level security',table_name);
    execute format('create policy %I_tenant_isolation on %I using (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) with check (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,table_name);
  end loop;
end $$;

create index comparable_observation_latest_idx on comparable_observation_snapshots(tenant_id,created_at desc);
