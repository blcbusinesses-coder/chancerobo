import path from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { ChanceAgent } from './agents/chance/ChanceAgent.js';
import { createChanceFrontendConfig } from './agents/chance/config.js';
import { GoogleServices } from './core/functions/google.js';
import { Vision } from './core/functions/vision.js';
import { zapierMCP } from './core/functions/mcp.js';
import { projector } from './core/functions/projector.js';
import { toolSpecs } from './core/tools.js';
import { TaskComplexity } from './core/types.js';

/**
 * HTTP API — the surface the WEB UI talks to.
 * ------------------------------------------
 * Lets the dashboard chat with Chance by text OR voice, with no Telegram.
 * Voice: the browser records from the mic (your Blue Snowball) and POSTs the
 * audio here; we transcribe (Whisper), run Chance, and return his text + a
 * spoken reply (ElevenLabs) the UI can play.
 *
 *   npm run server   (default http://localhost:8788)
 */
const PORT = Number(process.env.API_PORT || 8787);
const chance = new ChanceAgent(); // note: no .activate() — the Telegram bot owns polling

const app = express();
app.use(cors());
app.use(express.json());

// Serve generated speech clips so the UI can play them.
app.use('/media/audio', express.static(path.resolve('audio_cache')));

// Serve the built dashboard (Raspberry Pi kiosk). Checks ./public (bundled) and
// ./frontend/dist (running from source). Harmless on the desktop.
app.use(express.static(path.resolve('public')));
app.use(express.static(path.resolve('frontend/dist')));

const ext = (mime: string) =>
  mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'mp3';
