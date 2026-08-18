-- ============================================================
--  Migration 0002 — multi-account Google + persisted settings
--  Run in the Supabase SQL Editor.
-- ============================================================

-- Extra Google accounts Chance can manage (his own primary stays in .env).
create table if not exists chance.google_accounts (
  email         text primary key,
  refresh_token text not null,
  display_name  text,
  enabled       boolean not null default true,
  added_at      timestamptz not null default now()
);

-- UI / agent settings (key -> value).
create table if not exists chance.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- RLS (service role bypasses; scoped clients pinned to 'chance').
alter table chance.google_accounts enable row level security;
alter table chance.settings        enable row level security;

drop policy if exists ga_self on chance.google_accounts;
create policy ga_self on chance.google_accounts for all
  using (ecosystem.current_agent_slug() = 'chance')
  with check (ecosystem.current_agent_slug() = 'chance');

drop policy if exists st_self on chance.settings;
create policy st_self on chance.settings for all
  using (ecosystem.current_agent_slug() = 'chance')
  with check (ecosystem.current_agent_slug() = 'chance');

-- Grants (service_role + scoped API roles).
grant all on chance.google_accounts, chance.settings to service_role;
grant select, insert, update, delete on chance.google_accounts, chance.settings to anon, authenticated;
