/**
 * C.H.A.N.C.E Ecosystem — public surface.
 * Import from here when embedding the ecosystem in another app.
 */
export { BaseAgent } from './core/BaseAgent.js';
export { ModelRouter } from './core/ModelRouter.js';
export { TaskComplexity } from './core/types.js';
export type {
  AgentDefinition,
  AgentIdentity,
  AgentPermissions,
  AgentResult,
  InboundMessage,
} from './core/types.js';

export { AgentDatabase } from './core/functions/database.js';
export { AgentBrowser } from './core/functions/browser.js';
export { VoiceEngine } from './core/functions/voice.js';
export { AgentTelegram } from './core/functions/telegram.js';
export { AgentIdentityModule } from './core/functions/identity.js';

export { ChanceAgent } from './agents/chance/ChanceAgent.js';
export { CHANCE_DEFINITION } from './agents/chance/config.js';
