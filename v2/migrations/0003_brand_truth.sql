create table brand_truth_cards (
  id uuid not null,
  tenant_id uuid not null references tenants(id),
  brand_name text not null check (length(trim(brand_name)) > 0),
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved')),
  facts jsonb not null check (jsonb_typeof(facts) = 'array'),
  created_at timestamptz not null,
  primary key (tenant_id, id, version)
);

create trigger brand_truth_cards_append_only
before update or delete on brand_truth_cards
for each row execute function reject_immutable_mutation();

create trigger brand_truth_cards_no_truncate
before truncate on brand_truth_cards
for each statement execute function reject_immutable_mutation();

alter table brand_truth_cards enable row level security;
alter table brand_truth_cards force row level security;

create policy brand_truth_cards_tenant_isolation on brand_truth_cards
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create index brand_truth_cards_tenant_created_idx
  on brand_truth_cards (tenant_id, created_at desc);
