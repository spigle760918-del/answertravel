create table if not exists schema_migrations (
  version text primary key,
  checksum char(64) not null,
  applied_at timestamptz not null default now()
);

create table tenants (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now()
);

create table evidence_artifacts (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  artifact_type text not null check (artifact_type ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  fact_level text not null check (fact_level in ('F0', 'F1', 'F2', 'F3', 'F4')),
  schema_version integer not null check (schema_version > 0),
  source jsonb not null,
  source_ref text not null,
  payload jsonb not null,
  payload_sha256 char(64) not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, artifact_type, source_ref, payload_sha256)
);

create table audit_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  actor_type text not null check (actor_type in ('user', 'agent', 'system', 'worker')),
  actor_id text not null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  trace_id text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create or replace function reject_immutable_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only; % is forbidden', tg_table_name, tg_op;
end;
$$;

create trigger evidence_artifacts_append_only
before update or delete on evidence_artifacts
for each row execute function reject_immutable_mutation();

create trigger audit_events_append_only
before update or delete on audit_events
for each row execute function reject_immutable_mutation();

alter table evidence_artifacts enable row level security;
alter table audit_events enable row level security;
alter table evidence_artifacts force row level security;
alter table audit_events force row level security;

create policy evidence_tenant_isolation on evidence_artifacts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy audit_tenant_isolation on audit_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create index evidence_artifacts_tenant_captured_idx
  on evidence_artifacts (tenant_id, captured_at desc);

create index audit_events_tenant_occurred_idx
  on audit_events (tenant_id, occurred_at desc);
