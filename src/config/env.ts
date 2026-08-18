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

  tts: {
    /** 'edge' (free Microsoft neural TTS, no key) or 'elevenlabs'. */
    provider: optional('TTS_PROVIDER', 'edge'),
    /** Edge neural voice. en-GB-RyanNeural = warm British male (closest to "George"). */
    voice: optional('TTS_VOICE', 'en-GB-RyanNeural'),
  },

  /** Default brain: 'minimax' (cheap) with Claude Sonnet reserved for escalation. */
  brain: {
    provider: optional('BRAIN_PROVIDER', 'minimax'),
  },
  minimax: {
    apiKey: optional('MINIMAX_API_KEY'),
    model: optional('MINIMAX_MODEL', 'MiniMax-M3'),
    base: optional('MINIMAX_BASE', 'https://api.minimaxi.chat/v1'),
  },
  gemini: {
    apiKey: optional('GEMINI_API_KEY'),
    model: optional('GEMINI_MODEL', 'gemini-flash-latest'),
    imageModel: optional('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image'),
  },
  finnhub: {
    apiKey: optional('FINNHUB_API_KEY'),
  },

  spotify: {
    clientId: optional('SPOTIFY_CLIENT_ID'),
    clientSecret: optional('SPOTIFY_CLIENT_SECRET'),
    redirectUri: optional('SPOTIFY_REDIRECT_URI', 'http://127.0.0.1:8888/callback'),
    /** Obtained once via scripts/spotify-auth.ts; grants long-lived control of your account. */
    refreshToken: optional('SPOTIFY_REFRESH_TOKEN'),
  },

  /** Local Python vision service (webcam: object detection + hand→cursor control). Free, no credits. */
  vision: {
    serviceUrl: optional('VISION_SERVICE_URL', 'http://127.0.0.1:8788'),
  },

  /** Web search API — so Chance searches without driving a browser. */
  search: {
    provider: optional('SEARCH_PROVIDER', 'tavily'), // 'tavily' | 'brave'
    tavilyKey: optional('TAVILY_API_KEY'),
    braveKey: optional('BRAVE_API_KEY'),
  },

  /** Zapier MCP — one connection to 8,000+ apps. URL holds an embedded token; keep secret. */
  zapier: {
    mcpUrl: optional('ZAPIER_MCP_URL'),
  },

  /** Local media playback (YouTube/video via mpv + yt-dlp — no browser). */
  media: {
    mpvPath: optional('MPV_PATH', 'C:/Program Files/MPV Player/mpv.exe'),
    ytdlpPath: optional(
      'YTDLP_PATH',
      'C:/Users/owner/AppData/Local/Microsoft/WinGet/Packages/yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe/yt-dlp.exe',
    ),
  },

  openai: {
    apiKey: optional('OPENAI_API_KEY'),
  },

  telegram: {
    tokenChance: optional('TELEGRAM_BOT_TOKEN_CHANCE'),
    webhookBaseUrl: optional('TELEGRAM_WEBHOOK_BASE_URL'),
    /** If set, ONLY this Telegram user id may command the bot (locks computer control to you). */
    ownerId: optional('TELEGRAM_OWNER_ID'),
  },

  firetv: {
    /** Fire TV IP address (ADB debugging must be enabled on the TV). */
    ip: optional('FIRETV_IP'),
    /** Path to adb.exe; defaults to the bundled platform-tools. */
    adbPath: optional('ADB_PATH'),
  },

  kling: {
    /** Official Kling API: Access Key + Secret Key (used to sign a JWT). */
    accessKey: optional('KLING_ACCESS_KEY'),
    secretKey: optional('KLING_SECRET_KEY'),
    /** Fallback bearer token (for third-party Kling wrappers). */
    apiKey: optional('KLING_API_KEY'),
    base: optional('KLING_API_BASE', 'https://api-singapore.klingai.com'),
  },

  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    redirectUri: optional('GOOGLE_REDIRECT_URI', 'http://localhost:8787/oauth2/callback'),
    refreshToken: optional('GOOGLE_REFRESH_TOKEN'),
    /** Path to a Google Cloud service-account JSON key file. */
    serviceAccountPath: optional('GOOGLE_APPLICATION_CREDENTIALS'),
    scopes: optional(
      'GOOGLE_SCOPES',
      'https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/youtube',
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
} as const;

export type Env = typeof env;
