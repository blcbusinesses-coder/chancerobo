import { env } from '../../config/env.js';

/**
 * WEB SEARCH — a real search API so Chance answers from the web WITHOUT driving
 * a browser. Provider-agnostic; defaults to Tavily (built for AI agents: returns
 * clean extracted content + a direct answer), with Brave as an alternative.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}
export interface SearchResponse {
  query: string;
  answer?: string;
  results: SearchResult[];
  provider: string;
}

export class WebSearch {
  get provider(): string {
    return (env.search.provider || 'tavily').toLowerCase();
  }

  get configured(): boolean {
    return this.provider === 'brave' ? Boolean(env.search.braveKey) : Boolean(env.search.tavilyKey);
  }

  async search(query: string, opts: { max?: number } = {}): Promise<SearchResponse> {
    const max = Math.min(10, Math.max(1, opts.max ?? 5));
    if (this.provider === 'brave') return this.brave(query, max);
    return this.tavily(query, max);
  }

  /** Tavily — LLM-optimized: returns a direct answer plus per-result content. */
  private async tavily(query: string, max: number): Promise<SearchResponse> {
    if (!env.search.tavilyKey) {
      throw new Error('Web search not configured. Add TAVILY_API_KEY to .env (free key at tavily.com).');
    }
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.search.tavilyKey,
        query,
        max_results: max,
        include_answer: true,
        search_depth: 'basic',
      }),
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j: any = await res.json();
    return {
      query,
      provider: 'tavily',
      answer: j.answer || undefined,
      results: (j.results || []).map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: (r.content || '').slice(0, 300),
        content: r.content,
      })),
    };
  }

  /** Brave — general independent web index. Titles/urls/snippets. */
  private async brave(query: string, max: number): Promise<SearchResponse> {
    if (!env.search.braveKey) {
      throw new Error('Web search not configured. Add BRAVE_API_KEY to .env (free key at brave.com/search/api).');
    }
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': env.search.braveKey },
    });
    if (!res.ok) throw new Error(`Brave ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j: any = await res.json();
    return {
      query,
      provider: 'brave',
      results: (j.web?.results || []).map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: r.description || '',
      })),
    };
  }
}
