/**
 * NEWS — keyless headlines & search via Google News RSS (no API key required).
 *
 * Discovery only: returns title, source, date, snippet, and the article link.
 * Reading an article's full text is done separately by driving the agent's
 * headless browser (which follows Google's redirect to the real publisher).
 */
const BASE = 'https://news.google.com/rss';
const LOCALE = 'hl=en-US&gl=US&ceid=US:en';

/** Google News topic sections we accept as friendly names. */
const TOPICS: Record<string, string> = {
  world: 'WORLD', nation: 'NATION', us: 'NATION', national: 'NATION',
  business: 'BUSINESS', finance: 'BUSINESS', money: 'BUSINESS',
  tech: 'TECHNOLOGY', technology: 'TECHNOLOGY',
  entertainment: 'ENTERTAINMENT', sports: 'SPORTS', science: 'SCIENCE',
  health: 'HEALTH', headlines: '', top: '', general: '',
};

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  snippet: string;
}

/** Decode the handful of XML/HTML entities that show up in RSS text. */
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

export class News {
  /** Never needs a key — always available. */
  get configured(): boolean {
    return true;
  }

  private async fetchFeed(url: string, limit: number): Promise<NewsArticle[]> {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Google News ${res.status}`);
    const xml = await res.text();
    const items = xml.split('<item>').slice(1).map((s) => s.split('</item>')[0]);
    return items.slice(0, limit).map((it) => {
      const rawTitle = decodeEntities(tag(it, 'title'));
      const source = decodeEntities(tag(it, 'source')) || (rawTitle.includes(' - ') ? rawTitle.split(' - ').pop()! : '');
      // Titles come as "Headline - Source"; drop the trailing source for a clean headline.
      const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
      const pub = tag(it, 'pubDate').trim();
      return {
        title,
        source,
        url: tag(it, 'link').trim(),
        publishedAt: pub,
        snippet: decodeEntities(tag(it, 'description')).slice(0, 220),
      };
    });
  }

  /** Search news by free-text query. */
  async search(query: string, limit = 6): Promise<NewsArticle[]> {
    const url = `${BASE}/search?q=${encodeURIComponent(query)}&${LOCALE}`;
    return this.fetchFeed(url, limit);
  }

  /** Top headlines overall, or for a topic (world/business/tech/sports/…). */
  async top(topic?: string, limit = 6): Promise<NewsArticle[]> {
    const key = (topic || '').toLowerCase().trim();
    const section = TOPICS[key];
    const url = section
      ? `${BASE}/headlines/section/topic/${section}?${LOCALE}`
      : `${BASE}?${LOCALE}`;
    return this.fetchFeed(url, limit);
  }
}
