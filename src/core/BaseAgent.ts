import { ModelRouter } from './ModelRouter.js';
import { AgentDatabase } from './functions/database.js';
import { AgentBrowser } from './functions/browser.js';
import { VoiceEngine } from './functions/voice.js';
import { AgentTelegram } from './functions/telegram.js';
import { AgentIdentityModule } from './functions/identity.js';
import type { AgentDefinition, AgentResult, InboundMessage, TaskComplexity } from './types.js';

/**
 * THE CORE AGENT TEMPLATE
 * -----------------------
 * Every agent in the C.H.A.N.C.E Ecosystem extends this class and therefore
 * ships with all 5 Mandatory Agent Functions wired in:
 *
 *   1. db        — dedicated Supabase schema + RLS          (functions/database.ts)
 *   2. browser   — headless Puppeteer browser               (functions/browser.ts)
 *   3. voice     — Whisper STT + ElevenLabs TTS             (functions/voice.ts)
 *   4. telegram  — dedicated bot + webhook/polling          (functions/telegram.ts)
 *   5. identity  — frontend "look" config                   (functions/identity.ts)
 *
 * ...plus the tri-tier ModelRouter for all reasoning.
 */
export abstract class BaseAgent {
  readonly def: AgentDefinition;

  readonly router: ModelRouter;
  readonly db: AgentDatabase;
  readonly browser: AgentBrowser;
  readonly voice: VoiceEngine;
  readonly telegram: AgentTelegram;
  readonly identity: AgentIdentityModule;

  constructor(def: AgentDefinition, router?: ModelRouter) {
    this.def = def;
    this.router = router ?? new ModelRouter();

    // #1 Dedicated Supabase tables (schema == slug), RLS-aware.
    this.db = new AgentDatabase(def.identity.slug, def.permissions);
    // #2 Headless browser.
    this.browser = new AgentBrowser();
    // #3 Voice engine.
    this.voice = new VoiceEngine(def.voiceId);
    // #4 Dedicated Telegram bot.
    this.telegram = new AgentTelegram(def.telegramToken, def.identity.slug);
    // #5 UI identity.
    this.identity = new AgentIdentityModule(def.identity);
  }

  /** The persona/system prompt injected into every model call. */
  get systemPrompt(): string {
    return this.def.personaPrompt;
  }

  /**
   * THE EXECUTION LOOP.
   * Normalizes any inbound message (transcribing audio if present), routes it
   * through the tri-tier model, persists the exchange to memory, and optionally
   * returns synthesized speech.
   */
  async run(input: InboundMessage): Promise<AgentResult> {
    let text = input.text;

    // Voice-in: transcribe first.
    if (input.audioPath) {
      text = await this.voice.transcribe(input.audioPath);
    }

    const routed = await this.router.route(text, { system: this.systemPrompt });

    // Persist the turn to this agent's dedicated schema.
    await this.db.remember('user', text).catch((e) => console.warn('[memory] user turn not saved:', e.message));
    await this.db
      .remember('assistant', routed.text, { model: routed.model, complexity: routed.complexity })
      .catch((e) => console.warn('[memory] assistant turn not saved:', e.message));

    const result: AgentResult = {
      text: routed.text,
      modelUsed: routed.model,
      complexity: routed.complexity,
    };

    // Voice-out for voice-originated messages.
    if (input.channel === 'voice' || input.audioPath) {
      result.audioPath = await this.voice.speak(routed.text).catch(() => undefined) as string | undefined;
    }

    return result;
  }

  /** Boot the agent's channels (Telegram) and bind them to the execution loop. */
  activate(): void {
    this.telegram.start(async (msg) => {
      const res = await this.run(msg);
      return { text: res.text, audioPath: res.audioPath };
    });
    console.log(`[${this.def.identity.slug}] Agent activated. Model tiers: ` +
      `BIG=${this.router.resolveModel('BIG' as TaskComplexity)} ` +
      `MEDIUM=${this.router.resolveModel('MEDIUM' as TaskComplexity)} ` +
      `SMALL=${this.router.resolveModel('SMALL' as TaskComplexity)}`);
  }

  /** Graceful shutdown of long-lived resources. */
  async shutdown(): Promise<void> {
    await this.telegram.stop();
    await this.browser.close();
  }
}
