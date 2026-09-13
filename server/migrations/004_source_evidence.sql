-- Structured evidence fields keep model citations separate from links embedded in
-- an answer and leave room for retrieval/manual sources without rewriting history.
alter table answer_sources add column if not exists source_type varchar(32) not null default 'model_citation';
alter table answer_sources add column if not exists verification_status varchar(20) not null default 'unverified';
alter table answer_sources add column if not exists content text;
alter table answer_sources add column if not exists author text;
alter table answer_sources add column if not exists published_at timestamptz;
alter table answer_sources add column if not exists modality varchar(40);
alter table answer_sources add column if not exists brand_match boolean not null default false;
alter table answer_sources add column if not exists competitor_matches jsonb not null default '[]'::jsonb;
alter table answer_sources add column if not exists raw_payload jsonb not null default '{}'::jsonb;
alter table answer_sources add column if not exists fetched_at timestamptz;
alter table answer_sources add column if not exists error_message text;
alter table answer_sources drop constraint if exists answer_sources_source_type_check;
alter table answer_sources add constraint answer_sources_source_type_check check (source_type in ('model_citation','embedded_link','retrieval_candidate','manual_or_owned'));
alter table answer_sources drop constraint if exists answer_sources_verification_status_check;
alter table answer_sources add constraint answer_sources_verification_status_check check (verification_status in ('unverified','fetched','failed'));
create index if not exists idx_answer_sources_type_status on answer_sources(source_type, verification_status);
create index if not exists idx_answer_sources_record_type on answer_sources(answer_record_id, source_type);
