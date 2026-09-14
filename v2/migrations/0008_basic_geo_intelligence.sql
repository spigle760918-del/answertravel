create table geo_entity_sets (
  id uuid not null, tenant_id uuid not null, version integer not null check(version > 0), status text not null check(status in ('draft','approved')),
  brand jsonb not null check(jsonb_typeof(brand) = 'object'), competitors jsonb not null check(jsonb_typeof(competitors) = 'array'),
  created_at timestamptz not null, primary key(tenant_id,id,version)
);
create table geo_analysis_runs (
  id uuid not null, tenant_id uuid not null, answer_id uuid not null, entity_set_id uuid not null, entity_set_version integer not null,
  rules_version text not null check(rules_version ~ '^basic-geo[.]v[0-9]+$'), status text not null check(status in ('completed','failed')),
  question_object_type text not null, error_code text, analyzed_at timestamptz not null, primary key(tenant_id,id),
  unique(tenant_id,answer_id,entity_set_id,entity_set_version,rules_version),
  foreign key(tenant_id,answer_id) references raw_answers(tenant_id,id),
  foreign key(tenant_id,entity_set_id,entity_set_version) references geo_entity_sets(tenant_id,id,version)
);
create table geo_entity_mentions (
  id uuid not null, tenant_id uuid not null, run_id uuid not null, answer_id uuid not null, entity_id text not null,
  entity_role text not null check(entity_role in ('brand','competitor')), matched_alias text not null, start_offset integer not null check(start_offset >= 0),
  end_offset integer not null check(end_offset > start_offset), excerpt text not null, certainty text not null check(certainty in ('certain','ambiguous')),
  created_at timestamptz not null, primary key(tenant_id,id), foreign key(tenant_id,run_id) references geo_analysis_runs(tenant_id,id),
  foreign key(tenant_id,answer_id) references raw_answers(tenant_id,id)
);
create table geo_ranking_facts (
  id uuid not null, tenant_id uuid not null, run_id uuid not null, entity_id text not null,
  applicability text not null check(applicability in ('applicable','not_applicable','uncertain')), rank integer check(rank > 0),
  reason text not null, evidence_excerpt text, created_at timestamptz not null, primary key(tenant_id,id),
  foreign key(tenant_id,run_id) references geo_analysis_runs(tenant_id,id),
  check((applicability='applicable' and rank is not null and evidence_excerpt is not null) or (applicability<>'applicable' and rank is null))
);
create table geo_claim_facts (
  id uuid not null, tenant_id uuid not null, run_id uuid not null, entity_id text not null, claim_text text not null,
  sentiment text not null check(sentiment in ('positive','negative','neutral','mixed','uncertain')),
  certainty text not null check(certainty in ('certain','uncertain')), evidence_excerpt text not null, created_at timestamptz not null,
  primary key(tenant_id,id), foreign key(tenant_id,run_id) references geo_analysis_runs(tenant_id,id)
);

do $$ declare table_name text; begin
  foreach table_name in array array['geo_entity_sets','geo_analysis_runs','geo_entity_mentions','geo_ranking_facts','geo_claim_facts'] loop
    execute format('create trigger %I_append_only before update or delete on %I for each row execute function reject_immutable_mutation()',table_name,table_name);
    execute format('create trigger %I_no_truncate before truncate on %I for each statement execute function reject_immutable_mutation()',table_name,table_name);
    execute format('alter table %I enable row level security',table_name); execute format('alter table %I force row level security',table_name);
    execute format('create policy %I_tenant_isolation on %I using (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) with check (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,table_name);
  end loop;
end $$;
create index geo_analysis_answer_idx on geo_analysis_runs(tenant_id,answer_id,analyzed_at desc);
create index geo_mentions_run_idx on geo_entity_mentions(tenant_id,run_id,entity_role);
create index geo_claims_run_idx on geo_claim_facts(tenant_id,run_id,sentiment);
