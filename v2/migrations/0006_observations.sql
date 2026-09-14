create table observation_plans (id uuid not null, tenant_id uuid not null, question_panel_id uuid not null, question_panel_version integer not null,
 provider text not null check(provider='deepseek'), model text not null, surface text not null check(surface='api'), rules jsonb not null,
 planned_samples integer not null check(planned_samples>0), created_at timestamptz not null, primary key(tenant_id,id),
 foreign key(tenant_id,question_panel_id,question_panel_version) references question_panels(tenant_id,id,version));
create table observation_targets (id uuid not null, tenant_id uuid not null, plan_id uuid not null, question_candidate_id uuid not null,
 question_text text not null, round integer not null check(round>0), idempotency_key char(64) not null, context jsonb not null,
 primary key(tenant_id,id), unique(tenant_id,idempotency_key), foreign key(tenant_id,plan_id) references observation_plans(tenant_id,id));
create table observation_attempts (id uuid not null, tenant_id uuid not null, target_id uuid not null, attempt integer not null check(attempt>0),
 status text not null check(status in('succeeded','retryable_failure','terminal_failure','budget_stopped')), request jsonb not null, response jsonb,
 error_code text, http_status integer, prompt_tokens integer not null check(prompt_tokens>=0), completion_tokens integer not null check(completion_tokens>=0),
 total_tokens integer not null check(total_tokens>=0), started_at timestamptz not null, completed_at timestamptz not null,
 primary key(tenant_id,id), unique(tenant_id,target_id,attempt), foreign key(tenant_id,target_id) references observation_targets(tenant_id,id));
create table raw_answers (id uuid not null, tenant_id uuid not null, target_id uuid not null, attempt_id uuid not null, answer_text text not null,
 provider_response_id text not null, model text not null, surface text not null check(surface='api'), finish_reason text not null,
 payload_sha256 char(64) not null, captured_at timestamptz not null, primary key(tenant_id,id), unique(tenant_id,target_id),
 foreign key(tenant_id,target_id) references observation_targets(tenant_id,id), foreign key(tenant_id,attempt_id) references observation_attempts(tenant_id,id));

do $$ declare t text; begin foreach t in array array['observation_plans','observation_targets','observation_attempts','raw_answers'] loop
 execute format('create trigger %I_append_only before update or delete on %I for each row execute function reject_immutable_mutation()',t,t);
 execute format('create trigger %I_no_truncate before truncate on %I for each statement execute function reject_immutable_mutation()',t,t);
 execute format('alter table %I enable row level security',t); execute format('alter table %I force row level security',t);
 execute format('create policy %I_tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t,t);
 end loop; end $$;
create index observation_targets_plan_idx on observation_targets(tenant_id,plan_id);
create index observation_attempts_target_idx on observation_attempts(tenant_id,target_id,attempt desc);
create index raw_answers_captured_idx on raw_answers(tenant_id,captured_at desc);
