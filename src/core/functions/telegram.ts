import TelegramBot from 'node-telegram-bot-api';
import { env } from '../../config/env.js';
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
export type MessageHandler = (msg: InboundMessage) => Promise<{ text: string; audioPath?: string }>;

export class AgentTelegram {
  private bot: TelegramBot | null = null;
  private token: string;
  private slug: string;

  constructor(token: string, slug: string) {
    this.token = token;
    this.slug = slug;
  }

  get enabled(): boolean {
    return this.token.trim().length > 0;
  }

  /** Wire the bot to the agent's execution loop. No-op if no token configured. */
  start(handler: MessageHandler): void {
    if (!this.enabled) {
      console.warn(`[telegram:${this.slug}] No token configured — bot disabled.`);
      return;
    }

    const usePolling = !env.telegram.webhookBaseUrl;
    this.bot = new TelegramBot(this.token, { polling: usePolling });

    if (!usePolling) {
      const url = `${env.telegram.webhookBaseUrl.replace(/\/$/, '')}/telegram/${this.slug}`;
      void this.bot.setWebHook(url);
      console.log(`[telegram:${this.slug}] Webhook registered at ${url}`);
    } else {
      console.log(`[telegram:${this.slug}] Long-polling started.`);
    }

    this.bot.on('message', async (m) => {
      try {
        const inbound: InboundMessage = {
          channel: 'telegram',
          chatId: m.chat.id,
          text: m.text ?? '',
          meta: { from: m.from?.username, messageId: m.message_id },
        };

        // Voice notes: hand the file path to the agent so its VoiceEngine can transcribe.
        if (m.voice && this.bot) {
          const link = await this.bot.getFileLink(m.voice.file_id);
          inbound.audioPath = link;
          inbound.text = inbound.text || '[voice message]';
        }

        const reply = await handler(inbound);
        if (this.bot) {
          if (reply.audioPath) {
            await this.bot.sendVoice(m.chat.id, reply.audioPath, { caption: reply.text.slice(0, 1024) });
          } else {
            await this.bot.sendMessage(m.chat.id, reply.text);
          }
        }
      } catch (err) {
        console.error(`[telegram:${this.slug}] handler error:`, err);
        if (this.bot) await this.bot.sendMessage(m.chat.id, '⚠️ Something broke on my end. Try again.');
      }
    });
  }

  /** Push a message proactively (used by CHANCE for delegation / alerts). */
  async send(chatId: string | number, text: string): Promise<void> {
    if (!this.bot) throw new Error(`[telegram:${this.slug}] Bot not started.`);
    await this.bot.sendMessage(chatId, text);
  }

  async stop(): Promise<void> {
    await this.bot?.stopPolling().catch(() => {});
    this.bot = null;
  }
}
