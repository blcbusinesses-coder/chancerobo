-- ============================================================
--  Migration 0004 — saved values (user-taught facts)
--  Run in the Supabase SQL Editor.
--  Lets Chance remember named facts ("personal email", "home
--  address", …) and reuse them when you refer to them by name.
-- ============================================================

create table if not exists chance.saved_values (
  label      text primary key,          -- normalized name, e.g. 'personal email'
  value      text not null,             -- the remembered value
  category   text,                      -- optional grouping: 'email' / 'phone' / 'address'
  updated_at timestamptz not null default now()
);

-- RLS (service role bypasses; scoped clients pinned to 'chance').
alter table chance.saved_values enable row level security;

drop policy if exists sv_self on chance.saved_values;
create policy sv_self on chance.saved_values for all
  using (ecosystem.current_agent_slug() = 'chance')
  with check (ecosystem.current_agent_slug() = 'chance');

-- Grants (service_role + scoped API roles).
grant all on chance.saved_values to service_role;
grant select, insert, update, delete on chance.saved_values to anon, authenticated;
