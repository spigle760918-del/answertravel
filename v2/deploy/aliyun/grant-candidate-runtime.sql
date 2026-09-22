\if :{?runtime_user}
\else
\echo 'runtime_user is required'
\quit 3
\endif

begin;
grant select on platform_users, tenant_memberships to :"runtime_user";
grant select, insert, update on user_sessions to :"runtime_user";
grant select, insert on auth_security_events to :"runtime_user";
grant execute on function list_user_memberships(uuid) to :"runtime_user";
grant select on competitor_scope_versions, competitor_scope_entities to :"runtime_user";
revoke delete, truncate on platform_users, tenant_memberships, user_sessions, auth_security_events, competitor_scope_versions, competitor_scope_entities from :"runtime_user";
commit;
