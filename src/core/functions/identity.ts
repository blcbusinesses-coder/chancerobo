import type { AgentIdentity } from '../types.js';

/**
 * MANDATORY FUNCTION #5 — CUSTOM UI IDENTITY / "LOOK"
 * ---------------------------------------------------
 * A standardized frontend config each agent exposes so the web dashboard can
 * render its name, theme, avatar, and layout consistently.
 */
export class AgentIdentityModule {
  readonly identity: AgentIdentity;

  constructor(identity: AgentIdentity) {
    this.identity = identity;
  }

  /**
   * Serialize the identity into the exact shape the frontend expects.
   * Kept separate from the raw type so we can add computed fields (CSS vars)
   * without leaking presentation concerns into the core contract.
   */
  toFrontendConfig() {
    const { name, slug, role, theme, avatarUrl, layout } = this.identity;
    return {
      name,
      slug,
      role,
      avatarUrl,
      theme,
      layout,
      /** Ready-to-inject CSS custom properties for the dashboard shell. */
      cssVars: {
        '--agent-primary': theme.primary,
        '--agent-secondary': theme.secondary,
        '--agent-accent': theme.accent,
        '--agent-bg': theme.background,
        '--agent-fg': theme.foreground,
      },
    };
  }

  /** JSON string form, e.g. to serve from an `/identity` endpoint. */
  toJSON(): string {
    return JSON.stringify(this.toFrontendConfig(), null, 2);
  }
}
