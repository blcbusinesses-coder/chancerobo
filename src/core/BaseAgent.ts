import type Anthropic from '@anthropic-ai/sdk';
import { ModelRouter } from './ModelRouter.js';
import { AgentDatabase } from './functions/database.js';
import { AgentBrowser } from './functions/browser.js';
import { VoiceEngine } from './functions/voice.js';
import { AgentTelegram } from './functions/telegram.js';
import { AgentIdentityModule } from './functions/identity.js';
import { GoogleServices } from './functions/google.js';
import { setVoice } from './functions/voice.js';
import { toolSpecs, toolHandler } from './tools.js';
import { converse } from './brain.js';
import { cleanForMarkdown } from './functions/text.js';
import { minimaxCostCents } from './pricing.js';
import { env } from '../config/env.js';
import type { AgentDefinition, AgentResult, InboundMessage, TaskComplexity } from './types.js';

/** Max tool round-trips before we force a final answer (runaway guard). */
const MAX_TOOL_STEPS = 6;
/** How many past memory turns to load for continuity. */
const MEMORY_WINDOW = 12;

/**
 * THE CORE AGENT TEMPLATE
 * -----------------------
 * Every agent extends this and ships with all 5 Mandatory Functions PLUS:
 *   - the tri-tier ModelRouter
 *   - Google Workspace access (Gmail/Calendar/Drive/YouTube)
 *   - an agentic TOOL-USE loop + ALWAYS-ON MEMORY, both wired into run()
 *
 * Because Telegram, voice, and the web API all call run(), tools and memory are
 * automatic on every channel — there is no path that skips them.
 */
export abstract class BaseAgent {
  readonly def: AgentDefinition;

  readonly router: ModelRouter;
  readonly db: AgentDatabase;
  readonly browser: AgentBrowser;
  readonly voice: VoiceEngine;
  readonly telegram: AgentTelegram;
  readonly identity: AgentIdentityModule;
  readonly google: GoogleServices;

  /** Files a tool produced this turn (e.g. screenshots) to send back to the user. */
  private pendingImages: string[] = [];
  /** UI actions to display this turn. Tools assign `pendingUIAction`, which PUSHES
   *  here — so a single reply can open MANY popups (one per visual tool call). */
  private _uiActions: any[] = [];
  set pendingUIAction(a: any) { if (a != null) this._uiActions.push(a); }
  get pendingUIAction(): any { return this._uiActions[this._uiActions.length - 1]; }
  get pendingUIActions(): any[] { return this._uiActions; }

  constructor(def: AgentDefinition, router?: ModelRouter) {
    this.def = def;
    this.router = router ?? new ModelRouter();
    this.db = new AgentDatabase(def.identity.slug, def.permissions);
    this.browser = new AgentBrowser();
    this.voice = new VoiceEngine(def.voiceId);
    this.telegram = new AgentTelegram(def.telegramToken, def.identity.slug);
    this.identity = new AgentIdentityModule(def.identity);
    this.google = new GoogleServices();

    // Restore a previously-chosen voice (best-effort; falls back to the default).
    const db = this.db;
    (async () => {
      try {
        const { data } = await db.table('settings').select('value').eq('key', 'tts_voice').maybeSingle();
        const value = (data as { value?: string } | null)?.value;
        if (value) setVoice(value);
      } catch { /* ignore — default voice stays active */ }
    })();
  }

  /** Tools call this to attach a file (e.g. a screenshot) to the reply. */
  attachImage(filePath: string): void {
    this.pendingImages.push(filePath);
  }

  /** Resolve a GoogleServices for a specific account email; defaults to the primary (.env) account. */
  async googleFor(email?: string): Promise<GoogleServices> {
    if (!email) return this.google;
    const { data } = await this.db
      .table('google_accounts')
      .select('refresh_token')
      .eq('email', email)
      .eq('enabled', true)
      .maybeSingle();
    if (!(data as { refresh_token?: string })?.refresh_token) {
      throw new Error(`No enabled Google account found for "${email}". Add it in Settings first.`);
    }
    return new GoogleServices((data as { refresh_token: string }).refresh_token);
  }

