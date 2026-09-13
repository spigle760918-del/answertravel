# AnswerTravel 生产数据库设计

目标数据库：PostgreSQL 15+。  
当前原型使用 `server/data.json`，本设计用于从本地 JSON 迁移到可上线的多租户数据库。

## 1. 设计原则

- 所有业务表都带 `workspace_id`；品牌级数据再带 `brand_id`。
- 使用 UUID 主键，避免暴露连续业务编号。
- 使用 `created_at`、`updated_at`、必要时 `deleted_at`，默认软删除。
- 原始模型回答和外部响应保存在 JSONB，分析字段单独结构化存储。
- 状态字段使用受控枚举或校验约束，避免前后端自由拼写。
- 所有重要变更写入 `audit_logs`。

## 2. 核心实体关系

```text
users ──< workspace_members >── workspaces ──< brands
                                      │             ├──< brand_competitors >── brands
                                      │             ├──< prompt_groups ──< prompts
                                      │             ├──< assets
                                      │             └──< articles ──< publish_jobs
prompts ──< collection_tasks ──< answer_records ──< answer_sources ──> source_domains
```

## 3. 表设计

### 3.1 账号与租户

`users`

- `id uuid pk`
- `email citext unique not null`
- `name varchar(80) not null`
- `password_hash text not null`
- `status varchar(20) not null default 'active'`
- `last_login_at timestamptz`
- `created_at`, `updated_at`

`workspaces`

- `id uuid pk`
- `name varchar(120) not null`
- `description text`
- `avatar_url text`
- `plan_code varchar(40) not null default 'trial'`
- `revision bigint not null default 0`（快照过渡层的乐观并发版本）
- `created_by uuid references users(id)`
- `created_at`, `updated_at`

`workspace_members`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `user_id uuid references users(id) on delete cascade`
- `role varchar(30) not null`
- `status varchar(20) not null default 'invited'`
- `created_at`, `accepted_at`, `updated_at`
- unique (`workspace_id`, `user_id`)

`workspace_invitations`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `email citext not null`
- `role varchar(30) not null`
- `brand_scope jsonb not null default '[]'`
- `token_hash text unique not null`
- `expires_at timestamptz not null`
- `accepted_at timestamptz`
- `created_by uuid references users(id)`
- `created_at`

### 3.2 品牌与监控配置

`brands`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `name varchar(160) not null`
- `aliases text[] not null default '{}'`
- `website_url text`
- `language varchar(20) not null default 'zh-CN'`
- `region varchar(80)`
- `description text`
- `note text`
- `tracking_enabled boolean not null default true`
- `created_at`, `updated_at`, `deleted_at`
- unique (`workspace_id`, `name`) where `deleted_at is null`

`brand_domains`

- `id uuid pk`
- `brand_id uuid references brands(id) on delete cascade`
- `domain citext not null`
- `match_subdomains boolean not null default true`
- unique (`brand_id`, `domain`)

`brand_competitors`

- `id uuid pk`
- `brand_id uuid references brands(id) on delete cascade`
- `competitor_brand_id uuid references brands(id)`
- `name varchar(160) not null`
- `website_url text`
- `status varchar(20) not null default 'active'`
- unique (`brand_id`, `name`)

`prompt_groups`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `brand_id uuid references brands(id) on delete cascade`
- `name varchar(120) not null`
- `sort_order integer not null default 0`
- `created_at`, `updated_at`

`prompts`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `brand_id uuid references brands(id) on delete cascade`
- `group_id uuid references prompt_groups(id)`
- `text text not null`
- `language varchar(20) not null default 'zh-CN'`
- `region varchar(80)`
- `frequency varchar(20) not null default 'daily'`
- `status varchar(20) not null default 'active'`
- `created_by uuid references users(id)`
- `created_at`, `updated_at`, `deleted_at`
- unique (`brand_id`, `text`) where `deleted_at is null`

### 3.3 模型任务与回答

`model_platforms`

- `id uuid pk`
- `code varchar(40) unique not null`
- `name varchar(80) not null`
- `adapter_key varchar(80) not null`
- `enabled boolean not null default true`

`collection_tasks`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `brand_id uuid references brands(id) on delete cascade`
- `prompt_id uuid references prompts(id) on delete cascade`
- `platform_id uuid references model_platforms(id)`
- `status varchar(20) not null`
- `attempt integer not null default 0`
- `idempotency_key varchar(120) unique not null`
- `queued_at`, `started_at`, `finished_at`
- `error_code`, `error_message text`

`answer_records`

