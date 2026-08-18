/**
 * Output cleaning. MiniMax (and models in general) sometimes emit raw HTML tags
 * — <p>, <br>, <strong>, &nbsp; — which look fine nowhere. This normalizes a
 * reply for each channel:
 *   - cleanForMarkdown: strip HTML but KEEP Markdown (web chat + popups render it)
 *   - cleanForPlain:    strip HTML AND Markdown to tidy plain text (Telegram, logs)
 */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m);
}

/** Does this text contain HTML tags or entities worth cleaning? */
export function hasHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*?>|&[a-z]+;|&#\d+;/i.test(s);
}

/** Convert HTML in a reply to clean GitHub-flavored Markdown (preserves emphasis). */
export function htmlToMarkdown(input: string): string {
  let s = input;
  // Inline emphasis → Markdown equivalents.
  s = s.replace(/<\s*(strong|b)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '**$2**');
  s = s.replace(/<\s*(em|i)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '*$2*');
  s = s.replace(/<\s*code\s*>([\s\S]*?)<\s*\/\s*code\s*>/gi, '`$1`');
  s = s.replace(/<\s*a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi, '[$2]($1)');
  // Line/block structure.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\s*\/\s*(p|div|h[1-6]|li|ul|ol|tr|table|blockquote|section|article)\s*>/gi, '\n');
  s = s.replace(/<\s*(p|div|h[1-6]|ul|ol|blockquote|section|article)\b[^>]*>/gi, '\n');
  // Drop any remaining tags, decode entities, tidy whitespace.
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/** For Markdown-rendering channels (web chat, popups): strip HTML, keep Markdown. */
export function cleanForMarkdown(s: string): string {
  return hasHtml(s) ? htmlToMarkdown(s) : s;
}

/** For plain-text channels (Telegram, logs): strip HTML AND Markdown, keep layout. */
export function cleanForPlain(input: string): string {
  let s = cleanForMarkdown(input);
  s = s
    .replace(/```[a-z]*\n?/gi, '').replace(/```/g, '')      // code fences (keep the code text)
    .replace(/`([^`]+)`/g, '$1')                            // inline code
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')               // images → alt
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')         // links → text (url)
    .replace(/(\*\*\*|___)(.*?)\1/g, '$2')                  // bold+italic
    .replace(/(\*\*|__)(.*?)\1/g, '$2')                     // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')                        // italic
    .replace(/^#{1,6}\s+/gm, '')                            // headings
    .replace(/^>\s?/gm, '')                                 // blockquotes
    .replace(/^[ \t]*[-*+]\s+/gm, '• ')                     // bullets → •
    .replace(/^\s*\d+\.\s+/gm, (m) => m.trimStart())        // keep numbered lists as-is
    .replace(/^-{3,}$/gm, '')                               // horizontal rules
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}
