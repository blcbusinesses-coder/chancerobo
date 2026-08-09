import { BaseAgent } from '../../core/BaseAgent.js';
import { TaskComplexity } from '../../core/types.js';
import { CHANCE_DEFINITION } from './config.js';

/**
 * CHANCE — the master orchestrator.
 * Extends the core template (all 5 Mandatory Functions) and adds
 * Overseer-only capabilities: cross-schema reads and sub-task delegation.
 */
export class ChanceAgent extends BaseAgent {
  constructor() {
    super(CHANCE_DEFINITION);
  }

  /**
   * Overseer capability: read any agent's memory across schemas.
   * Relies on the service-role client configured for the Overseer.
   */
  async inspectAgent(schema: string, limit = 20) {
    const { data, error } = await this.db
      .crossSchema(schema)
      .table('memory')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`[chance] inspectAgent(${schema}) failed: ${error.message}`);
    return data ?? [];
  }

  /**
   * Overseer capability: delegate a sub-task. For now this drafts a delegation
   * plan (BIG-tier reasoning) and records it; once sub-agents exist, this is
   * where CHANCE would dispatch to their execution loops / Telegram bots.
   */
  async delegate(objective: string): Promise<{ plan: string }> {
    const routed = await this.router.route(
      `Draft a concrete delegation plan for this objective. List which agent ` +
        `(or new agent to spin up) handles each step, and the acceptance criteria.\n\n` +
        `OBJECTIVE:\n${objective}`,
      { system: this.systemPrompt, complexity: TaskComplexity.BIG },
    );
    await this.db
      .remember('delegation', routed.text, { objective })
      .catch((e) => console.warn('[chance] delegation not persisted:', e.message));
    return { plan: routed.text };
  }
}
