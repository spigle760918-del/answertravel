-- Runtime fields needed by the existing API while it is being moved from
-- snapshot persistence to resource repositories. These columns are additive;
-- they do not change the original relational constraints.

alter table workspaces add column if not exists external_id varchar(160);
alter table workspaces add column if not exists settings jsonb not null default '{}'::jsonb;
alter table workspaces add column if not exists revision bigint not null default 0;
create unique index if not exists uq_workspaces_external_id on workspaces(external_id) where external_id is not null;

alter table users add column if not exists external_id varchar(160);
create unique index if not exists uq_users_external_id on users(external_id) where external_id is not null;

alter table workspace_members add column if not exists external_id varchar(160);
alter table workspace_members add column if not exists scope jsonb not null default '{}'::jsonb;
create unique index if not exists uq_members_external_id on workspace_members(external_id) where external_id is not null;

alter table workspace_invitations add column if not exists external_id varchar(160);
alter table workspace_invitations add column if not exists state jsonb not null default '{}'::jsonb;
create unique index if not exists uq_invitations_external_id on workspace_invitations(external_id) where external_id is not null;

alter table brands add column if not exists external_id varchar(160);
alter table brands add column if not exists state jsonb not null default '{}'::jsonb;
create unique index if not exists uq_brands_external_id on brands(external_id) where external_id is not null;

alter table brand_competitors add column if not exists external_id varchar(160);
alter table brand_competitors add column if not exists state jsonb not null default '{}'::jsonb;
create unique index if not exists uq_competitors_external_id on brand_competitors(external_id) where external_id is not null;

alter table prompt_groups add column if not exists external_id varchar(160);
create unique index if not exists uq_prompt_groups_external_id on prompt_groups(external_id) where external_id is not null;

alter table prompts add column if not exists external_id varchar(160);
alter table prompts add column if not exists platforms text[] not null default '{}';
alter table prompts add column if not exists state jsonb not null default '{}'::jsonb;
create unique index if not exists uq_prompts_external_id on prompts(external_id) where external_id is not null;

create table if not exists runtime_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  external_id varchar(160) not null unique,
  task_type varchar(60) not null,
  status varchar(20) not null,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table answer_records add column if not exists external_id varchar(160);
alter table answer_records add column if not exists state jsonb not null default '{}'::jsonb;
alter table answer_records alter column task_id drop not null;
alter table answer_records drop constraint if exists answer_records_task_id_fkey;
create unique index if not exists uq_answer_records_external_id on answer_records(external_id) where external_id is not null;

alter table assets add column if not exists external_id varchar(160);
alter table assets add column if not exists state jsonb not null default '{}'::jsonb;
create unique index if not exists uq_assets_external_id on assets(external_id) where external_id is not null;

alter table articles add column if not exists external_id varchar(160);
alter table articles add column if not exists state jsonb not null default '{}'::jsonb;
create unique index if not exists uq_articles_external_id on articles(external_id) where external_id is not null;

alter table users add column if not exists profile jsonb not null default '{}'::jsonb;

alter table publish_channels add column if not exists external_id varchar(160);
alter table publish_channels add column if not exists state jsonb not null default '{}'::jsonb;
create unique index if not exists uq_channels_external_id on publish_channels(external_id) where external_id is not null;
