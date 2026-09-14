create table geo_diagnosis_snapshots (
  id uuid not null, tenant_id uuid not null,
  rules_version text not null check(rules_version ~ '^geo-gap-decision[.]v[0-9]+$'),
  input_sha256 text not null check(input_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check(status in ('completed','failed')),
  evidence_status text not null check(evidence_status in ('sufficient','insufficient','not_connected')),
  fact_level text not null check(fact_level in ('F2','F3')),
  sample_count integer not null check(sample_count >= 0),
  observation_plan_count integer not null check(observation_plan_count >= 0),
  brand_mention_count integer not null check(brand_mention_count >= 0),
  strongest_competitor_id text,
  strongest_competitor_mention_count integer not null check(strongest_competitor_mention_count >= 0),
  primary_root_cause text not null check(primary_root_cause in ('sampling_insufficient','brand_truth_gap','product_service_gap','website_structure_gap','content_coverage_gap','external_source_gap','reputation_risk','model_volatility','competitor_reason_unclear','no_action')),
  summary text not null,
  alternatives jsonb not null check(jsonb_typeof(alternatives)='array'),
  missing_evidence jsonb not null check(jsonb_typeof(missing_evidence)='array'),
  evidence_refs jsonb not null check(jsonb_typeof(evidence_refs)='array'),
  created_at timestamptz not null,
  primary key(tenant_id,id), unique(tenant_id,rules_version,input_sha256)
);

create table geo_action_proposals (
  id uuid not null, tenant_id uuid not null, diagnosis_id uuid not null,
  action_type text not null check(action_type in ('no_action','expand_sampling','brand_truth_update','business_improvement','website_fix','content_cluster','source_building','reputation_response','competitor_deep_dive')),
  fact_level text not null check(fact_level in ('F3','F4')),
  title text not null, rationale text not null,
  priority text not null check(priority in ('low','medium','high')),
  risk text not null check(risk in ('low','medium','high')),
  requires_approval boolean not null,
  owner_type text not null check(owner_type in ('ai','business_owner','content_owner','website_owner','brand_owner')),
  expected_window text not null, success_metric text not null,
  verification_plan jsonb not null check(jsonb_typeof(verification_plan)='object'),
  evidence_refs jsonb not null check(jsonb_typeof(evidence_refs)='array'),
  created_at timestamptz not null,
  primary key(tenant_id,id),
  foreign key(tenant_id,diagnosis_id) references geo_diagnosis_snapshots(tenant_id,id)
);

create table competitor_deep_dive_recommendations (
  id uuid not null, tenant_id uuid not null, diagnosis_id uuid not null,
  decision text not null check(decision in ('no_trigger','expand_sample','recommend_approval')),
  fact_level text not null check(fact_level in ('F3','F4')),
  reason text not null,
  proposed_sample_budget integer not null check(proposed_sample_budget >= 0),
  question_themes jsonb not null check(jsonb_typeof(question_themes)='array'),
  stop_conditions jsonb not null check(jsonb_typeof(stop_conditions)='array'),
  requires_approval boolean not null, created_at timestamptz not null,
  primary key(tenant_id,id), unique(tenant_id,diagnosis_id),
  foreign key(tenant_id,diagnosis_id) references geo_diagnosis_snapshots(tenant_id,id)
);

do $$ declare table_name text; begin
  foreach table_name in array array['geo_diagnosis_snapshots','geo_action_proposals','competitor_deep_dive_recommendations'] loop
    execute format('create trigger %I_append_only before update or delete on %I for each row execute function reject_immutable_mutation()',table_name,table_name);
    execute format('create trigger %I_no_truncate before truncate on %I for each statement execute function reject_immutable_mutation()',table_name,table_name);
    execute format('alter table %I enable row level security',table_name);
    execute format('alter table %I force row level security',table_name);
    execute format('create policy %I_tenant_isolation on %I using (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) with check (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,table_name);
  end loop;
end $$;

create index geo_diagnosis_latest_idx on geo_diagnosis_snapshots(tenant_id,created_at desc);
create index geo_action_diagnosis_idx on geo_action_proposals(tenant_id,diagnosis_id,priority);