  /** Base persona, plus live context (date + available tools note). */
  get systemPrompt(): string {
    const today = new Date().toISOString();
    return (
      this.def.personaPrompt +
      `\n\n[Runtime] Today is ${today}. You have real tools — use them to actually DO things ` +
      `rather than describing what you would do. When you take an action, report the concrete result. Your capabilities:` +
      `\n- Google (your own account): Gmail read/send, Calendar list/create, Drive search/read, Docs create/read, ` +
      `Sheets create/read/append, Tasks list/add, Contacts search, YouTube channel + video search, ` +
      `Cloud Vision (analyze images/screenshots: OCR, labels, objects, faces), Apps Script (write automations).` +
      `\n- Web: web_search (a real search API — your DEFAULT for looking anything up; returns a direct answer + sources, no browser needed), 'browse' to read a specific URL, plus a full interactive Chrome/Edge you drive (navigate, click, type, screenshot).` +
      `\n- This computer: open apps/files/URLs, list/find/read files, run commands, screenshot the screen.` +
      `\n- Fire TV (via ADB): launch apps, remote keys, type, open videos.` +
      `\n- Gemini: ask_gemini (a second opinion / huge-context reasoning) and gemini_generate_image (Imagen).` +
      `\n- Image/video generation: generate_image, generate_video, animate_image (Kling); gemini_generate_image (Imagen).` +
      `\n- Stocks: show_stock (live price + change + price chart over a range like 1d/1m/1y/max) and stock_quote (fast price).` +
      `\n- Spotify: spotify_play (play/resume a song, artist, or playlist), spotify_control (pause/next/previous/volume/queue), spotify_now_playing, spotify_devices (list phone/desktop/speakers), spotify_transfer (move playback to a device by name, e.g. "play on my phone"). Requires the Spotify app open + Premium.` +
      `\n- Webcam vision (FREE, local — no credits): camera_see (look through the webcam and detect what's there), hand_control (start/stop hand-tracking mouse control — index finger points, pinch clicks), configure_motion_control (which monitor/region it controls + sensitivity). Prefer camera_see for "what do you see" instead of paid image tools.` +
      `\n- Smart outlets (Geeni plugs, local — no credits): outlet_control (turn a plug on/off, toggle, or check status) and list_outlets. Use for "turn on/off the <name>".` +
      `\n- Media: play_video (play a YouTube video or URL fullscreen on the screen via the local player — no browser) and stop_video. Use for "play X on YouTube".` +
      `\n- News: show_news (headlines/search as a popup list) and show_article (pull up a full article — headline, source, readable text — in a popup). Keyless.` +
      `\n- Saved values: save_value (remember a named fact like "personal email"), list_saved_values, forget_value. When the user refers to a saved value by name, use it (e.g. email "my personal email" → send to the saved address).` +
      `\n- Voice: change_voice switches your own speaking voice between presets (1 Ryan/default, 2 Guy, 3 Christopher).` +
      `\n- Messaging: send Telegram messages (defaults to the owner).` +
      `\n- Zapier (8,000+ apps, no extra keys): any tool named "zapier_..." runs a connected app action — Slack, SMS, Notion, Airtable, GitHub, Webhooks, and more. Use them to actually DO things in those apps. If the user says they just enabled a new app in Zapier, call zapier_actions to refresh the list first.` +
      `\n\n[Common sense] Pick the SIMPLEST tool that answers the question. Order of preference: a direct API ` +
      `(e.g. youtube_channel_stats for a creator's sub count, google/calendar tools) > web_search (for any look-up) ` +
      `> the full interactive browser (open_browser). Only open the interactive browser when the task genuinely ` +
      `needs clicking, logging in, or multi-step navigation. Never manually navigate a browser to look up a public ` +
      `fact you can search or fetch. Answer directly, cite the number, and use a show_* view when it helps.` +
      `\n\n[Browser modes] Default to 'browse' (headless/invisible; it pops a window only for a CAPTCHA, then vanishes). ` +
      `If the user says "in a visible browser" / "in MY browser" / "on my computer" → use open_browser with which='mine' ` +
      `(their real Chrome/Edge + logins). If the user says "in YOUR browser and show me" → open_browser with which='agent'. ` +
      `Only make a browser visible when the user asks for it or a CAPTCHA requires it.` +
      `\n\n[UI display] You have a visual panel (in the desktop app these become floating popups on the user's screen — and you can open MANY at once by calling several show_* tools in one reply). Prefer visuals over prose for structured output: show_chart ` +
      `(trends/comparisons), show_code (code), show_document (Markdown reports), show_table (tabular), show_checklist (to-dos), ` +
      `show_3d (a rotating 3D object), show_gauge (a single metric dial), show_gallery (image grid), show_countdown (live timer), ` +
      `show_qr (QR for a link/text), and show_embed (embed a LIVE web page, YouTube video, or a Google Doc/Sheet/Slides you made — pass its shareable/preview URL). ` +
      `Call the show_* tool AND give a short spoken summary.` +
      `\n\n[Brain & cost] You run on the MiniMax brain by default — it's cheap, so use it freely. Claude Sonnet is the ` +
      `premium option, reserved for genuinely critical work. NEVER switch to Claude on your own. If a task seems to truly ` +
      `need Claude-level intelligence, briefly say so and ASK the user to approve using it ("This is important — want me ` +
      `to use Claude for it? It costs more.") and wait. The user can also just tell you to "use Claude" for a task.` +
      `\n\n[Formatting] Write replies in plain text or GitHub-flavored Markdown ONLY. NEVER output raw HTML tags ` +
      `(<p>, <br>, <div>, <strong>, <ul>, <li>, &nbsp;, etc.) — they show up as ugly literal text on Telegram and in the UI.` +
      `\n\n[Paid extras — opt-in only] Generating images/video (generate_image, generate_video, gemini_generate_image) ` +
      `and calling Gemini (ask_gemini) cost money — only do them when the user EXPLICITLY asks (e.g. "generate an image", ` +
      `"make a video", "use Gemini"). Never generate media or call Gemini unprompted.`
    );
  }

