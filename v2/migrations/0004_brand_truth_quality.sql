create table brand_truth_quality_reports (
  id uuid not null,
  tenant_id uuid not null,
  card_id uuid not null,
  card_version integer not null check (card_version > 0),
  rules_version text not null check (rules_version ~ '^brand-truth-quality[.]v[0-9]+$'),
  issues jsonb not null check (jsonb_typeof(issues) = 'array'),
  confirmation_items jsonb not null check (jsonb_typeof(confirmation_items) = 'array'),
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, card_id, card_version)
    references brand_truth_cards (tenant_id, id, version)
);

create trigger brand_truth_quality_reports_append_only
before update or delete on brand_truth_quality_reports
for each row execute function reject_immutable_mutation();

create trigger brand_truth_quality_reports_no_truncate
before truncate on brand_truth_quality_reports
for each statement execute function reject_immutable_mutation();

alter table brand_truth_quality_reports enable row level security;
alter table brand_truth_quality_reports force row level security;

create policy brand_truth_quality_reports_tenant_isolation on brand_truth_quality_reports
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create index brand_truth_quality_reports_card_idx
  on brand_truth_quality_reports (tenant_id, card_id, card_version, created_at desc);
