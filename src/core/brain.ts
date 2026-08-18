import type Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

/**
 * PROVIDER-AGNOSTIC AGENTIC LOOP
 * ------------------------------
 * Default brain is MiniMax (cheap, OpenAI-compatible). Claude Sonnet is reserved
 * for escalation (user asks for it, or a critical task after the user approves).
 * The same tool set is used for both — converted to each provider's format.
 */
export type ToolSpec = Anthropic.Tool;
export type ExecTool = (name: string, input: any) => Promise<unknown>;

const MAX_STEPS = 6;
const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

export interface ConverseOpts {
  system: string;
  userText: string;
  tools: ToolSpec[];
  execTool: ExecTool;
  anthropic: Anthropic;
  /** Escalate this turn to Claude Sonnet. */
  useClaude?: boolean;
  onToolCall?: (name: string, input: any) => void;
  /** Abort mid-task (user pressed stop) to stop burning tokens. */
  signal?: AbortSignal;
}

export interface ConverseResult {
  text: string;
  model: string;
  provider: 'minimax' | 'anthropic';
  toolsUsed: string[];
  usage: { promptTokens: number; completionTokens: number };
}

export async function converse(opts: ConverseOpts): Promise<ConverseResult> {
  return opts.useClaude ? converseAnthropic(opts) : converseMiniMax(opts);
}

/** MiniMax via its OpenAI-compatible /chat/completions endpoint. */
async function converseMiniMax(opts: ConverseOpts): Promise<ConverseResult> {
  const tools = opts.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
  const messages: any[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.userText },
  ];
  const toolsUsed: string[] = [];
  let finalText = '';
  const usage = { promptTokens: 0, completionTokens: 0 };

  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal?.aborted) break;
    let res: Response;
    try {
      res = await fetch(`${env.minimax.base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${env.minimax.apiKey}` },
        body: JSON.stringify({ model: env.minimax.model, messages, tools, tool_choice: 'auto', max_tokens: 2048 }),
        signal: opts.signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) break; // user pressed stop — bail cleanly
      throw e;
    }
    if (!res.ok) throw new Error(`MiniMax ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('MiniMax: empty response');
    usage.promptTokens += Number(data?.usage?.prompt_tokens || 0);
    usage.completionTokens += Number(data?.usage?.completion_tokens || 0);

    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name;
        let input: any = {};
        try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { /* keep {} */ }
        toolsUsed.push(name);
        opts.onToolCall?.(name, input);
        let out: unknown;
        try { out = await opts.execTool(name, input); } catch (e) { out = { error: (e as Error).message }; }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 8000) });
      }
      continue;
    }
    finalText = stripThink(String(msg.content || ''));
    break;
  }
  return { text: finalText, model: env.minimax.model, provider: 'minimax', toolsUsed, usage };
}

/** Claude Sonnet (escalation) via the Anthropic SDK. */
async function converseAnthropic(opts: ConverseOpts): Promise<ConverseResult> {
  const model = env.anthropic.modelMedium; // Sonnet
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.userText }];
  const toolsUsed: string[] = [];
  let finalText = '';
  const usage = { promptTokens: 0, completionTokens: 0 };

  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal?.aborted) break;
    let resp: Anthropic.Message;
    try {
      resp = await opts.anthropic.messages.create(
        { model, max_tokens: 2048, system: opts.system, tools: opts.tools, messages },
        { signal: opts.signal },
      );
    } catch (e) {
      if (opts.signal?.aborted) break;
      throw e;
    }
    usage.promptTokens += resp.usage?.input_tokens || 0;
    usage.completionTokens += resp.usage?.output_tokens || 0;
    finalText = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (resp.stop_reason !== 'tool_use') break;
    messages.push({ role: 'assistant', content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      toolsUsed.push(block.name);
      opts.onToolCall?.(block.name, block.input);
      let out: unknown;
      try { out = await opts.execTool(block.name, block.input as any); } catch (e) { out = { error: (e as Error).message }; }
      results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 8000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: finalText, model, provider: 'anthropic', toolsUsed, usage };
}
