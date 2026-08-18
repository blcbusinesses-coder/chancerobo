/**
 * Shared type contracts for the C.H.A.N.C.E Ecosystem.
 */

/** Task complexity drives tri-tier model routing. */
export enum TaskComplexity {
  /** Complex logic, code generation, system architecture, planning. -> Opus 4.8 */
  BIG = 'BIG',
  /** Standard conversation, task orchestration, data processing. -> Sonnet 5 */
  MEDIUM = 'MEDIUM',
  /** Browser nav, scraping, fast classification, UI updates. -> Haiku */
  SMALL = 'SMALL',
}

/** Frontend "look" config — Mandatory Function #5. */
export interface AgentIdentity {
  /** Human-facing display name, e.g. "Chance". */
  name: string;
  /** Machine slug, used for the Supabase schema name, e.g. "chance". */
  slug: string;
  /** Short role descriptor for dashboards. */
  role: string;
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    foreground: string;
  };
  avatarUrl: string;
  /** Ordered list of dashboard layout component keys. */
  layout: string[];
}

/** Per-agent permission model. */
export interface AgentPermissions {
  /** If true, this agent is the Overseer and gets master DB access. */
  overseer: boolean;
  /** May delegate sub-tasks to other agents. */
  canDelegate: boolean;
  /** Schemas this agent may touch. `['*']` for the overseer. */
  schemaAccess: string[];
}

/** The full definition needed to instantiate any agent. */
export interface AgentDefinition {
  identity: AgentIdentity;
  permissions: AgentPermissions;
  /** System / personality prompt injected into every model call. */
  personaPrompt: string;
  /** Whichever Telegram bot token belongs to this agent (may be empty in dev). */
  telegramToken: string;
  /** ElevenLabs voice id for outgoing audio. */
  voiceId: string;
}

/** A normalized inbound message from any channel (telegram, voice, api). */
export interface InboundMessage {
  channel: 'telegram' | 'voice' | 'api';
  chatId?: string | number;
  text: string;
  /** Optional path/URL of an audio file to transcribe first. */
  audioPath?: string;
  meta?: Record<string, unknown>;
}

/** The result of running the agent's execution loop once. */
export interface AgentResult {
  text: string;
  modelUsed: string;
  complexity: TaskComplexity;
  /** Optional path to generated speech audio. */
  audioPath?: string;
  /** Files (e.g. screenshots) a tool produced, to be delivered to the user. */
  imagePaths?: string[];
  /** Action for the UI to display in the main JARVIS interface (e.g. file, image, map) */
  uiAction?: any;
}