const upload = multer({
  storage: multer.diskStorage({
    destination: tmpdir(),
    filename: (_req, file, cb) => cb(null, `ui_voice_${Date.now()}.${ext(file.mimetype)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const audioUrl = (p?: string) => (p ? `/media/audio/${path.basename(p)}` : undefined);

// ── Identity (theme/layout for the UI) ──────────────────────────────────────
app.get('/api/identity', (_req, res) => res.json(createChanceFrontendConfig()));

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    agent: 'chance',
    tools: toolSpecs().length,
    tiers: {
      big: chance.router.resolveModel(TaskComplexity.BIG),
      medium: chance.router.resolveModel(TaskComplexity.MEDIUM),
      small: chance.router.resolveModel(TaskComplexity.SMALL),
    },
  }),
);

// ── Text chat ────────────────────────────────────────────────────────────────
// body: { text: string, speak?: boolean }
app.post('/api/chat', async (req, res) => {
  try {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'missing text' });
    const speak = Boolean(req.body?.speak);

    // If the client disconnects (user pressed STOP), abort mid-task to save credits.
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) { console.log('[api/chat] 🛑 client stopped — aborting task'); ac.abort(); } });

    const result = await chance.run({ channel: speak ? 'voice' : 'api', text }, { signal: ac.signal });
    if (ac.signal.aborted) return; // client already gone
    res.json({
      text: result.text,
      modelUsed: result.modelUsed,
      complexity: result.complexity,
      audioUrl: audioUrl(result.audioPath),
      uiAction: (result as { uiAction?: unknown }).uiAction,
      uiActions: (result as { uiActions?: unknown }).uiActions,
      imageUrls: (result.imagePaths ?? []).map((p) => `/media/audio/${path.basename(p)}`),
    });
  } catch (e) {
    console.error('[api/chat]', (e as Error).message);
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── Voice chat (mic → transcribe → reply in voice) ───────────────────────────
// multipart form field: audio (the recorded blob)
app.post('/api/voice', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no audio uploaded (field name must be "audio")' });
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    const transcript = await chance.voice.transcribe(req.file.path);
    const result = await chance.run({ channel: 'voice', text: transcript }, { signal: ac.signal });
    if (ac.signal.aborted) return;
    res.json({
      transcript,
      text: result.text,
      modelUsed: result.modelUsed,
      complexity: result.complexity,
      audioUrl: audioUrl(result.audioPath),
      uiAction: (result as { uiAction?: unknown }).uiAction,
      uiActions: (result as { uiActions?: unknown }).uiActions,
    });
  } catch (e) {
    console.error('[api/voice]', (e as Error).message);
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── Projector channel (the projected screen polls this) ─────────────────────
app.get('/api/projector', (_req, res) => res.json(projector.get()));
app.post('/api/projector/clear', (_req, res) => { projector.clear(); res.json({ ok: true }); });
app.post('/api/projector/active', (req, res) => { projector.setActive(Boolean(req.body?.on)); res.json({ ok: true, active: projector.active() }); });

// ── Webcam vision (local Python service; no brain credits) ───────────────────
const vision = new Vision();

// Eye button on the dashboard: look through the webcam right now. Bypasses the
// brain entirely — pure local object detection — so it costs nothing.
app.post('/api/vision/see', async (_req, res) => {
  try {
    res.json(await vision.see());
  } catch (e) {
    res.status(503).json({ error: (e as Error).message });
  }
});

// Is the vision service up (and is the camera/hand-control on)?
app.get('/api/vision/status', async (_req, res) => {
  res.json({ service: await vision.health() });
});

// Toggle hand→cursor control from the UI.
app.post('/api/vision/hands', async (req, res) => {
  try {
    const on = Boolean(req.body?.on);
    res.json(on ? await vision.handsStart() : await vision.handsStop());
  } catch (e) {
    res.status(503).json({ error: (e as Error).message });
  }
});

// ── Multi-account Google ─────────────────────────────────────────────────────

// Start adding another Google account — returns the consent URL for the UI to open.
app.get('/api/google/auth-url', (_req, res) => {
  try {
    res.json({ url: new GoogleServices().authUrl() });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// OAuth callback — exchange the code, identify the account, store its token.
app.get('/oauth2/callback', async (req, res) => {
  const code = String(req.query.code || '');
  const err = req.query.error;
  const done = (msg: string) =>
    res.send(`<body style="font-family:system-ui;background:#050b18;color:#e6f1ff;text-align:center;padding:60px"><h2>${msg}</h2><p>You can close this tab.</p><script>setTimeout(()=>window.close(),1500)</script></body>`);
  if (err) return done(`❌ ${err}`);
  if (!code) return res.status(400).send('missing code');
  try {
    const tokens = await new GoogleServices().exchangeCode(code);
    if (!tokens.refresh_token) return done('⚠️ No refresh token — revoke access and retry.');
    const email = await new GoogleServices(tokens.refresh_token).whoami();
    await chance.db.table('google_accounts').upsert(
      { email, refresh_token: tokens.refresh_token, display_name: email, enabled: true },
      { onConflict: 'email' },
    );
    done(`✅ Added ${email}`);
  } catch (e) {
    console.error('[oauth callback]', (e as Error).message);
    done(`❌ ${(e as Error).message}`);
  }
});

// List accounts (primary from .env + extras from Supabase). Never returns tokens.
app.get('/api/google/accounts', async (_req, res) => {
  try {
    let primary = 'primary account';
    try { primary = await chance.google.whoami(); } catch { /* ignore */ }
    const { data } = await chance.db.table('google_accounts').select('email, display_name, enabled').order('added_at');
    const extras = ((data as any[]) || []).map((a) => ({ email: a.email, enabled: a.enabled, primary: false }));
    res.json({ accounts: [{ email: primary, enabled: true, primary: true }, ...extras] });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Enable/disable an account.
app.post('/api/google/accounts/toggle', async (req, res) => {
  try {
    const { email, enabled } = req.body || {};
    await chance.db.table('google_accounts').update({ enabled: Boolean(enabled) }).eq('email', String(email));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Remove an account.
app.delete('/api/google/accounts', async (req, res) => {
  try {
    await chance.db.table('google_accounts').delete().eq('email', String(req.body?.email));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── Settings persistence (Supabase) ──────────────────────────────────────────
app.get('/api/settings', async (_req, res) => {
  try {
    const { data } = await chance.db.table('settings').select('key, value');
    const out: Record<string, unknown> = {};
    for (const row of (data as any[]) || []) out[row.key] = row.value;
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body || {};
    await chance.db.table('settings').upsert({ key: String(key), value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── MiniMax usage / cost (no live balance API — computed from real token usage
//    + official pricing; seeded once from a balance the user tells us) ──────
app.get('/api/minimax/usage', async (_req, res) => {
  try {
    const { data: rows } = await chance.db.table('usage_log').select('cost_cents').eq('provider', 'minimax');
    const list = ((rows as { cost_cents: number }[]) || []);
    const totalCostCents = list.reduce((s, r) => s + Number(r.cost_cents || 0), 0);
    const taskCount = list.length;
    const avgCostCentsPerTask = taskCount ? totalCostCents / taskCount : 0;
    const { data: setting } = await chance.db.table('settings').select('value').eq('key', 'minimax_starting_balance_cents').maybeSingle();
    const startingBalanceCents = (setting as { value?: number } | null)?.value ?? null;
    const estimatedRemainingCents = startingBalanceCents != null ? startingBalanceCents - totalCostCents : null;
    res.json({ totalCostCents, taskCount, avgCostCentsPerTask, startingBalanceCents, estimatedRemainingCents });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Set/update the known real balance (from the MiniMax console) to seed the estimate.
app.post('/api/minimax/balance', async (req, res) => {
  try {
    const cents = Number(req.body?.cents);
    if (!Number.isFinite(cents)) return res.status(400).json({ error: 'cents must be a number' });
    await chance.db.table('settings').upsert({ key: 'minimax_starting_balance_cents', value: cents, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Connect Zapier MCP so its actions are in the toolset (non-blocking).
void zapierMCP.init();

app.listen(PORT, () => {
  console.log(`[server] C.H.A.N.C.E API on http://localhost:${PORT}`);
  console.log(`[server]   GET /api/identity  /api/health  /api/google/accounts  /api/settings  /api/minimax/usage`);
  console.log(`[server]   POST /api/chat  /api/voice  /api/google/accounts/toggle  /api/settings`);
});