  /**
   * THE EXECUTION LOOP — one entry point for every channel.
   * 1. transcribe audio (if any)  2. load memory for continuity
   * 3. run the tool-use loop      4. persist the turn  5. optional voice-out
   */
  async run(input: InboundMessage, opts: { signal?: AbortSignal } = {}): Promise<AgentResult> {
    let text = input.text;
    if (input.audioPath) {
      text = await this.voice.transcribe(input.audioPath).catch((e) => {
        console.warn('[voice] transcription failed:', e.message);
        return input.text || '[unintelligible audio]';
      });
    }

    // Always-on memory: pull recent turns as context.
    const memoryDigest = await this.recentMemoryDigest();
    const savedDigest = await this.savedValuesDigest();
    let system = this.systemPrompt;
    if (savedDigest) system += `\n\n[Saved values — facts the user told you to remember. When they refer to one by name (e.g. "my personal email"), use the value here. Don't ask again.]\n${savedDigest}`;
    if (memoryDigest) system += `\n\n[Recent memory — for continuity across conversations]\n${memoryDigest}`;

    this.pendingImages = [];
    this._uiActions = [];
    const specs = toolSpecs();

    // FAILSAFE: the cheap MiniMax brain handles everything by default. Claude
    // Sonnet is used ONLY when the user explicitly asks for it (or the global
    // override is set). Chance never auto-switches — his persona tells him to
    // recommend Claude and WAIT for the user's yes instead.
    const asksClaude =
      /\b(use|using|with|via|switch to|run (?:this )?on)\s+(claude|sonnet)\b|\bclaude sonnet\b|the (good|smart|best|real|expensive) (model|brain)|be extra (careful|smart|thorough)/i.test(
        text,
      );
    const useClaude = env.brain.provider === 'anthropic' || asksClaude;

    const conv = await converse({
      system,
      userText: text,
      tools: specs,
      anthropic: this.router.raw,
      useClaude,
      signal: opts.signal,
      execTool: async (name, inp) => {
        const handler = toolHandler(name);
        return handler ? handler(inp as Record<string, unknown>, { agent: this }) : { error: `unknown tool: ${name}` };
      },
      onToolCall: (name, inp) => console.log(`[${this.def.identity.slug}] 🔧 ${name}(${JSON.stringify(inp).slice(0, 120)})`),
    });

    // Strip any stray HTML the model emitted; keep Markdown for channels that
    // render it. Telegram flattens further to plain text on its own send path.
    const finalText = cleanForMarkdown(conv.text);
    const model = conv.model;
    const toolsUsed = conv.toolsUsed;
    const complexity = this.router.classify(text);

    // User pressed stop mid-task: log what we DID spend, then bail (no voice, no reply work).
    if (opts.signal?.aborted) {
      if (conv.provider === 'minimax') {
        const cents = minimaxCostCents(conv.usage.promptTokens, conv.usage.completionTokens);
        await this.db.table('usage_log').insert({ provider: 'minimax', model, prompt_tokens: conv.usage.promptTokens, completion_tokens: conv.usage.completionTokens, cost_cents: cents }).then(() => {}, () => {});
      }
      return { text: finalText, modelUsed: model, complexity };
    }

    // Track spend (best-effort) — MiniMax has no live balance API, so cost is
    // computed from real token usage + official pricing and logged for the UI.
    if (conv.provider === 'minimax') {
      const costCents = minimaxCostCents(conv.usage.promptTokens, conv.usage.completionTokens);
      try {
        await this.db
          .table('usage_log')
          .insert({ provider: 'minimax', model, prompt_tokens: conv.usage.promptTokens, completion_tokens: conv.usage.completionTokens, cost_cents: costCents });
      } catch (e) {
        console.warn('[usage] not logged:', (e as Error).message);
      }
    }

    // Persist the turn (best-effort).
    await this.db.remember('user', text).catch((e) => console.warn('[memory] user turn not saved:', e.message));
    await this.db
      .remember('assistant', finalText, { model, complexity, tools: toolsUsed })
      .catch((e) => console.warn('[memory] assistant turn not saved:', e.message));

    const result: AgentResult = { text: finalText, modelUsed: model, complexity };
    if (this.pendingImages.length) result.imagePaths = [...this.pendingImages];
    if (this._uiActions.length) {
      result.uiAction = this._uiActions[0]; // back-compat (first)
      (result as { uiActions?: any[] }).uiActions = [...this._uiActions];
    }

    // Voice-in → voice-out, UNLESS the message explicitly asks for a text reply.
    const wantsText =
      /\b(in|as)\s+text\b|\btext\s+(only|please|back|reply|response)\b|\bno\s+voice\b|\bin\s+writing\b|\brespond\s+in\s+text\b|\btype\s+it\b|\bwrite\s+(it|back)\b/i.test(
        text,
      );
    const voiceOriginated = input.channel === 'voice' || Boolean(input.audioPath);
    if (voiceOriginated && !wantsText) {
      result.audioPath = (await this.voice.speak(finalText).catch((e) => {
        console.warn('[voice] speak failed:', e.message);
        return undefined;
      })) as string | undefined;
    }
    return result;
  }

