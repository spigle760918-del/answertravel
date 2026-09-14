create table real_brand_onboarding_packages (
  id uuid not null, tenant_id uuid not null references tenants(id),
  brand_name text not null check(length(trim(brand_name)) > 0),
  package jsonb not null check(jsonb_typeof(package)='object'),
  status text not null check(status in('draft','approved','rejected')),
  created_at timestamptz not null,
  primary key(tenant_id,id)
);

create trigger real_brand_onboarding_packages_append_only before update or delete on real_brand_onboarding_packages
for each row execute function reject_immutable_mutation();
create trigger real_brand_onboarding_packages_no_truncate before truncate on real_brand_onboarding_packages
for each statement execute function reject_immutable_mutation();
alter table real_brand_onboarding_packages enable row level security;
alter table real_brand_onboarding_packages force row level security;
create policy real_brand_onboarding_packages_tenant_isolation on real_brand_onboarding_packages
  using (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
  with check (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
create index real_brand_onboarding_latest_idx on real_brand_onboarding_packages(tenant_id,created_at desc);
