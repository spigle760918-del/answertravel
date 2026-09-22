create table competitor_scope_versions (
  id uuid not null,
  tenant_id uuid not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft','approved','superseded')),
  brand_truth_version integer not null check (brand_truth_version > 0),
  effective_from date not null,
  effective_to date,
  region text not null,
  evidence_note text not null,
  source_reference text not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null,
  primary key (tenant_id,id,version),
  unique (tenant_id,version),
  check (effective_to is null or effective_to >= effective_from),
  check ((status = 'approved' and confirmed_by is not null and confirmed_at is not null) or status <> 'approved')
);

create table competitor_scope_entities (
  id uuid not null,
  tenant_id uuid not null,
  scope_id uuid not null,
  scope_version integer not null,
  entity_id text not null,
  name text not null,
  aliases jsonb not null check (jsonb_typeof(aliases) = 'array'),
  relationship_type text not null check (relationship_type in ('direct_competitor','alternative','reference','excluded')),
  overlapping_offerings jsonb not null check (jsonb_typeof(overlapping_offerings) = 'array'),
  region text not null,
  effective_from date not null,
  effective_to date,
  status text not null check (status in ('draft','approved','excluded')),
  evidence_note text not null,
  source_reference text not null,
  created_at timestamptz not null,
  primary key (tenant_id,id),
  foreign key (tenant_id,scope_id,scope_version) references competitor_scope_versions(tenant_id,id,version),
  check (effective_to is null or effective_to >= effective_from)
);

do $$ declare table_name text; begin
  foreach table_name in array array['competitor_scope_versions','competitor_scope_entities'] loop
    execute format('create trigger %I_append_only before update or delete on %I for each row execute function reject_immutable_mutation()',table_name,table_name);
    execute format('create trigger %I_no_truncate before truncate on %I for each statement execute function reject_immutable_mutation()',table_name,table_name);
    execute format('alter table %I enable row level security',table_name);
    execute format('alter table %I force row level security',table_name);
    execute format('create policy %I_tenant_isolation on %I using (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) with check (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',table_name,table_name);
  end loop;
end $$;

create index competitor_scope_versions_tenant_idx on competitor_scope_versions(tenant_id,version desc);
create index competitor_scope_entities_scope_idx on competitor_scope_entities(tenant_id,scope_id,scope_version);
