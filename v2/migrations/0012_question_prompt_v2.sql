alter table question_generation_runs
  drop constraint if exists question_generation_runs_prompt_version_check;

alter table question_generation_runs
  add constraint question_generation_runs_prompt_version_check
  check (prompt_version in ('question-expansion.v1', 'question-expansion.v2'));
