# C.H.A.N.C.E Ecosystem — Project Brief

> **Read this first.** This document is the single source of truth for what we're
> building. It's written so another engineer or AI agent (e.g. in an IDE like
> Antigravity) can pick up the project — especially to build the **web UI** — without
> prior context.

---

## 1. What we're building

A **multi-agent AI system** for the user (Beckitt). Every agent is spawned from one
shared template and is a fully autonomous operator with its own database, browser,
voice, Telegram bot, and visual identity. They're all coordinated by a master agent.

**Agent Zero is `Chance`** (he/him) — the master overseer. Persona: J.A.R.V.I.S./Friday —
dedicated, brutally honest, dry-witted, zero fluff. His job is flawless execution and
making Beckitt "rich, efficient, and technologically unstoppable."

The **backend scaffold is built and working** (Node.js/TypeScript, ESM). The **web
dashboard UI is the next thing to build** — that's likely why you're reading this.

---

## 2. Current status (what's live vs. what's left)

| Capability | Module | Status |
|---|---|---|
| 🧠 Reasoning — tri-tier Claude routing | `src/core/ModelRouter.ts` | ✅ **live** (real API calls work) |
| 🔧 **Tool-use** (agent calls its own capabilities) | `src/core/tools.ts` + `BaseAgent.run()` | ✅ **live** — 8 tools, wired into every channel |
| 🗄️ Memory always-on (auto load + save per turn) | `BaseAgent.run()` + `database.ts` | ✅ **live** |
| 🗣️ Voice out — ElevenLabs TTS ("George") | `src/core/functions/voice.ts` | ✅ **live** |
| 👂 Voice in — Whisper STT | `src/core/functions/voice.ts` | ⏳ needs `OPENAI_API_KEY` |
| 🌐 Headless browser + visible mode + CAPTCHA hand-off | `src/core/functions/browser.ts` | ✅ **live** |
| 📧📅📁 Google (Gmail/Calendar/Drive/Docs/Sheets/YouTube) | `src/core/functions/google.ts` | ✅ **live** (OAuth connected as mrchancelowe@gmail.com) |
| 📺 YouTube channel | — | ⏳ channel must be created manually |
| 💬 Telegram bot (long-polling) | `src/core/functions/telegram.ts` | ⏳ needs bot token |
| 🎨 UI identity / theme config | `src/core/functions/identity.ts` | ✅ contract ready |
| 🗄️ Memory — Supabase per-agent schema + RLS | `src/core/functions/database.ts` + `supabase/migrations/` | ⏳ needs Supabase project + migration run |
| 🖥️ **Web dashboard UI** | `dashboard/index.html` (static demo only) | 🔨 **BUILD THIS** |
| 🔌 **HTTP API for the UI** | — | 🔨 **BUILD THIS** (see §6) |

---

## 3. Architecture

```
src/
├── config/env.ts                # validated env access (see §7)
├── core/
│   ├── types.ts                 # AgentDefinition, AgentIdentity, TaskComplexity, InboundMessage, AgentResult
│   ├── ModelRouter.ts           # tri-tier Claude routing
│   ├── BaseAgent.ts             # the template — composes all 5 functions + execution loop
│   └── functions/
│       ├── database.ts          # #1 Supabase schema + RLS (lazy client)
│       ├── browser.ts           # #2 Puppeteer: headless + visible + captcha hand-off
│       ├── voice.ts             # #3 Whisper in / ElevenLabs out
│       ├── telegram.ts          # #4 per-agent bot (long-polling or webhook)
│       ├── identity.ts          # #5 frontend "look" config  ← KEY FOR THE UI
│       └── google.ts            # Gmail/Calendar/Drive/Docs/Sheets/YouTube via one OAuth client
├── agents/chance/
│   ├── prompt.ts                # persona/system prompt
│   ├── config.ts                # CHANCE_DEFINITION + createChanceFrontendConfig()
│   ├── ChanceAgent.ts           # extends BaseAgent; adds inspectAgent() + delegate()
│   └── boot.ts                  # `npm run chance` — boots + activates Telegram
└── index.ts                     # public exports (barrel)

scripts/       demo.ts, say.ts, voices.ts, browser-console.ts, google-auth.ts, google-whoami.ts, migrate.ts
dashboard/     index.html        # static demo of the console — the real UI supersedes this
supabase/migrations/             # schema + RLS + Overseer grants
```

