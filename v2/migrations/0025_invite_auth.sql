create table platform_users (
  id uuid primary key,
  email text not null,
  normalized_email text not null unique check (normalized_email = lower(trim(normalized_email))),
  password_hash text not null check (length(password_hash) between 80 and 512),
  status text not null check (status in ('active', 'disabled')),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table tenant_memberships (
  user_id uuid not null references platform_users(id),
  tenant_id uuid not null references tenants(id),
  role text not null check (role in ('owner', 'viewer')),
  status text not null check (status in ('active', 'disabled')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, tenant_id)
);
create index tenant_memberships_tenant_idx on tenant_memberships (tenant_id, user_id);

create function list_user_memberships(requested_user_id uuid)
returns table (tenant_id uuid, display_name text, role text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.tenant_id, t.display_name, m.role
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = requested_user_id and m.status = 'active'
  order by t.display_name, t.id
$$;
revoke all on function list_user_memberships(uuid) from public;

create table user_sessions (
  id uuid primary key,
  user_id uuid not null references platform_users(id),
  token_sha256 char(64) not null unique check (token_sha256 ~ '^[a-f0-9]{64}$'),
  selected_tenant_id uuid references tenants(id),
  expires_at timestamptz not null,
  last_used_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null,
  check (expires_at > created_at)
);
create index user_sessions_user_active_idx on user_sessions (user_id, expires_at) where revoked_at is null;

create table auth_security_events (
  id uuid primary key,
  event_type text not null check (event_type in ('login_succeeded', 'login_failed', 'logout', 'workspace_selected', 'session_revoked')),
  user_id uuid references platform_users(id),
  session_id uuid,
  subject_sha256 char(64) not null check (subject_sha256 ~ '^[a-f0-9]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null
);
create index auth_security_events_occurred_idx on auth_security_events (occurred_at desc);

create trigger auth_security_events_append_only before update or delete on auth_security_events for each row execute function reject_immutable_mutation();
create trigger auth_security_events_no_truncate before truncate on auth_security_events for each statement execute function reject_immutable_mutation();
