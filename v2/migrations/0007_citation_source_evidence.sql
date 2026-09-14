create table citation_scans (
  id uuid not null,
  tenant_id uuid not null,
  answer_id uuid not null,
  extractor_version text not null check (extractor_version ~ '^citation-extractor[.]v[0-9]+$'),
  status text not null check (status in ('completed', 'failed')),
  candidate_count integer not null check (candidate_count >= 0),
  error_code text,
  scanned_at timestamptz not null,
  primary key (tenant_id, id),
  unique (tenant_id, answer_id, extractor_version),
  foreign key (tenant_id, answer_id) references raw_answers (tenant_id, id)
);

create table citation_events (
  id uuid not null,
  tenant_id uuid not null,
  scan_id uuid not null,
  answer_id uuid not null,
  kind text not null check (kind in ('inline_link', 'source_list', 'provider_citation', 'content_absorption_candidate')),
  raw_value text not null check (length(raw_value) > 0),
  raw_url text,
  canonical_url text,
  domain text,
  evidence_status text not null check (evidence_status in ('candidate', 'insufficient')),
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, scan_id) references citation_scans (tenant_id, id),
  foreign key (tenant_id, answer_id) references raw_answers (tenant_id, id),
  check ((evidence_status = 'candidate' and canonical_url is not null and domain is not null)
    or (evidence_status = 'insufficient' and canonical_url is null))
);

create unique index citation_events_dedup_idx on citation_events
  (tenant_id, answer_id, kind, canonical_url) where canonical_url is not null;

create table source_snapshots (
  id uuid not null,
  tenant_id uuid not null,
  citation_event_id uuid not null,
  attempt integer not null check (attempt > 0),
  canonical_url text not null,
  status text not null check (status in ('succeeded', 'blocked', 'failed')),
  http_status integer,
  redirect_chain jsonb not null check (jsonb_typeof(redirect_chain) = 'array'),
  content_type text,
  title text,
  author text,
  published_at text,
  text_excerpt text,
  content_sha256 char(64),
  error_code text,
  captured_at timestamptz not null,
  primary key (tenant_id, id),
  unique (tenant_id, citation_event_id, attempt),
  foreign key (tenant_id, citation_event_id) references citation_events (tenant_id, id),
  check ((status = 'succeeded' and content_sha256 is not null and error_code is null)
    or (status <> 'succeeded' and content_sha256 is null and error_code is not null))
);

do $$
declare table_name text;
begin
  foreach table_name in array array['citation_scans', 'citation_events', 'source_snapshots'] loop
    execute format('create trigger %I_append_only before update or delete on %I for each row execute function reject_immutable_mutation()', table_name, table_name);
    execute format('create trigger %I_no_truncate before truncate on %I for each statement execute function reject_immutable_mutation()', table_name, table_name);
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('create policy %I_tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name, table_name);
  end loop;
end $$;

create index citation_scans_answer_idx on citation_scans (tenant_id, answer_id, scanned_at desc);
create index citation_events_answer_idx on citation_events (tenant_id, answer_id, created_at desc);
create index source_snapshots_event_idx on source_snapshots (tenant_id, citation_event_id, attempt desc);