- `id uuid pk`
- `task_id uuid references collection_tasks(id) on delete cascade`
- `prompt_id uuid references prompts(id) on delete cascade`
- `platform_id uuid references model_platforms(id)`
- `model_version varchar(120)`
- `status varchar(20) not null`
- `raw_answer text`
- `raw_payload jsonb`
- `mentioned boolean`
- `first_rank numeric(8,2)`
- `exposure_score numeric(8,2)`
- `evaluated_at timestamptz`
- `latency_ms integer`
- `created_at`

`answer_sources`

- `id uuid pk`
- `answer_record_id uuid references answer_records(id) on delete cascade`
- `domain_id uuid references source_domains(id)`
- `url text not null`
- `title text`
- `position integer`
- `is_brand_domain boolean not null default false`
- `created_at`

`source_domains`

- `id uuid pk`
- `domain citext unique not null`
- `first_seen_at`, `last_seen_at`

### 3.4 素材与文章

`assets`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `brand_id uuid references brands(id) on delete cascade`
- `title varchar(240) not null`
- `asset_type varchar(40) not null`
- `source_url text`
- `storage_key text`
- `content_text text`
- `status varchar(20) not null default 'pending_review'`
- `valid_from`, `valid_until`
- `last_verified_at timestamptz`
- `created_by uuid references users(id)`
- `created_at`, `updated_at`, `deleted_at`

`articles`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `brand_id uuid references brands(id) on delete cascade`
- `source_prompt_id uuid references prompts(id)`
- `title varchar(240) not null`
- `topic varchar(120)`
- `body text not null default ''`
- `status varchar(30) not null`
- `seo_title varchar(240)`
- `seo_description text`
- `seo_keywords text[]`
- `slug varchar(180)`
- `fact_check_status varchar(30) not null default 'pending'`
- `index_status varchar(30) not null default 'not_submitted'`
- `created_by uuid references users(id)`
- `reviewed_by uuid references users(id)`
- `reviewed_at timestamptz`
- `published_at timestamptz`
- `created_at`, `updated_at`, `deleted_at`
- unique (`brand_id`, `slug`) where `deleted_at is null`

`article_reviews`

- `id uuid pk`
- `article_id uuid references articles(id) on delete cascade`
- `reviewer_id uuid references users(id)`
- `checks jsonb not null`
- `comment text`
- `created_at`

`publish_channels`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `name varchar(80) not null`
- `channel_type varchar(30) not null`
- `endpoint text`
- `credential_ref text`
- `status varchar(20) not null default 'disconnected'`
- `created_at`, `updated_at`

`publish_jobs`

- `id uuid pk`
- `article_id uuid references articles(id) on delete cascade`
- `channel_id uuid references publish_channels(id)`
- `status varchar(20) not null`
- `attempt integer not null default 0`
- `external_id text`
- `published_url text`
- `error_message text`
- `idempotency_key varchar(120) unique not null`
- `queued_at`, `started_at`, `finished_at`

### 3.5 审计与系统

`audit_logs`

- `id uuid pk`
- `workspace_id uuid references workspaces(id) on delete cascade`
- `actor_id uuid references users(id)`
- `action varchar(80) not null`
- `resource_type varchar(50) not null`
- `resource_id uuid`
- `before_data jsonb`
- `after_data jsonb`
- `ip inet`
- `created_at`

`refresh_tokens`

- `id uuid pk`
- `user_id uuid references users(id) on delete cascade`
- `token_hash text unique not null`
- `expires_at timestamptz not null`
- `revoked_at timestamptz`
- `created_at`

## 4. 必建索引

```sql
create index idx_prompts_brand_status on prompts(brand_id, status);
create index idx_tasks_status_queued on collection_tasks(status, queued_at);
create index idx_answers_prompt_time on answer_records(prompt_id, evaluated_at desc);
create index idx_answers_platform_time on answer_records(platform_id, evaluated_at desc);
create index idx_sources_domain on answer_sources(domain_id);
create index idx_articles_brand_status on articles(brand_id, status, updated_at desc);
create index idx_publish_jobs_status on publish_jobs(status, queued_at);
create index idx_audit_workspace_time on audit_logs(workspace_id, created_at desc);
```

## 5. 迁移顺序

1. 建立 users、workspaces、workspace_members、brands。
2. 迁移 prompts、prompt_groups、model_platforms、collection_tasks、answer_records。
3. 迁移 assets、articles、reviews、channels、publish_jobs。
4. 回填 workspace_id/brand_id，建立唯一约束和索引。
5. 校验 JSON 快照与数据库记录数量、状态和关键字段一致。
6. 切换读流量到数据库，保留 JSON 导出作为回滚快照。
