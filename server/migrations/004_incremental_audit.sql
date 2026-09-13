-- Resource-level persistence needs a stable business identifier in audit logs.
-- Keep the UUID resource_id column for future internal foreign-key usage while
-- preserving the current external IDs used by the API and frontend.

alter table audit_logs add column if not exists external_resource_id varchar(160);

create index if not exists idx_audit_workspace_resource
  on audit_logs (workspace_id, resource_type, external_resource_id, created_at desc);

create index if not exists idx_audit_workspace_action
  on audit_logs (workspace_id, action, created_at desc);

create index if not exists idx_refresh_tokens_user_active
  on refresh_tokens (user_id, expires_at desc)
  where revoked_at is null;
