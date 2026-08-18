import { ChanceAgent } from '../src/agents/chance/ChanceAgent.js';
import { zapierMCP } from '../src/core/functions/mcp.js';

/**
 * TELEGRAM CHANNEL — polling only.
 *   npm run telegram
 *
 * Runs just Chance's Telegram channel (long-polling). Kept separate from the UI
 * API server (src/server.ts) so the two don't fight over port 8787 — the API
 * server owns HTTP, this process owns Telegram.
 */
const chance = new ChanceAgent();
void zapierMCP.init();
chance.activate();
console.log('[telegram] Chance Telegram channel is live (long-polling). Owner-locked.');

// Survive transient network errors (EFATAL from Telegram during a WiFi blip)
// instead of crashing the whole channel.
process.on('unhandledRejection', (e) => console.warn('[telegram] unhandledRejection:', (e as Error)?.message || e));
process.on('uncaughtException', (e) => console.warn('[telegram] uncaughtException:', (e as Error)?.message || e));

// Keep the process alive.
process.stdin.resume();
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
