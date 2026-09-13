-- Transitional snapshot table used by the current API adapter.
-- It is intentionally separate from the normalized business tables in 001.
-- Remove it after all route handlers have moved to repositories.

create table if not exists answertravel_state (
  id smallint primary key check (id = 1),
  data jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
