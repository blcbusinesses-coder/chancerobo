import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { env } from '../../config/env.js';

/**
 * ZAPIER MCP — one connection to 8,000+ apps. The actions you enable in the
 * Zapier MCP dashboard appear here as tools; this bridges them into Chance's
 * normal function-calling loop (namespaced `zapier_*`) so his brain can call
 * them like any other tool. No per-app keys — Zapier holds the auth.
 */
interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown> }

class ZapierMCP {
  private client: Client | null = null;
  private tools: McpTool[] = [];

  get enabled(): boolean {
    return Boolean(env.zapier.mcpUrl);
  }

  /** Connect and cache the available actions. Safe to call repeatedly. */
  async init(): Promise<void> {
    if (!this.enabled || this.client) return;
    try {
      const client = new Client({ name: 'chance', version: '1.0.0' }, { capabilities: {} });
      await client.connect(new StreamableHTTPClientTransport(new URL(env.zapier.mcpUrl)));
      this.client = client;
      await this.refresh();
      console.log(`[zapier-mcp] connected — ${this.tools.length} action(s) available.`);
    } catch (e) {
      console.warn('[zapier-mcp] connect failed:', (e as Error).message);
    }
  }

  /** Re-fetch the action list (call after enabling new apps in Zapier). */
  async refresh(): Promise<number> {
    if (!this.client) await this.init();
    if (!this.client) return 0;
    const res = await this.client.listTools();
    this.tools = (res.tools as McpTool[]) || [];
    return this.tools.length;
  }

  /** Anthropic tool specs for the enabled Zapier actions (namespaced). */
  specs(): { name: string; description: string; input_schema: any }[] {
    return this.tools.map((t) => ({
      name: `zapier_${t.name}`,
      description: `[Zapier] ${t.description || t.name}`.slice(0, 900),
      input_schema:
        t.inputSchema && (t.inputSchema as any).type ? t.inputSchema : { type: 'object', properties: {} },
    }));
  }

  isZapierTool(name: string): boolean {
    return name.startsWith('zapier_');
  }

  names(): string[] {
    return this.tools.map((t) => t.name);
  }

  /** Invoke a Zapier action. `name` is the namespaced (`zapier_...`) tool name. */
  async call(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.client) await this.init();
    if (!this.client) return { error: 'Zapier MCP not connected (check ZAPIER_MCP_URL).' };
    const real = name.replace(/^zapier_/, '');
    try {
      const res: any = await this.client.callTool({ name: real, arguments: args || {} });
      const text = Array.isArray(res?.content)
        ? res.content.map((c: any) => (c?.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
        : JSON.stringify(res);
      return { ok: !res?.isError, result: text };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
}

export const zapierMCP = new ZapierMCP();