  /** Saved values rendered as "label: value" lines for the system prompt. */
  private async savedValuesDigest(): Promise<string> {
    try {
      const rows = await this.db.savedValues();
      if (!rows.length) return '';
      return rows.map((r) => `- ${r.label}: ${r.value}`).join('\n');
    } catch {
      return '';
    }
  }

  /** Recent memory rendered as a compact transcript for the system prompt. */
  private async recentMemoryDigest(): Promise<string> {
    try {
      const rows = await this.db.recall(MEMORY_WINDOW);
      if (!rows.length) return '';
      // recall() returns newest-first; reverse to chronological.
      return rows
        .slice()
        .reverse()
        .map((r) => `${r.role}: ${String(r.content).slice(0, 300)}`)
        .join('\n');
    } catch {
      return '';
    }
  }

  /** Boot the agent's channels (Telegram) and bind them to the execution loop. */
  activate(): void {
    this.telegram.start(async (msg) => {
      const res = await this.run(msg);
      return { text: res.text, audioPath: res.audioPath, imagePaths: res.imagePaths };
    });
    console.log(
      `[${this.def.identity.slug}] Agent activated. Model tiers: ` +
        `BIG=${this.router.resolveModel('BIG' as TaskComplexity)} ` +
        `MEDIUM=${this.router.resolveModel('MEDIUM' as TaskComplexity)} ` +
        `SMALL=${this.router.resolveModel('SMALL' as TaskComplexity)} · ` +
        `${toolSpecs().length} tools armed`,
    );
  }

  /** Graceful shutdown of long-lived resources. */
  async shutdown(): Promise<void> {
    await this.telegram.stop();
    await this.browser.close();
  }
}
