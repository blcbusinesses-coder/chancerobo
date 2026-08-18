-- ============================================================
--  Migration 0003 — MiniMax usage/cost tracking
--  Run in the Supabase SQL Editor.
-- ============================================================
create table if not exists chance.usage_log (
  id                bigint generated always as identity primary key,
  provider          text not null,
  model             text,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  cost_cents        numeric not null default 0,
  created_at        timestamptz not null default now()
);

alter table chance.usage_log enable row level security;

drop policy if exists ul_self on chance.usage_log;
create policy ul_self on chance.usage_log for all
  using (ecosystem.current_agent_slug() = 'chance')
  with check (ecosystem.current_agent_slug() = 'chance');

grant all on chance.usage_log to service_role;
grant select, insert, update, delete on chance.usage_log to anon, authenticated;
