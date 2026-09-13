-- AnswerTravel PostgreSQL baseline migration.
-- Run with a migration runner in a transaction. All application queries must
-- additionally scope rows by workspace_id and brand_id after authentication.

create extension if not exists citext;
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name varchar(80) not null,
  password_hash text not null,
  status varchar(20) not null default 'active' check (status in ('active', 'disabled')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  description text,
  avatar_url text,
  plan_code varchar(40) not null default 'trial',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role varchar(30) not null check (role in ('team_admin', 'brand_admin', 'brand_editor', 'brand_member')),
  status varchar(20) not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email citext not null,
  role varchar(30) not null check (role in ('team_admin', 'brand_admin', 'brand_editor', 'brand_member')),
  brand_scope jsonb not null default '[]'::jsonb,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name varchar(160) not null,
  aliases text[] not null default '{}',
  website_url text,
  language varchar(20) not null default 'zh-CN',
  region varchar(80),
  description text,
  note text,
  tracking_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists uq_brands_workspace_name on brands (workspace_id, lower(name)) where deleted_at is null;

create table if not exists brand_domains (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  domain citext not null,
  match_subdomains boolean not null default true,
  unique (brand_id, domain)
);

create table if not exists brand_competitors (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  competitor_brand_id uuid references brands(id),
  name varchar(160) not null,
  website_url text,
  status varchar(20) not null default 'active' check (status in ('active', 'paused')),
  unique (brand_id, name)
);

create table if not exists prompt_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  name varchar(120) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, name)
);

create table if not exists model_platforms (
  id uuid primary key default gen_random_uuid(),
  code varchar(40) not null unique,
  name varchar(80) not null,
  adapter_key varchar(80) not null,
  enabled boolean not null default true
);

create table if not exists prompts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  group_id uuid references prompt_groups(id),
  text text not null,
  language varchar(20) not null default 'zh-CN',
  region varchar(80),
  frequency varchar(20) not null default 'daily',
  status varchar(20) not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists uq_prompts_brand_text on prompts (brand_id, md5(text)) where deleted_at is null;

create table if not exists collection_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  prompt_id uuid not null references prompts(id) on delete cascade,
  platform_id uuid references model_platforms(id),
  status varchar(20) not null check (status in ('queued', 'running', 'completed', 'error', 'cancelled')),
  attempt integer not null default 0,
  idempotency_key varchar(160) not null unique,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code varchar(80),
  error_message text
);

create table if not exists answer_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references collection_tasks(id) on delete cascade,
  prompt_id uuid not null references prompts(id) on delete cascade,
  platform_id uuid references model_platforms(id),
  model_version varchar(120),
  status varchar(20) not null check (status in ('queued', 'completed', 'error')),
  raw_answer text,
  raw_payload jsonb,
  mentioned boolean,
  first_rank numeric(8,2),
  exposure_score numeric(8,2),
  evaluated_at timestamptz,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists source_domains (
  id uuid primary key default gen_random_uuid(),
  domain citext not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create table if not exists answer_sources (
  id uuid primary key default gen_random_uuid(),
  answer_record_id uuid not null references answer_records(id) on delete cascade,
  domain_id uuid references source_domains(id),
  url text not null,
  title text,
  position integer,
  is_brand_domain boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  title varchar(240) not null,
  asset_type varchar(40) not null,
  source_url text,
  storage_key text,
  content_text text,
  status varchar(20) not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'expired')),
  valid_from date,
  valid_until date,
  last_verified_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  source_prompt_id uuid references prompts(id),
  title varchar(240) not null,
  topic varchar(120),
  body text not null default '',
  status varchar(30) not null check (status in ('draft', 'pending_review', 'pending_publish', 'publishing', 'published', 'indexed', 'publish_error')),
  seo_title varchar(240),
  seo_description text,
  seo_keywords text[] not null default '{}',
  slug varchar(180),
  fact_check_status varchar(30) not null default 'pending',
  index_status varchar(30) not null default 'not_submitted',
  created_by uuid references users(id),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists uq_articles_brand_slug on articles (brand_id, slug) where deleted_at is null and slug is not null;

create table if not exists article_reviews (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  reviewer_id uuid references users(id),
  checks jsonb not null,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists publish_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name varchar(80) not null,
  channel_type varchar(30) not null,
  endpoint text,
  credential_ref text,
  status varchar(20) not null default 'disconnected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create table if not exists publish_jobs (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  channel_id uuid references publish_channels(id),
  status varchar(20) not null check (status in ('queued', 'running', 'completed', 'error', 'cancelled')),
  attempt integer not null default 0,
  external_id text,
  published_url text,
  error_message text,
  idempotency_key varchar(160) not null unique,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_id uuid references users(id),
  action varchar(80) not null,
  resource_type varchar(50) not null,
  resource_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_members_workspace on workspace_members(workspace_id, status);
create index if not exists idx_prompts_brand_status on prompts(brand_id, status);
create index if not exists idx_tasks_status_queued on collection_tasks(status, queued_at);
create index if not exists idx_answers_prompt_time on answer_records(prompt_id, evaluated_at desc);
create index if not exists idx_answers_platform_time on answer_records(platform_id, evaluated_at desc);
create index if not exists idx_sources_domain on answer_sources(domain_id);
create index if not exists idx_assets_brand_status on assets(brand_id, status, updated_at desc);
create index if not exists idx_articles_brand_status on articles(brand_id, status, updated_at desc);
create index if not exists idx_publish_jobs_status on publish_jobs(status, queued_at);
create index if not exists idx_audit_workspace_time on audit_logs(workspace_id, created_at desc);
