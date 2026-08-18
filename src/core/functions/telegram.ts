import { tmpdir } from 'node:os';
import TelegramBot from 'node-telegram-bot-api';
import { env } from '../../config/env.js';
import { cleanForPlain } from './text.js';
import type { InboundMessage } from '../types.js';

/**
 * MANDATORY FUNCTION #4 — DEDICATED TELEGRAM BOT
 * ----------------------------------------------
 * Every agent owns its own bot token. Texting a specific bot routes the input
 * straight into that agent's execution loop via the `onMessage` handler.
 *
 * Transport:
 *   - If TELEGRAM_WEBHOOK_BASE_URL is set, registers a webhook.
 *   - Otherwise falls back to long-polling (great for local dev).
 */
export type MessageHandler = (
  msg: InboundMessage,
) => Promise<{ text: string; audioPath?: string; imagePaths?: string[] }>;

export class AgentTelegram {
  private bot: TelegramBot | null = null;
  private token: string;
  private slug: string;

  constructor(token: string, slug: string) {
    this.token = token;
    this.slug = slug;
  }

  get enabled(): boolean {
    const t = this.token.trim();
    // Reject empty and the obvious .env.example placeholder token.
    return t.length > 0 && !t.startsWith('1234567890:') && !t.includes('AAAAAAAAAA');
  }

  /** Wire the bot to the agent's execution loop. No-op if no token configured. */
  start(handler: MessageHandler): void {
    if (!this.enabled) {
      console.warn(`[telegram:${this.slug}] No token configured — bot disabled.`);
      return;
    }

    const usePolling = !env.telegram.webhookBaseUrl;
    this.bot = new TelegramBot(this.token, { polling: usePolling });

    // A transient network blip (EFATAL/ETELEGRAM) must NOT crash the channel —
    // just log and let polling recover on its own.
    this.bot.on('polling_error', (e) => console.warn(`[telegram:${this.slug}] polling_error:`, (e as Error).message));
    this.bot.on('error', (e) => console.warn(`[telegram:${this.slug}] error:`, (e as Error).message));

    if (!usePolling) {
      const url = `${env.telegram.webhookBaseUrl.replace(/\/$/, '')}/telegram/${this.slug}`;
      void this.bot.setWebHook(url);
      console.log(`[telegram:${this.slug}] Webhook registered at ${url}`);
    } else {
      console.log(`[telegram:${this.slug}] Long-polling started.`);
    }

    if (!env.telegram.ownerId) {
      console.warn(
        `[telegram:${this.slug}] ⚠️  TELEGRAM_OWNER_ID not set — ANYONE who can message this bot can run computer commands. Set it to lock control to you.`,
      );
    }

    this.bot.on('message', async (m) => {
      try {
        console.log(`[telegram:${this.slug}] message from id=${m.from?.id} (@${m.from?.username ?? '?'})`);

        // Security lock: if an owner id is configured, only they may command the agent.
        const ownerId = env.telegram.ownerId;
        if (ownerId && String(m.from?.id) !== ownerId) {
          await this.bot?.sendMessage(m.chat.id, '⛔ Not authorized to command this agent.');
          return;
        }

        const inbound: InboundMessage = {
          channel: 'telegram',
          chatId: m.chat.id,
          text: m.text ?? '',
          meta: { from: m.from?.username, messageId: m.message_id },
        };

        // Voice notes / audio: download locally so the VoiceEngine can transcribe the file.
        const media = m.voice ?? m.audio;
        if (media && this.bot) {
          inbound.audioPath = await this.bot.downloadFile(media.file_id, tmpdir());
          inbound.text = ''; // let transcription fill it
        }

        const reply = await handler(inbound);
        if (!this.bot) return;

        // Telegram shows raw HTML/Markdown literally — flatten to clean plain text.
        const cleanText = cleanForPlain(reply.text);
        const caption0 = cleanText.slice(0, 1024);
        let textDelivered = false;
        // Deliver any files a tool produced (e.g. screenshots) as photos.
        if (reply.imagePaths?.length) {
          for (let i = 0; i < reply.imagePaths.length; i++) {
            try {
              await this.bot.sendPhoto(m.chat.id, reply.imagePaths[i], i === 0 ? { caption: caption0 } : {});
              if (i === 0) textDelivered = true;
            } catch (e) {
              console.warn(`[telegram:${this.slug}] photo send failed:`, (e as Error).message);
            }
          }
        }

        if (reply.audioPath) {
          const caption = cleanText.slice(0, 1024);
          // Prefer a voice bubble; fall back to an audio file; finally to text.
          try {
            await this.bot.sendVoice(m.chat.id, reply.audioPath, { caption });
          } catch {
            try {
              await this.bot.sendAudio(m.chat.id, reply.audioPath, { caption });
            } catch (e) {
              console.warn(`[telegram:${this.slug}] audio send failed, sending text:`, (e as Error).message);
              await this.bot.sendMessage(m.chat.id, cleanText);
            }
          }
        } else if (!textDelivered) {
          await this.bot.sendMessage(m.chat.id, cleanText);
        }
      } catch (err) {
        console.error(`[telegram:${this.slug}] handler error:`, err);
        // Guard the error-reply too — a network failure here must not crash the process.
        if (this.bot) await this.bot.sendMessage(m.chat.id, '⚠️ Something broke on my end. Try again.').catch(() => {});
      }
    });
  }

  /** Push a message proactively (used by CHANCE for delegation / alerts). */
  async send(chatId: string | number, text: string): Promise<void> {
    if (!this.bot) throw new Error(`[telegram:${this.slug}] Bot not started.`);
    await this.bot.sendMessage(chatId, cleanForPlain(text));
  }

  async stop(): Promise<void> {
    await this.bot?.stopPolling().catch(() => {});
    this.bot = null;
  }
}
