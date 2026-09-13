alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenants_isolation on tenants
  using (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create trigger evidence_artifacts_no_truncate
before truncate on evidence_artifacts
for each statement execute function reject_immutable_mutation();

create trigger audit_events_no_truncate
before truncate on audit_events
for each statement execute function reject_immutable_mutation();
