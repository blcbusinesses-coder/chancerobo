import { env } from '../../config/env.js';
import type { AgentDefinition } from '../../core/types.js';
import { CHANCE_PERSONA } from './prompt.js';

/**
 * AGENT ZERO — CHANCE
 * The central orchestrator. Overseer permissions grant master DB access
 * (service-role key) across ALL agent schemas and authority to delegate.
 */
export const CHANCE_DEFINITION: AgentDefinition = {
  identity: {
    name: 'Chance',
    slug: 'chance',
    role: 'Master Overseer / System Orchestrator',
    theme: {
      primary: '#00E5FF', // cyan — the JARVIS/HUD signal color
      secondary: '#0A1929', // deep navy shell
      accent: '#FFB300', // amber highlight
      background: '#050B18',
      foreground: '#E6F1FF',
    },
    avatarUrl: 'https://cdn.chance.beckitt.ai/avatars/chance.png',
    layout: ['header', 'chat', 'agent-roster', 'task-queue', 'telemetry', 'voice-console'],
  },
  permissions: {
    overseer: true,
    canDelegate: true,
    schemaAccess: ['*'], // master access to every agent schema
  },
  personaPrompt: CHANCE_PERSONA,
  telegramToken: env.telegram.tokenChance,
  voiceId: env.elevenlabs.voiceIdChance,
};
