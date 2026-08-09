import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { TaskComplexity } from './types.js';

/**
 * TRI-TIER MODEL ROUTING
 * ----------------------
 * A single dynamic caller that selects the Claude model by task complexity:
 *
 *   BIG    -> Opus 4.8   (complex logic, code gen, architecture, planning)
 *   MEDIUM -> Sonnet 5   (conversation, orchestration, data processing)
 *   SMALL  -> Haiku      (browser nav, scraping, classification, UI updates)
 */

export interface RouteOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Force a tier instead of relying on the heuristic. */
  complexity?: TaskComplexity;
  /** Prior turns, if maintaining a conversation. */
  history?: Anthropic.MessageParam[];
}

export interface RouteResult {
  text: string;
  model: string;
  complexity: TaskComplexity;
  usage: { input: number; output: number };
}

export class ModelRouter {
  private client: Anthropic;

  private readonly modelFor: Record<TaskComplexity, string> = {
    [TaskComplexity.BIG]: env.anthropic.modelBig,
    [TaskComplexity.MEDIUM]: env.anthropic.modelMedium,
    [TaskComplexity.SMALL]: env.anthropic.modelSmall,
  };

  private readonly maxTokensFor: Record<TaskComplexity, number> = {
    [TaskComplexity.BIG]: 8192,
    [TaskComplexity.MEDIUM]: 4096,
    [TaskComplexity.SMALL]: 1024,
  };

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey: env.anthropic.apiKey });
  }

  /** Map a complexity tier to a concrete model id. */
  resolveModel(complexity: TaskComplexity): string {
    return this.modelFor[complexity];
  }

  /**
   * Lightweight heuristic classifier. This is intentionally cheap and
   * deterministic; for higher accuracy you can replace it with a Haiku
   * classification call (SMALL tier) — that's the "fast classification"
   * use case the router is built for.
   */
  classify(prompt: string): TaskComplexity {
    const p = prompt.toLowerCase();

    const bigSignals = [
      'architect', 'architecture', 'design a system', 'refactor', 'implement',
      'build a', 'write code', 'generate code', 'plan', 'strategy', 'migrate',
      'debug', 'algorithm', 'multi-step', 'orchestrate the whole',
    ];
    const smallSignals = [
      'navigate', 'scrape', 'click', 'extract text', 'classify', 'is this',
      'yes or no', 'label', 'summarize in one', 'update the ui', 'format',
      'parse', 'lookup', 'fetch the page',
    ];

    if (bigSignals.some((s) => p.includes(s))) return TaskComplexity.BIG;
    if (smallSignals.some((s) => p.includes(s))) return TaskComplexity.SMALL;

    // Very long prompts tend to be heavy planning/generation work.
    if (prompt.length > 1500) return TaskComplexity.BIG;
    return TaskComplexity.MEDIUM;
  }

  /** Route a single prompt to the right model and return the completion. */
  async route(prompt: string, opts: RouteOptions = {}): Promise<RouteResult> {
    const complexity = opts.complexity ?? this.classify(prompt);
    const model = this.resolveModel(complexity);

    const messages: Anthropic.MessageParam[] = [
      ...(opts.history ?? []),
      { role: 'user', content: prompt },
    ];

    const response = await this.client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? this.maxTokensFor[complexity],
      temperature: opts.temperature ?? 0.7,
      system: opts.system,
      messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return {
      text,
      model,
      complexity,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  }

  /** Expose the raw client for advanced/streaming/tool-use flows. */
  get raw(): Anthropic {
    return this.client;
  }
}