### The 5 Mandatory Agent Functions
Every agent extends `BaseAgent` and inherits all five:
1. **Dedicated Supabase tables** — one Postgres schema per agent (named by slug); RLS pins a
   sub-agent to its own schema. Chance uses the **service-role key** → master access to all schemas.
2. **Headless browser** — navigate/fill/click/extract; can pop a **visible** window on demand;
   auto-detects CAPTCHAs and hands off to a human, preserving session via a persistent profile.
3. **Voice** — Whisper speech-to-text in, ElevenLabs text-to-speech out.
4. **Telegram bot** — its own token; a message to that bot routes into that agent's execution loop.
5. **UI identity** — name, theme (palette), avatar, layout components for the dashboard.

### Tri-tier model routing (`ModelRouter`)
| Tier | For | Model id |
|---|---|---|
| BIG | architecture, code-gen, planning | `claude-opus-4-8` |
| MEDIUM | conversation, orchestration | `claude-sonnet-5` |
| SMALL | browser/scrape/classify/UI | `claude-haiku-4-5-20251001` |

`classify(text)` picks a tier heuristically; callers can force one. Model ids are overridable
via `MODEL_BIG` / `MODEL_MEDIUM` / `MODEL_SMALL`.

---

## 4. Chance's visual identity (use these exact values in the UI)

Source of truth: `src/agents/chance/config.ts` → `createChanceFrontendConfig()`.

```jsonc
{
  "name": "Chance",
  "slug": "chance",
  "role": "Master Overseer / System Orchestrator",
  "avatarUrl": "https://cdn.chance.beckitt.ai/avatars/chance.png", // placeholder — swap for a real asset
  "theme": {
    "primary":    "#00E5FF",  // electric cyan — HUD signal color
    "secondary":  "#0A1929",  // deep navy shell
    "accent":     "#FFB300",  // amber highlight
    "background": "#050B18",  // near-black
    "foreground": "#E6F1FF"   // off-white text
  },
  "layout": ["header", "chat", "agent-roster", "task-queue", "telemetry", "voice-console"],
  "cssVars": {
    "--agent-primary": "#00E5FF", "--agent-secondary": "#0A1929",
    "--agent-accent": "#FFB300",  "--agent-bg": "#050B18", "--agent-fg": "#E6F1FF"
  }
}
```

**Design language:** dark, cinematic, JARVIS/Friday console. Cyan primary, amber for
alerts/highlights, glassy panels, subtle glow. `dashboard/index.html` is a static reference
mock of the intended look — treat it as a starting point, not the final UI.

**`layout` components the dashboard should render:**
- `header` — Chance wordmark, role, online status, avatar
- `chat` — the execution console (send messages, see replies + which model tier answered)
- `agent-roster` — Chance + slots for future sub-agents
- `task-queue` — delegated tasks and their status
- `telemetry` — live stats (agents online, model tiers, functions armed)
- `voice-console` — mic (Whisper in) + playback (ElevenLabs out)

---

## 5. The agent execution loop (what the UI drives)

`BaseAgent.run(input: InboundMessage): Promise<AgentResult>`:
1. If `audioPath` present → transcribe (Whisper) to text.
2. Load recent memory from Supabase → inject as context (always-on memory).
3. Run the **agentic tool-use loop**: the tiered Claude model may call tools
   (`src/core/tools.ts` — browse, calendar r/w, email r/w, YouTube, memory save/search);
   results feed back until it produces a final answer (max 6 tool steps).
4. Persist the turn to his Supabase `memory` table.
5. If the message was voice-originated → synthesize a spoken reply (ElevenLabs).

**Every channel calls `run()`**, so tools + memory are automatic on Telegram, voice, and
the web API you build — there is no code path that skips them. To add an ability: add a
capability method, then register a tool in `src/core/tools.ts`.

```ts
InboundMessage { channel: 'telegram'|'voice'|'api'; chatId?; text; audioPath?; meta? }
AgentResult    { text; modelUsed; complexity; audioPath? }
```

