alter table evidence_artifacts
  add constraint evidence_artifacts_tenant_id_id_unique unique (tenant_id, id);

create table question_generation_runs (
  id uuid not null,
  tenant_id uuid not null,
  brand_truth_card_id uuid not null,
  brand_truth_version integer not null check (brand_truth_version > 0),
  status text not null check (status in ('succeeded', 'failed')),
  provider text not null check (provider = 'deepseek'),
  model text not null check (length(trim(model)) > 0),
  prompt_version text not null check (prompt_version = 'question-expansion.v1'),
  evidence_id uuid not null,
  error_code text,
  requested_at timestamptz not null,
  completed_at timestamptz not null check (completed_at >= requested_at),
  primary key (tenant_id, id),
  foreign key (tenant_id, brand_truth_card_id, brand_truth_version)
    references brand_truth_cards (tenant_id, id, version),
  foreign key (tenant_id, evidence_id)
    references evidence_artifacts (tenant_id, id),
  check ((status = 'succeeded' and error_code is null) or (status = 'failed' and length(trim(error_code)) > 0))
);

create table question_panels (
  id uuid not null,
  tenant_id uuid not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved')),
  brand_truth_card_id uuid not null,
  brand_truth_version integer not null check (brand_truth_version > 0),
  generation_run_id uuid not null,
  candidates jsonb not null check (jsonb_typeof(candidates) = 'array'),
  mix jsonb not null check (jsonb_typeof(mix) = 'object'),
  created_at timestamptz not null,
  primary key (tenant_id, id, version),
  foreign key (tenant_id, brand_truth_card_id, brand_truth_version)
    references brand_truth_cards (tenant_id, id, version),
  foreign key (tenant_id, generation_run_id)
    references question_generation_runs (tenant_id, id)
);

create trigger question_generation_runs_append_only
before update or delete on question_generation_runs
for each row execute function reject_immutable_mutation();
create trigger question_generation_runs_no_truncate
before truncate on question_generation_runs
for each statement execute function reject_immutable_mutation();
create trigger question_panels_append_only
before update or delete on question_panels
for each row execute function reject_immutable_mutation();
create trigger question_panels_no_truncate
before truncate on question_panels
for each statement execute function reject_immutable_mutation();

alter table question_generation_runs enable row level security;
alter table question_generation_runs force row level security;
alter table question_panels enable row level security;
alter table question_panels force row level security;

create policy question_generation_runs_tenant_isolation on question_generation_runs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
create policy question_panels_tenant_isolation on question_panels
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create index question_generation_runs_tenant_completed_idx
  on question_generation_runs (tenant_id, completed_at desc);
create index question_panels_tenant_created_idx
  on question_panels (tenant_id, created_at desc);
