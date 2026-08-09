-- ============================================================================
--  C.H.A.N.C.E ECOSYSTEM — Migration 0001
--  Agent Zero (CHANCE) schema + global RLS foundation
-- ============================================================================
--  Model:
--    * Each agent gets a DEDICATED schema named after its slug (e.g. "chance").
--    * A sub-agent authenticates with a JWT carrying `agent_slug` and may ONLY
--      read/write rows inside its own schema (RLS below).
--    * CHANCE (the Overseer) uses the SERVICE ROLE key, which bypasses RLS and
--      therefore holds master read/write across EVERY agent schema.
--
--  This migration provisions the "chance" schema. Provision future agents by
--  cloning the pattern in the marked section (or generating it per-agent).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Registry of all agents (lives in a shared "ecosystem" schema).
-- ---------------------------------------------------------------------------
create schema if not exists ecosystem;

create table if not exists ecosystem.agents (
  slug          text primary key,
  display_name  text not null,
  role          text not null,
  is_overseer   boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Helper: extract the caller's agent slug from their JWT claims.
-- Sub-agent JWTs are minted with { "agent_slug": "<slug>" } in the payload.
create or replace function ecosystem.current_agent_slug()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::json ->> 'agent_slug', ''),
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. CHANCE's dedicated schema.
-- ---------------------------------------------------------------------------
create schema if not exists chance;

-- Memory / conversation log for the agent's execution loop.
create table if not exists chance.memory (
  id          bigint generated always as identity primary key,
  role        text not null,               -- 'user' | 'assistant' | 'delegation' | ...
  content     text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Task queue the Overseer uses to track delegated work.
create table if not exists chance.tasks (
  id            bigint generated always as identity primary key,
  objective     text not null,
  assigned_to   text,                       -- target agent slug (nullable = unassigned)
  status        text not null default 'pending', -- pending | in_progress | done | failed
  plan          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Frontend identity/config snapshot (Mandatory Function #5), for the dashboard.
create table if not exists chance.identity (
  id          int primary key default 1,
  config      jsonb not null,
  updated_at  timestamptz not null default now(),
  constraint identity_singleton check (id = 1)
);

-- ---------------------------------------------------------------------------
-- 2. Row Level Security.
--    Enable RLS on every agent table. The service role (CHANCE) bypasses RLS
--    entirely, so these policies only constrain scoped (anon/JWT) clients.
-- ---------------------------------------------------------------------------
alter table chance.memory   enable row level security;
alter table chance.tasks    enable row level security;
alter table chance.identity enable row level security;

-- Self-scope policy: a client may touch chance.* ONLY if its JWT slug is 'chance'.
-- (For sub-agents, the identical pattern is applied to their own schema, so
--  agent "atlas" can only reach atlas.* — never chance.* or any sibling.)
do $$
declare tbl text;
begin
  foreach tbl in array array['memory', 'tasks', 'identity'] loop
    execute format($f$
      drop policy if exists agent_self_scope on chance.%I;
      create policy agent_self_scope on chance.%I
        for all
        using (ecosystem.current_agent_slug() = 'chance')
        with check (ecosystem.current_agent_slug() = 'chance');
    $f$, tbl, tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Master (Overseer) grant.
--    The service_role already bypasses RLS; we ALSO grant explicit privileges
--    so CHANCE can read/write across current and future agent schemas.
-- ---------------------------------------------------------------------------
grant usage on schema ecosystem, chance to service_role;
grant all privileges on all tables    in schema ecosystem, chance to service_role;
grant all privileges on all sequences in schema ecosystem, chance to service_role;

-- Ensure future agent schemas/tables are auto-granted to the Overseer.
alter default privileges in schema chance grant all on tables    to service_role;
alter default privileges in schema chance grant all on sequences to service_role;

-- Scoped clients get table-level privileges; RLS still filters the rows.
grant usage on schema chance to anon, authenticated;
grant select, insert, update, delete on all tables in schema chance to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Seed the registry with Agent Zero.
-- ---------------------------------------------------------------------------
insert into ecosystem.agents (slug, display_name, role, is_overseer)
values ('chance', 'Chance', 'Master Overseer / System Orchestrator', true)
on conflict (slug) do update
  set display_name = excluded.display_name,
      role         = excluded.role,
      is_overseer  = excluded.is_overseer;

-- ============================================================================
--  TEMPLATE — provision a new sub-agent schema "<slug>".
--  Copy, replace <slug>, and run. RLS pins it to its own schema; the Overseer
--  (service_role) retains master access automatically via the grants above.
-- ============================================================================
--
--  create schema if not exists <slug>;
--  create table if not exists <slug>.memory (like chance.memory including all);
--  create table if not exists <slug>.tasks  (like chance.tasks  including all);
--  alter table <slug>.memory enable row level security;
--  alter table <slug>.tasks  enable row level security;
--  create policy agent_self_scope on <slug>.memory for all
--    using (ecosystem.current_agent_slug() = '<slug>')
--    with check (ecosystem.current_agent_slug() = '<slug>');
--  create policy agent_self_scope on <slug>.tasks for all
--    using (ecosystem.current_agent_slug() = '<slug>')
--    with check (ecosystem.current_agent_slug() = '<slug>');
--  grant usage on schema <slug> to service_role, anon, authenticated;
--  grant all on all tables in schema <slug> to service_role;
--  grant select, insert, update, delete on all tables in schema <slug> to anon, authenticated;
--  insert into ecosystem.agents (slug, display_name, role) values ('<slug>', '<Name>', '<Role>');
-- ============================================================================
