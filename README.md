# C.H.A.N.C.E Ecosystem

A multi-agent AI system orchestrated by the master agent **CHANCE**. This repo is the
**foundation**: the core agent template (5 Mandatory Functions), tri-tier Claude model
routing, and Agent Zero — CHANCE — instantiated.

## Architecture

```
src/
├── config/env.ts                 # validated environment access
├── core/
│   ├── types.ts                  # shared contracts (AgentDefinition, TaskComplexity, …)
│   ├── ModelRouter.ts            # TRI-TIER routing (Opus / Sonnet / Haiku)
│   ├── BaseAgent.ts              # the template — composes all 5 functions
│   └── functions/
│       ├── database.ts           # #1 dedicated Supabase schema + RLS
│       ├── browser.ts            # #2 headless Puppeteer browser
│       ├── voice.ts              # #3 Whisper (STT) + ElevenLabs (TTS)
│       ├── telegram.ts           # #4 dedicated Telegram bot
│       └── identity.ts           # #5 frontend "look" config
├── agents/chance/                # AGENT ZERO
│   ├── prompt.ts                 # persona / system prompt
│   ├── config.ts                 # AgentDefinition (Overseer permissions)
│   ├── ChanceAgent.ts            # extends BaseAgent + cross-schema / delegate
│   └── boot.ts                   # entrypoint: `npm run chance`
└── index.ts                      # public exports

supabase/migrations/
└── 0001_chance_schema_and_rls.sql  # schema, RLS policies, Overseer grants, registry

scripts/migrate.ts                 # applies migrations via service-role key
```

## The 5 Mandatory Agent Functions

Every agent extends `BaseAgent` and inherits all five:

1. **Dedicated Supabase tables** — one schema per agent (`slug`), RLS pins a sub-agent
   to its own schema. CHANCE uses the service-role key → master access to **all** schemas.
2. **Headless browser** — navigate, fill, click, extract rendered DOM.
3. **Voice engine** — Whisper speech-to-text in, ElevenLabs text-to-speech out.
4. **Dedicated Telegram bot** — its own token; messages route into that agent's loop.
5. **Custom UI identity** — name, theme, avatar, and layout for the web dashboard.

## Tri-Tier Model Routing

| Tier   | Use case                                               | Model                          |
|--------|--------------------------------------------------------|--------------------------------|
| BIG    | complex logic, code gen, architecture, planning        | `claude-opus-4-8`              |
| MEDIUM | conversation, orchestration, data processing           | `claude-sonnet-5`              |
| SMALL  | browser nav, scraping, classification, UI updates      | `claude-haiku-4-5-20251001`    |

`ModelRouter.classify()` picks a tier heuristically; pass `complexity` to force one.
Override model ids via `MODEL_BIG` / `MODEL_MEDIUM` / `MODEL_SMALL` in `.env`.

## Quick start

```bash
npm install
cp .env.example .env          # then fill in real keys
npm run typecheck             # verify the scaffold compiles
```

Provision the database (either run `supabase/migrations/0001_*.sql` in the Supabase SQL
editor, or use the runner):

```bash
npm run db:migrate
```

Boot Agent Zero:

```bash
npm run chance
```

Without an `ANTHROPIC_API_KEY` the boot self-test is skipped but the agent still starts.

## Adding a new agent

1. Create `src/agents/<slug>/config.ts` with an `AgentDefinition` (`overseer: false`).
2. Subclass `BaseAgent`.
3. Add a migration cloning the **TEMPLATE** block at the bottom of `0001_*.sql`.
4. Give it its own `TELEGRAM_BOT_TOKEN_<SLUG>` and ElevenLabs voice id.

> ⚠️ **Security:** the service-role key grants master DB access and must only ever be
> used server-side by CHANCE. Never ship it to a browser or a sub-agent.
