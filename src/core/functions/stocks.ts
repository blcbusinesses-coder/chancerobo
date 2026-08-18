import { env } from '../../config/env.js';

/**
 * STOCKS — live quote + company info via Finnhub; historical price series via
 * Yahoo's free chart API (Finnhub's candles are premium-only). Returns a payload
 * the UI renders as a stock card (price, change, and a price chart).
 */
const FINN = 'https://finnhub.io/api/v1';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Map friendly ranges to Yahoo range + interval. */
const RANGES: Record<string, { range: string; interval: string }> = {
  '1d': { range: '1d', interval: '5m' },
  '5d': { range: '5d', interval: '30m' },
  '1m': { range: '1mo', interval: '1d' },
  '3m': { range: '3mo', interval: '1d' },
  '6m': { range: '6mo', interval: '1d' },
  '1y': { range: '1y', interval: '1d' },
  '5y': { range: '5y', interval: '1wk' },
  max: { range: 'max', interval: '1mo' },
};

function normalizeRange(input?: string): { key: string; range: string; interval: string } {
  const k = (input || '1m').toLowerCase().replace('mo', 'm').replace('year', 'y').replace(/\s/g, '');
  const map: Record<string, string> = { '1w': '5d', '1week': '5d', '1month': '1m', '3month': '3m', '6month': '6m', '1year': '1y', '5year': '5y', ytd: '1y' };
  const key = RANGES[k] ? k : map[k] || '1m';
  return { key, ...RANGES[key] };
}

export class Stocks {
  get configured(): boolean {
    return Boolean(env.finnhub.apiKey);
  }

  /** Live quote from Finnhub. */
  async quote(symbol: string) {
    const res = await fetch(`${FINN}/quote?symbol=${encodeURIComponent(symbol)}&token=${env.finnhub.apiKey}`);
    if (!res.ok) throw new Error(`Finnhub ${res.status}`);
    const q: any = await res.json();
    return { current: q.c, change: q.d, changePercent: q.dp, high: q.h, low: q.l, open: q.o, prevClose: q.pc };
  }

  async profile(symbol: string) {
    const res = await fetch(`${FINN}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${env.finnhub.apiKey}`);
    const p: any = await res.json();
    return { name: p.name, ticker: p.ticker, exchange: p.exchange, currency: p.currency, logo: p.logo };
  }

  /** Historical price series from Yahoo (free), for a friendly range like '1m','1y'. */
  async history(symbol: string, range?: string) {
    const r = normalizeRange(range);
    const res = await fetch(`${YAHOO}/${encodeURIComponent(symbol)}?range=${r.range}&interval=${r.interval}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error(`Yahoo ${res.status}`);
    const d: any = await res.json();
    const result = d?.chart?.result?.[0];
    if (!result) return { rangeKey: r.key, points: [] as { t: number; close: number }[] };
    const ts: number[] = result.timestamp || [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
    const points = ts
      .map((t, i) => ({ t, close: closes[i] }))
      .filter((p): p is { t: number; close: number } => typeof p.close === 'number');
    return { rangeKey: r.key, currency: result.meta?.currency, points };
  }

  /** Full stock card payload: profile + quote + chart. */
  async card(symbol: string, range?: string) {
    const sym = symbol.toUpperCase().trim();
    const [profile, quote, hist] = await Promise.all([
      this.profile(sym).catch(() => ({ name: sym, ticker: sym })),
      this.quote(sym),
      this.history(sym, range),
    ]);
    const intraday = hist.rangeKey === '1d' || hist.rangeKey === '5d';
    const chart = hist.points.map((p) => ({
      label: new Date(p.t * 1000).toLocaleDateString(undefined, intraday ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' }),
      value: Number(p.close.toFixed(2)),
    }));
    return {
      type: 'stock',
      symbol: sym,
      name: (profile as any).name || sym,
      currency: (profile as any).currency || 'USD',
      price: quote.current,
      change: quote.change,
      changePercent: quote.changePercent,
      range: hist.rangeKey,
      chart,
    };
  }
}
