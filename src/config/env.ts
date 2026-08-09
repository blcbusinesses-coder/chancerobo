import 'dotenv/config';

/**
 * Centralized, validated environment access for the C.H.A.N.C.E Ecosystem.
 * Values are read lazily so that missing optional keys don't crash boot —
 * only the functions that actually need a key will complain when used.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '8787'), 10),
  logLevel: optional('LOG_LEVEL', 'info'),

  anthropic: {
    get apiKey() {
      return required('ANTHROPIC_API_KEY');
    },
    modelBig: optional('MODEL_BIG', 'claude-opus-4-8'),
    modelMedium: optional('MODEL_MEDIUM', 'claude-sonnet-5'),
    modelSmall: optional('MODEL_SMALL', 'claude-haiku-4-5-20251001'),
  },

  supabase: {
    get url() {
      return required('SUPABASE_URL');
    },
    get serviceRoleKey() {
      return required('SUPABASE_SERVICE_ROLE_KEY');
    },
    get anonKey() {
      return required('SUPABASE_ANON_KEY');
    },
  },

  elevenlabs: {
    get apiKey() {
      return required('ELEVENLABS_API_KEY');
    },
    voiceIdChance: optional('ELEVENLABS_VOICE_ID_CHANCE', '21m00Tcm4TlvDq8ikWAM'),
  },

  openai: {
    apiKey: optional('OPENAI_API_KEY'),
  },

  telegram: {
    tokenChance: optional('TELEGRAM_BOT_TOKEN_CHANCE'),
    webhookBaseUrl: optional('TELEGRAM_WEBHOOK_BASE_URL'),
  },
} as const;

export type Env = typeof env;