---

## 6. The HTTP API (BUILT — this is what the UI calls)

`src/server.ts` — run with **`npm run server`** (default `http://localhost:8788`). CORS is open
for local dev. It wraps `ChanceAgent` (text + **voice**), so the UI never touches Telegram.

| Method & path | Body / form | Returns |
|---|---|---|
| `GET  /api/identity` | — | theme/layout JSON from §4 |
| `GET  /api/health` | — | `{ ok, tools, tiers }` |
| `POST /api/chat` | `{ text, speak? }` | `{ text, modelUsed, complexity, audioUrl?, imageUrls[] }` |
| `POST /api/voice` | multipart, field **`audio`** | `{ transcript, text, modelUsed, audioUrl }` |
| `GET  /media/audio/:file` | — | the spoken-reply mp3 to play |

Every call runs the full agent loop — **tools + memory included**. `audioUrl` is a spoken
(ElevenLabs/George) reply the UI plays via an `<audio>` element.

### Wiring the mic (the user's Blue Snowball) in the browser
The mic is captured **client-side** — the Snowball just needs to be the OS default input.
Record with `MediaRecorder`, POST the blob to `/api/voice`, play the returned `audioUrl`:

```js
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const rec = new MediaRecorder(stream); const chunks = [];
rec.ondataavailable = e => chunks.push(e.data);
rec.onstop = async () => {
  const fd = new FormData();
  fd.append('audio', new Blob(chunks, { type: 'audio/webm' }), 'mic.webm');
  const r = await fetch('http://localhost:8788/api/voice', { method: 'POST', body: fd }).then(r => r.json());
  showTranscript(r.transcript); showReply(r.text);
  new Audio('http://localhost:8788' + r.audioUrl).play();   // Chance speaks back
};
rec.start(); /* ...user talks... */ // rec.stop() on release
```

**Browser control also has a live HTTP API** (`npm run browser`, `http://127.0.0.1:8790`):
`GET /open?url=`, `/screenshot`, `/status`, `/close`. The UI's browser panel can call these.

**Recommended stack:** whatever Antigravity prefers (React/Vite is fine). Point it at the API
above, use the exact `cssVars` from §4, and it *is* Chance — not a generic dashboard.

---

## 7. Environment (`.env`)

Copy `.env.example` → `.env`. **Secrets go in `.env` only** (gitignored); `.env.example` is a
committed template — never put real keys there.

```
ANTHROPIC_API_KEY          # ✅ set — tri-tier routing
MODEL_BIG / MEDIUM / SMALL # model id overrides (defaults are correct)
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY   # ⏳ memory
ELEVENLABS_API_KEY         # ✅ set — voice out
ELEVENLABS_VOICE_ID_CHANCE # ✅ "George" (JBFqnCBsd6RMkjVDRZzb)
OPENAI_API_KEY             # ⏳ Whisper voice-in
TELEGRAM_BOT_TOKEN_CHANCE  # ⏳ his bot (long-polling; no webhook needed)
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI / GOOGLE_REFRESH_TOKEN  # ✅ connected
GOOGLE_SCOPES              # gmail.modify, calendar, drive, youtube
PORT=8787
```

---

## 8. Run it

```bash
npm install
npm run demo          # offline: tri-tier routing + identity (no keys needed)
npm run chance        # boot Chance (Telegram polling + live self-test)
npm run say -- "text" # hear him in George's voice
npm run browser       # visible browser control server (port 8790)
npm run google:whoami # confirm Google connection
```

Provision memory: run `supabase/migrations/0001_chance_schema_and_rls.sql` in the Supabase SQL
editor (or `npm run db:migrate` with the `exec_sql` RPC), then fill the `SUPABASE_*` env vars.

---

## 9. TL;DR for the UI builder

Build a dark, JARVIS-style **dashboard** for **Chance** using the exact palette in §4 and the six
`layout` components. Add a small **Express/Fastify API** (§6) wrapping `ChanceAgent` so the UI can
chat with him, show his identity, play his voice, and (later) read his memory. The browser panel can
talk to the existing control server on `:8790`. Keep it feeling like a real product console — this
is a personal AI operator, not a demo.
