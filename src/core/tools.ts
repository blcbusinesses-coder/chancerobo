import { promises as fs, existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import open from 'open';
import type Anthropic from '@anthropic-ai/sdk';
import type { BaseAgent } from './BaseAgent.js';
import { AgentBrowser } from './functions/browser.js';
import { captureScreen } from './functions/screen.js';
import { VOICE_PRESETS, setVoice } from './functions/voice.js';
import { Stocks } from './functions/stocks.js';
import { Spotify } from './functions/spotify.js';
import { News } from './functions/news.js';
import { Vision } from './functions/vision.js';
import { SmartHome } from './functions/smarthome.js';
import { WebSearch } from './functions/search.js';
import { Media } from './functions/media.js';
import { zapierMCP } from './functions/mcp.js';
import { projector } from './functions/projector.js';

const stocks = new Stocks();
const spotify = new Spotify();
const news = new News();
const vision = new Vision();
const smarthome = new SmartHome();
const websearch = new WebSearch();
const media = new Media();
import { FireTV } from './functions/firetv.js';
import { KlingAI } from './functions/kling.js';
import { Gemini } from './functions/gemini.js';
import { env } from '../config/env.js';

const firetv = new FireTV();
const kling = new KlingAI();
const gemini = new Gemini();

const execAsync = promisify(exec);

/**
 * INTERACTIVE BROWSER SESSIONS
 * Each agent keeps ONE persistent, visible real browser (Chrome or Edge) it can
 * drive step-by-step. Held in a WeakMap so it survives across tool calls without
 * touching BaseAgent.
 */
type BrowserKind = 'chrome' | 'edge';
type BrowserWho = 'agent' | 'mine';
const sessions = new WeakMap<BaseAgent, { browser: AgentBrowser; kind: BrowserKind; who: BrowserWho }>();

/** Path to the USER's real Chrome/Edge profile (so "do it in mine" uses their logins). */
function userProfile(kind: BrowserKind): { userDataDir: string } {
  const local = process.env.LOCALAPPDATA || 'C:/Users/owner/AppData/Local';
  return {
    userDataDir: kind === 'edge' ? `${local}/Microsoft/Edge/User Data` : `${local}/Google/Chrome/User Data`,
  };
}

/** Locate Microsoft Edge's executable on Windows. */
function edgePath(): string {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Microsoft Edge not found in the standard install locations.');
  return found;
}

async function openSession(agent: BaseAgent, kind: BrowserKind, who: BrowserWho = 'agent'): Promise<AgentBrowser> {
  const current = sessions.get(agent);
  if (current && (current.kind !== kind || current.who !== who)) {
    await current.browser.close();
    sessions.delete(agent);
  }
  let entry = sessions.get(agent);
  if (!entry) {
    const exec = kind === 'edge' ? { executablePath: edgePath() } : { channel: 'chrome' as const };
    // 'mine' = the user's real Chrome/Edge profile (their logins). 'agent' = Chance's own profile.
    const profile = who === 'mine' ? userProfile(kind) : { userDataDir: path.resolve(kind === 'edge' ? '.browser-edge' : '.browser-chrome') };
    const browser = new AgentBrowser({ headless: false, ...profile, ...exec });
    entry = { browser, kind, who };
    sessions.set(agent, entry);
  }
  return entry.browser;
}

function requireSession(agent: BaseAgent): AgentBrowser {
  const entry = sessions.get(agent);
  if (!entry) throw new Error('No interactive browser is open. Call open_browser first (browser: "chrome" or "edge").');
  return entry.browser;
}

/** Recursive filename search, bounded so it can't run away. */
async function findFiles(dir: string, query: string, cap = 50): Promise<string[]> {
  const q = query.toLowerCase();
  const out: string[] = [];
  const SKIP = new Set(['node_modules', '.git', '$Recycle.Bin', 'AppData', 'Windows']);
  async function walk(d: string, depth: number): Promise<void> {
    if (out.length >= cap || depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= cap) return;
      if (SKIP.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.name.toLowerCase().includes(q)) out.push(full);
    }
  }
  await walk(dir, 0);
  return out;
}

/**
 * THE TOOLSET
 * -----------
 * Turns an agent's capabilities (Google, browser, memory) into Anthropic
 * tool-use specs + handlers. Wired into BaseAgent.run(), so EVERY channel
 * (Telegram, voice, web API) gets the same tools automatically.
 *
 * To give an agent a new ability: add a capability method, then add a tool here.
 */
export interface ToolContext {
  agent: BaseAgent;
}

interface ToolDef {
  spec: Anthropic.Tool;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  {
    spec: {
      name: 'web_search',
      description:
        "Search the web via a fast search API — THE DEFAULT way to look anything up (facts, news, prices, 'who/what/when', current info). Returns a direct answer plus top results with content. ALWAYS prefer this over opening a browser to search; only use the browser for pages that need login or interaction.",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for.' },
          max: { type: 'number', description: 'How many results (default 5).' },
        },
        required: ['query'],
      },
    },
    handler: async (input) => {
      const r = await websearch.search(String(input.query), { max: Number(input.max) || 5 });
      return {
        answer: r.answer,
        results: r.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })),
        provider: r.provider,
      };
    },
  },
  {
    spec: {
      name: 'browse',
      description:
        'Read the visible text of a SPECIFIC URL in the headless browser. Use this to open a page you already have the link for (often from web_search results). For general "look it up" questions, use web_search instead. Handles CAPTCHAs by asking the human.',
      input_schema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Full URL including https://' } },
        required: ['url'],
      },
    },
    handler: async (input, { agent }) => {
      const url = String(input.url);
      await agent.browser.gotoSafe(url);
      const text = await agent.browser.extractText();
      return { url, title: await agent.browser.title(), text: text.slice(0, 4000) };
    },
  },
  {
    spec: {
      name: 'list_upcoming_events',
      description: "List upcoming Google Calendar events. Pass account (email) to check another signed-in account.",
      input_schema: { type: 'object', properties: { max: { type: 'number' }, account: { type: 'string' } } },
    },
    handler: async (input, { agent }) => {
      const g = await agent.googleFor(input.account ? String(input.account) : undefined);
      const evts = await g.upcomingEvents(Number(input.max) || 5);
      return evts.map((e) => ({
        summary: e.summary,
        start: e.start?.dateTime ?? e.start?.date,
        end: e.end?.dateTime ?? e.end?.date,
      }));
    },
  },
  {
    spec: {
      name: 'create_calendar_event',
      description: 'Create a Google Calendar event. start/end are ISO 8601 datetimes.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          start: { type: 'string', description: 'ISO 8601, e.g. 2026-08-12T15:00:00-05:00' },
          end: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['summary', 'start', 'end'],
      },
    },
    handler: async (input, { agent }) =>
      agent.google.createEvent(
        String(input.summary),
        String(input.start),
        String(input.end),
        input.description ? String(input.description) : '',
      ),
  },
  {
    spec: {
      name: 'list_recent_emails',
      description: "Read recent inbox emails (from, subject, snippet). Pass account (email) for another signed-in account.",
      input_schema: { type: 'object', properties: { max: { type: 'number' }, account: { type: 'string' } } },
    },
    handler: async (input, { agent }) => {
      const g = await agent.googleFor(input.account ? String(input.account) : undefined);
      return g.listRecentEmails(Number(input.max) || 5);
    },
  },
  {
    spec: {
      name: 'send_email',
      description:
        "Send an email from the agent's own Gmail. Only use when the user clearly wants a message sent, and echo the recipient + subject back to them.",
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' },
          account: { type: 'string', description: "Email of another signed-in account to send from; omit for Chance's own" },
        },
        required: ['to', 'subject', 'body'],
      },
    },
    handler: async (input, { agent }) => {
      const g = await agent.googleFor(input.account ? String(input.account) : undefined);
      const res = await g.sendEmail(String(input.to), String(input.subject), String(input.body));
      return { sent: true, id: res.data.id, to: input.to };
    },
  },
  {
    spec: {
      name: 'get_my_youtube_channel',
      description: "Get the agent's YouTube channel (title, subscriber and video counts).",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async (_input, { agent }) => {
      const channels = await agent.google.myChannel();
      if (!channels.length) return { channel: null, note: 'No YouTube channel on this account yet.' };
      return channels.map((c) => ({
        title: c.snippet?.title,
        subscribers: c.statistics?.subscriberCount,
        videos: c.statistics?.videoCount,
      }));
    },
  },
  {
    spec: {
      name: 'open_browser',
      description:
        "Open a VISIBLE, interactive browser and optionally navigate. Set which='mine' when the user says 'do it in a visible browser' or 'in MY browser' — this uses the USER's real Chrome/Edge with THEIR logins (requires their normal browser to be closed). Set which='agent' when the user says 'do it in YOUR browser and show me' — Chance's own window. After opening, use browser_navigate/click/type/read. (For non-visible quick reads, use 'browse' instead — it's headless.)",
      input_schema: {
        type: 'object',
        properties: {
          which: { type: 'string', enum: ['mine', 'agent'], description: "'mine' = user's real browser; 'agent' = Chance's own" },
          browser: { type: 'string', enum: ['chrome', 'edge'] },
          url: { type: 'string' },
        },
        required: ['browser'],
      },
    },
    handler: async (input, { agent }) => {
      const kind: BrowserKind = String(input.browser).toLowerCase() === 'edge' ? 'edge' : 'chrome';
      const who: BrowserWho = String(input.which).toLowerCase() === 'mine' ? 'mine' : 'agent';
      try {
        const browser = await openSession(agent, kind, who);
        if (input.url) await browser.gotoSafe(String(input.url));
        return { opened: kind, using: who, page: await browser.readInteractive() };
      } catch (e) {
        const msg = (e as Error).message;
        if (who === 'mine' && /profile|already running|SingletonLock|ProcessSingleton/i.test(msg)) {
          return { error: `Can't open your real ${kind} while it's already running — close your ${kind} windows first, then ask again.` };
        }
        return { error: msg };
      }
    },
  },
  {
    spec: {
      name: 'browser_navigate',
      description: 'Navigate the open interactive browser to a URL. Returns the page text + clickable elements.',
      input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
    handler: async (input, { agent }) => {
      const b = requireSession(agent);
      await b.gotoSafe(String(input.url));
      return b.readInteractive();
    },
  },
  {
    spec: {
      name: 'browser_read',
      description: 'Read the current page in the interactive browser: title, url, visible text, links, buttons, and inputs.',
      input_schema: { type: 'object', properties: {} },
    },
    handler: async (_input, { agent }) => requireSession(agent).readInteractive(),
  },
  {
    spec: {
      name: 'browser_click',
      description:
        'Click an element in the interactive browser — by its visible text (preferred) or a CSS selector. Returns the resulting page.',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Visible text/label of the link or button to click' },
          selector: { type: 'string', description: 'CSS selector (alternative to text)' },
        },
      },
    },
    handler: async (input, { agent }) => {
      const b = requireSession(agent);
      let ok = true;
      if (input.selector) await b.click(String(input.selector));
      else if (input.text) ok = await b.clickByText(String(input.text));
      else throw new Error('Provide text or selector to click.');
      return { clicked: ok, page: await b.readInteractive() };
    },
  },
  {
    spec: {
      name: 'browser_type',
      description:
        'Type text into an input in the interactive browser (by CSS selector), optionally pressing Enter to submit. Returns the resulting page.',
      input_schema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input (e.g. input[name="q"], textarea)' },
          text: { type: 'string' },
          submit: { type: 'boolean', description: 'Press Enter after typing' },
        },
        required: ['selector', 'text'],
      },
    },
    handler: async (input, { agent }) => {
      const b = requireSession(agent);
      await b.fill(String(input.selector), String(input.text));
      if (input.submit) await b.press('Enter');
      return b.readInteractive();
    },
  },
  {
    spec: {
      name: 'browser_screenshot',
      description: "Screenshot the interactive browser's current page and send it to the user.",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async (_input, { agent }) => {
      const b = requireSession(agent);
      const file = path.join(tmpdir(), `chance_browser_${Date.now()}.png`);
      await b.screenshot(file);
      agent.attachImage(file);
      return { captured: true, note: 'Browser screenshot sent to the user.' };
    },
  },
  {
    spec: {
      name: 'browser_close',
      description: 'Close the interactive browser window.',
      input_schema: { type: 'object', properties: {} },
    },
    handler: async (_input, { agent }) => {
      const entry = sessions.get(agent);
      if (entry) {
        await entry.browser.close();
        sessions.delete(agent);
      }
      return { closed: true };
    },
  },
  {
    spec: {
      name: 'screenshot_screen',
      description:
        "Capture a screenshot of the user's computer screen (all monitors) and send it to them. Use when the user asks to see their screen, or to visually confirm something on their machine.",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async (_input, { agent }) => {
      const file = await captureScreen();
      agent.attachImage(file);
      return { captured: true, note: 'Screenshot taken; the image is being delivered to the user.' };
    },
  },
  {
    spec: {
      name: 'open_on_computer',
      description:
        "Open something on the user's computer screen: a URL (e.g. a YouTube video), a file, a folder, or an app. Uses the OS default handler — the thing actually appears on their screen.",
      input_schema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'A URL (https://youtube.com/watch?v=...) or an absolute file/folder path',
          },
        },
        required: ['target'],
      },
    },
    handler: async (input) => {
      const target = String(input.target);
      await open(target);
      return { opened: target };
    },
  },
  {
    spec: {
      name: 'list_directory',
      description: "List the files and folders in a directory on the user's computer.",
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    handler: async (input) => {
      const entries = await fs.readdir(String(input.path), { withFileTypes: true });
      return entries.slice(0, 200).map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
    },
  },
  {
    spec: {
      name: 'find_files',
      description:
        "Find files by name (substring match) under a directory on the user's computer. Use to locate a file before opening it, e.g. find 'resume' under C:/Users/owner.",
      input_schema: {
        type: 'object',
        properties: { directory: { type: 'string' }, query: { type: 'string' } },
        required: ['directory', 'query'],
      },
    },
    handler: async (input) => findFiles(String(input.directory), String(input.query)),
  },
  {
    spec: {
      name: 'read_text_file',
      description: "Read the contents of a text file on the user's computer (first ~8k chars).",
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    handler: async (input) => {
      const p = String(input.path);
      const content = await fs.readFile(p, 'utf8');
      return { path: p, content: content.slice(0, 8000), truncated: content.length > 8000 };
    },
  },
  {
    spec: {
      name: 'run_command',
      description:
        "Run a shell command on the user's computer (Windows) and return its output. Use for anything the other tools don't cover — launching apps, system actions, scripts. Powerful; the bot is locked to the owner.",
      input_schema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
    handler: async (input) => {
      try {
        const { stdout, stderr } = await execAsync(String(input.command), {
          timeout: 20_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        });
        return { stdout: stdout.slice(0, 6000), stderr: stderr.slice(0, 2000) };
      } catch (e) {
        const err = e as Error & { stdout?: string; stderr?: string };
        return {
          error: err.message,
          stdout: (err.stdout ?? '').slice(0, 4000),
          stderr: (err.stderr ?? '').slice(0, 2000),
        };
      }
    },
  },
  {
    spec: {
      name: 'show_stock',
      description:
        "Display a STOCK card in the UI — live price, change %, and a price chart over a chosen time range. Use for any 'stock price/chart of X', 'how's TSLA doing', etc. range: 1d, 5d, 1m, 3m, 6m, 1y, 5y, max (default 1m). Give a short spoken summary too.",
      input_schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker, e.g. AAPL, TSLA, NVDA' },
          range: { type: 'string', description: '1d, 5d, 1m, 3m, 6m, 1y, 5y, or max' },
        },
        required: ['symbol'],
      },
    },
    handler: async (input, { agent }) => {
      const card = await stocks.card(String(input.symbol), input.range ? String(input.range) : undefined);
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = card;
      return {
        symbol: card.symbol, name: card.name, price: card.price,
        change: card.change, changePercent: card.changePercent, range: card.range, points: card.chart.length,
      };
    },
  },
  {
    spec: {
      name: 'stock_quote',
      description: "Get a stock's live price + change (no chart) by ticker. Fast lookup for 'what's X trading at'.",
      input_schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
    },
    handler: async (input) => {
      const sym = String(input.symbol).toUpperCase();
      return { symbol: sym, ...(await stocks.quote(sym)) };
    },
  },
  {
    spec: {
      name: 'spotify_play',
      description:
        "Play music on Spotify. With no 'query', resumes playback. With a 'query' (song, artist, album, or playlist name), searches and plays it. Requires the Spotify app to be open on a device and a Premium account. Use for 'play X', 'put on some Y', 'resume', 'play music'.",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to play, e.g. "Bohemian Rhapsody", "lofi beats", "Kendrick Lamar". Omit to resume.' },
        },
      },
    },
    handler: async (input) => {
      const r = await spotify.play(input.query ? String(input.query) : undefined);
      return { ok: true, device: r.device, nowPlaying: r.nowPlaying };
    },
  },
  {
    spec: {
      name: 'spotify_control',
      description:
        "Control Spotify playback: pause, resume, next track, previous track, set volume, or add a song to the queue. Requires Spotify open + Premium.",
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['pause', 'resume', 'next', 'previous', 'volume', 'queue'] },
          value: { type: 'number', description: 'Volume 0-100 (for action=volume).' },
          query: { type: 'string', description: 'Song to queue (for action=queue).' },
        },
        required: ['action'],
      },
    },
    handler: async (input) => {
      const action = String(input.action);
      switch (action) {
        case 'pause': return await spotify.pause();
        case 'resume': return await spotify.play();
        case 'next': return await spotify.next();
        case 'previous': return await spotify.previous();
        case 'volume': return await spotify.setVolume(Number(input.value ?? 50));
        case 'queue': return await spotify.queue(String(input.query ?? ''));
        default: return { error: `Unknown action: ${action}` };
      }
    },
  },
  {
    spec: {
      name: 'spotify_now_playing',
      description: "Get the currently playing Spotify track (title, artist, album). Use for 'what's this song', 'what's playing'.",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async () => await spotify.current(),
  },
  {
    spec: {
      name: 'spotify_devices',
      description: "List the Spotify devices available to play on (phone, desktop, speakers). Use for 'what can I play on', 'where can Chance play music'.",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async () => ({ devices: await spotify.devices() }),
  },
  {
    spec: {
      name: 'spotify_transfer',
      description:
        "Move Spotify playback to a specific device by name — 'play on my phone', 'move it to the desktop', 'switch to the living room speaker'. Matches on device name or type (phone/desktop/tv/speaker). The target device's Spotify app must be open.",
      input_schema: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Device name or hint, e.g. "phone", "desktop", "living room".' },
          play: { type: 'boolean', description: 'Start playing on arrival (default true).' },
        },
        required: ['device'],
      },
    },
    handler: async (input) => await spotify.transfer(String(input.device), input.play !== false),
  },
  {
    spec: {
      name: 'show_news',
      description:
        "Display current NEWS headlines in the UI as a popup list. Use for 'what's the news', 'news about X', 'top tech/business/sports headlines'. Provide a 'query' to search a topic, or a 'topic' for a section (world, business, tech, sports, science, health, entertainment). Give a short spoken summary of the top items too.",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search, e.g. "Kendrick Lamar", "AI regulation".' },
          topic: { type: 'string', description: 'Section: world, business, tech, sports, science, health, entertainment (used if no query).' },
          count: { type: 'number', description: 'How many headlines (default 6, max 12).' },
        },
      },
    },
    handler: async (input, { agent }) => {
      const count = Math.min(12, Math.max(1, Number(input.count) || 6));
      const items = input.query
        ? await news.search(String(input.query), count)
        : await news.top(input.topic ? String(input.topic) : undefined, count);
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = {
        type: 'news',
        heading: input.query ? `News: ${input.query}` : `${input.topic ? String(input.topic) : 'Top'} headlines`,
        items,
      };
      return { count: items.length, headlines: items.map((a) => `${a.title} (${a.source})`) };
    },
  },
  {
    spec: {
      name: 'show_article',
      description:
        "Pull up a full NEWS ARTICLE in a popup — the headline, source, and the readable article text. Use when the user says 'open/read that article', 'pull up the article about X', or 'read me the full story'. Give it a 'query' (topic to find + open the top match) OR a specific 'url'. Opens the real publisher page via the headless browser, so it may take a few seconds.",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Topic to search; the top matching article is opened.' },
          url: { type: 'string', description: 'A specific article URL to open (from a prior show_news result).' },
        },
      },
    },
    handler: async (input, { agent }) => {
      const a = agent as unknown as { browser: { readArticle: (u: string) => Promise<{ title: string; url: string; text: string }> }; pendingUIAction?: unknown };
      let link = input.url ? String(input.url) : '';
      let source = '';
      let headline = '';
      if (!link) {
        const [top] = await news.search(String(input.query || ''), 1);
        if (!top) return { error: `No article found for "${input.query}".` };
        link = top.url; source = top.source; headline = top.title;
      }
      const read = await a.browser.readArticle(link);
      const content = (read.text || '').trim();
      a.pendingUIAction = {
        type: 'article',
        title: headline || read.title || 'Article',
        source: source || new URL(read.url).hostname.replace(/^www\./, ''),
        url: read.url,
        content: content || 'Could not extract the article text. Open the link to read it in full.',
      };
      return { title: headline || read.title, source, url: read.url, chars: content.length };
    },
  },
  {
    spec: {
      name: 'save_value',
      description:
        "Remember a named fact the user tells you to save — e.g. 'save my personal email as x@y.com', 'remember my home address is …', 'my sister's number is …'. Store it under a short label (like 'personal email', 'home address') so you can use it later when they refer to it by name. Confirm what you saved.",
      input_schema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: "Short name to file it under, e.g. 'personal email', 'work phone', 'home address'." },
          value: { type: 'string', description: 'The value to remember.' },
          category: { type: 'string', description: "Optional grouping, e.g. 'email', 'phone', 'address'." },
        },
        required: ['label', 'value'],
      },
    },
    handler: async (input, { agent }) => {
      const db = (agent as unknown as { db: { saveValue: (l: string, v: string, c?: string) => Promise<{ label: string; value: string }> } }).db;
      const saved = await db.saveValue(String(input.label), String(input.value), input.category ? String(input.category) : undefined);
      return { saved: saved.label, value: saved.value };
    },
  },
  {
    spec: {
      name: 'list_saved_values',
      description: "List everything the user has asked you to remember (their saved values / labels). Use for 'what do you have saved', 'what's my personal email'.",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async (_input, { agent }) => {
      const db = (agent as unknown as { db: { savedValues: () => Promise<{ label: string; value: string; category: string | null }[]> } }).db;
      return { values: await db.savedValues() };
    },
  },
  {
    spec: {
      name: 'forget_value',
      description: "Delete a saved value by its label — 'forget my personal email', 'delete my saved home address'.",
      input_schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
    },
    handler: async (input, { agent }) => {
      const db = (agent as unknown as { db: { forgetValue: (l: string) => Promise<{ forgot: string }> } }).db;
      return await db.forgetValue(String(input.label));
    },
  },
  {
    spec: {
      name: 'camera_see',
      description:
        "LOOK through the webcam and see what's there — use when the user says 'what do you see', 'look at this', 'what am I holding', 'can you see me'. Runs FREE local object detection (no API credits) and shows the annotated camera frame in a popup. Report the objects you saw in a natural sentence.",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async (_input, { agent }) => {
      const result = await vision.see();
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = {
        type: 'vision',
        imageData: result.imageData,
        summary: result.summary,
        objects: result.objects,
      };
      const seen = result.summary.length
        ? result.summary.map((s) => (s.count > 1 ? `${s.count} ${s.label}` : s.label)).join(', ')
        : 'nothing it could confidently identify';
      return { saw: seen, objectCount: result.objects.length };
    },
  },
  {
    spec: {
      name: 'hand_control',
      description:
        "Start or stop HAND-TRACKING cursor control — the webcam tracks your hand and moves the mouse (index finger = pointer, pinch thumb+index = click). Use when the user says 'let me control with my hand', 'start hand control', 'stop tracking my hand'. action: start | stop | status.",
      input_schema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['start', 'stop', 'status'] } },
        required: ['action'],
      },
    },
    handler: async (input) => {
      const action = String(input.action);
      if (action === 'start') return await vision.handsStart();
      if (action === 'stop') return await vision.handsStop();
      return await vision.handsStatus();
    },
  },
  {
    spec: {
      name: 'configure_motion_control',
      description:
        "Set WHICH screen hand/motion cursor control is locked to, and its sensitivity. Use for 'give me hand control on screen 4', 'put it on the projector', 'only control my middle monitor', 'lock it to screen 2', 'use the whole desktop', 'make it more/less sensitive'. Settings persist and apply live. Call list_screens first if unsure how many screens exist.",
      input_schema: {
        type: 'object',
        properties: {
          monitor: { type: 'string', description: 'Target screen: a number ("screen 4", "2"), left/middle/right, "projector", or "all" for the whole desktop.' },
          sensitivity: { type: 'string', enum: ['low', 'medium', 'high', 'precise'] },
          smooth: { type: 'number', description: 'Cursor smoothing 0..1 (higher = snappier).' },
        },
      },
    },
    handler: async (input) => {
      const patch: Record<string, unknown> = {};
      if (input.monitor != null) patch.monitor = String(input.monitor);
      if (input.sensitivity != null) patch.sensitivity = String(input.sensitivity);
      if (input.smooth != null) patch.smooth = Number(input.smooth);
      return await vision.setHandsConfig(patch);
    },
  },
  {
    spec: {
      name: 'list_screens',
      description: "List the screens Chance can lock motion control onto (numbered — array panels plus any projector/external display). Use for 'what screens can you control', 'is the projector detected', before targeting a screen by number.",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async () => await vision.screens(),
  },
  {
    spec: {
      name: 'self_update',
      description:
        "Update yourself to the latest code and restart. Use when the user says 'update yourself', 'pull the latest', 'upgrade'. Pulls from GitHub, rebuilds, and restarts — the .env/secrets are preserved untouched. (Works on the git-based Pi install.)",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async () => {
      const { spawn } = await import('node:child_process');
      spawn('bash', ['pi/update.sh'], { cwd: process.cwd(), detached: true, stdio: 'ignore' }).unref();
      return { ok: true, note: 'Pulling the latest code, rebuilding, and restarting now — back in a moment. Your .env is left untouched.' };
    },
  },
  {
    spec: {
      name: 'projector_mode',
      description:
        "Turn the PROJECTOR SCREEN on or off. Use for 'turn on the projector screen', 'open projector mode', 'project it', 'turn off the projector'. Opens/closes a fullscreen projector view on the Pi's display. (Pi only.)",
      input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['on', 'off'] } }, required: ['action'] },
    },
    handler: async (input) => {
      const on = String(input.action) === 'on';
      projector.setActive(on);
      // The on-screen UI polls this and switches to/from the projector view.
      return { ok: true, projector: on ? 'on' : 'off' };
    },
  },
  {
    spec: {
      name: 'wake_word',
      description:
        "Turn the wake word ('Chance') ON or off — hands-free listening, so the user can just say 'Chance' to talk without pressing anything. Use for 'turn on wake word', 'enable wake word', 'stop wake word'. Works in projector mode too.",
      input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['on', 'off'] } }, required: ['action'] },
    },
    handler: async (input) => {
      const on = String(input.action) === 'on';
      projector.setWakeWord(on);
      return { ok: true, wakeWord: on ? 'on' : 'off' };
    },
  },
  {
    spec: {
      name: 'projector_show',
      description:
        "Put content on the PROJECTOR screen (projector mode). Use for 'put X on the projector', 'show a 3D Y on the wall'. kind: 3d | image | gallery | text | clear. value = shape (3d) / image URL / list of URLs (gallery) / text. mode add or replace (default replace). For VIDEO on the projector, use play_video (it goes fullscreen). ",
      input_schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['3d', 'image', 'gallery', 'text', 'clear'] },
          value: { description: 'shape / url / list of urls / text depending on kind' },
          title: { type: 'string' },
          mode: { type: 'string', enum: ['add', 'replace'] },
        },
        required: ['kind'],
      },
    },
    handler: async (input) => {
      const kind = String(input.kind);
      if (kind === 'clear') { projector.clear(); return { ok: true, cleared: true }; }
      let action: any;
      if (kind === '3d') action = { type: 'model3d', shape: input.value || 'torusknot', title: input.title };
      else if (kind === 'image') action = { type: 'image', data: String(input.value) };
      else if (kind === 'gallery') action = { type: 'gallery', images: Array.isArray(input.value) ? input.value : [input.value], title: input.title };
      else action = { type: 'document', markdown: String(input.value || ''), title: input.title };
      if (input.mode === 'add') projector.add(action); else projector.set([action]);
      return { ok: true, projected: kind };
    },
  },
  {
    spec: {
      name: 'play_video',
      description:
        "Play a YouTube video (or any video URL) ON THE SCREEN via the local player — no browser. Use for 'play X on YouTube', 'put on a video of Y', 'play <url>'. Give a search phrase or a URL. Opens fullscreen by default. Report what you're playing.",
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'YouTube search phrase or a video URL.' },
          fullscreen: { type: 'boolean', description: 'Fullscreen (default true).' },
          audio_only: { type: 'boolean', description: 'Play just the audio (default false).' },
        },
        required: ['query'],
      },
    },
    handler: async (input) => {
      const r = await media.play(String(input.query), {
        fullscreen: input.fullscreen !== false,
        audioOnly: Boolean(input.audio_only),
      });
      return { playing: r.title, url: r.url };
    },
  },
  {
    spec: {
      name: 'stop_video',
      description: "Stop the video/media currently playing on screen (closes the player). Use for 'stop the video', 'close it', 'turn it off'.",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async () => await media.stop(),
  },
  {
    spec: {
      name: 'zapier_actions',
      description:
        "List (and refresh) the Zapier actions you can run — these connect you to thousands of apps (Slack, Notion, SMS, Airtable, GitHub, etc.) with no extra keys. Use when the user asks 'what can you do with Zapier', 'what apps are connected', or right after they say they enabled a new app in Zapier (this re-scans so the new actions become available immediately).",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async () => {
      const count = await zapierMCP.refresh();
      return { count, actions: zapierMCP.names() };
    },
  },
  {
    spec: {
      name: 'outlet_control',
      description:
        "Turn a smart outlet/plug ON or OFF, toggle it, or check if it's on. These are the Geeni smart outlets (controlled locally over WiFi — no credits). Use for 'turn on the lamp', 'turn off outlet 2', 'is the fan on'. Give the outlet name; if there's only one it can be omitted.",
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['on', 'off', 'toggle', 'status'] },
          name: { type: 'string', description: 'Which outlet (its name in the Geeni app, e.g. "lamp", "outlet 1").' },
        },
        required: ['action'],
      },
    },
    handler: async (input) => {
      const name = input.name ? String(input.name) : '';
      const action = String(input.action);
      if (action === 'on') return await smarthome.on(name);
      if (action === 'off') return await smarthome.off(name);
      if (action === 'toggle') return await smarthome.toggle(name);
      return await smarthome.status(name);
    },
  },
  {
    spec: {
      name: 'list_outlets',
      description: "List the smart outlets Chance can control (their names). Use for 'what outlets do you have', 'what can you turn on'.",
      input_schema: { type: 'object', properties: {} },
    },
    handler: async () => await smarthome.list(),
  },
  {
    spec: {
      name: 'show_3d',
      description:
        "Display a rotating 3D object popup (glowing, animated). shape: torusknot | sphere | cube | torus | octahedron. Optional color (hex like #2F6FFF), wireframe (bool), title. Use for a cool visual, 'show a 3D X', or ambient flair.",
      input_schema: {
        type: 'object',
        properties: { shape: { type: 'string' }, color: { type: 'string' }, wireframe: { type: 'boolean' }, title: { type: 'string' } },
      },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'model3d', shape: input.shape, color: input.color, wireframe: input.wireframe, title: input.title };
      return { displayed: '3d', shape: input.shape || 'torusknot' };
    },
  },
  {
    spec: {
      name: 'show_gauge',
      description: "Display a gauge/dial popup for a single metric (speedometer style). Provide value (required), and optional min, max, unit, label, title. Great for a percentage, speed, score, temperature.",
      input_schema: {
        type: 'object',
        properties: { value: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, unit: { type: 'string' }, label: { type: 'string' }, title: { type: 'string' } },
        required: ['value'],
      },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'gauge', value: Number(input.value), min: input.min, max: input.max, unit: input.unit, label: input.label, title: input.title };
      return { displayed: 'gauge', value: input.value };
    },
  },
  {
    spec: {
      name: 'show_gallery',
      description: "Display a grid of images in a popup. Provide images (array of image URLs) and optional title.",
      input_schema: { type: 'object', properties: { images: { type: 'array', items: { type: 'string' } }, title: { type: 'string' } }, required: ['images'] },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'gallery', images: input.images, title: input.title };
      return { displayed: 'gallery', count: Array.isArray(input.images) ? input.images.length : 0 };
    },
  },
  {
    spec: {
      name: 'show_countdown',
      description: "Display a live countdown timer popup. Provide EITHER target (ISO datetime) OR seconds (duration). Optional title, label. Use for 'set a timer for X', 'countdown to <event>'.",
      input_schema: { type: 'object', properties: { target: { type: 'string' }, seconds: { type: 'number' }, title: { type: 'string' }, label: { type: 'string' } } },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'countdown', target: input.target, seconds: input.seconds, title: input.title, label: input.label };
      return { displayed: 'countdown' };
    },
  },
  {
    spec: {
      name: 'show_qr',
      description: "Display a QR code popup for a link or text (share a URL, wifi, contact, etc.). Provide data (the text/URL) and optional title.",
      input_schema: { type: 'object', properties: { data: { type: 'string' }, title: { type: 'string' } }, required: ['data'] },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'qr', data: String(input.data), title: input.title };
      return { displayed: 'qr' };
    },
  },
  {
    spec: {
      name: 'show_embed',
      description:
        "Embed a LIVE web page, Google Doc/Sheet/Slides, map, or video inside a popup (iframe). Provide url. Perfect for showing a document you created, a website, or a YouTube embed. For Google files use a shareable or /preview URL. Optional title, height.",
      input_schema: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, height: { type: 'number' } }, required: ['url'] },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'embed', url: String(input.url), title: input.title, height: input.height };
      return { displayed: 'embed', url: input.url };
    },
  },
  {
    spec: {
      name: 'show_chart',
      description:
        'Display a CHART in the UI (line, bar, or pie). Use whenever the answer is about trends or comparisons — spending over time, subscriber growth, stock performance, category breakdowns. Provide the data points; also give a short spoken summary.',
      input_schema: {
        type: 'object',
        properties: {
          chart_type: { type: 'string', enum: ['line', 'bar', 'pie'] },
          title: { type: 'string' },
          data: {
            type: 'array',
            description: 'Array of { label, value } points',
            items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } }, required: ['label', 'value'] },
          },
        },
        required: ['chart_type', 'data'],
      },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = {
        type: 'chart', chartType: String(input.chart_type), title: input.title, data: input.data,
      };
      return { displayed: 'chart', points: Array.isArray(input.data) ? input.data.length : 0 };
    },
  },
  {
    spec: {
      name: 'show_code',
      description: 'Display a CODE block with syntax highlighting in the UI. Use whenever you output code, scripts, or config.',
      input_schema: {
        type: 'object',
        properties: { language: { type: 'string' }, code: { type: 'string' } },
        required: ['code'],
      },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = {
        type: 'code', language: input.language || 'text', code: String(input.code),
      };
      return { displayed: 'code' };
    },
  },
  {
    spec: {
      name: 'show_document',
      description:
        'Display a FORMATTED DOCUMENT/report in the UI, rendered from Markdown (headers, bold, bullets, tables, and task lists all supported). Use for research summaries, comparison writeups, and multi-part answers.',
      input_schema: { type: 'object', properties: { markdown: { type: 'string' } }, required: ['markdown'] },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'document', markdown: String(input.markdown) };
      return { displayed: 'document' };
    },
  },
  {
    spec: {
      name: 'show_table',
      description: 'Display a data TABLE in the UI. columns = header strings; rows = array of row arrays.',
      input_schema: {
        type: 'object',
        properties: { columns: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array' } } },
        required: ['columns', 'rows'],
      },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'table', columns: input.columns, rows: input.rows };
      return { displayed: 'table' };
    },
  },
  {
    spec: {
      name: 'show_checklist',
      description: 'Display an interactive CHECKLIST/task list in the UI (checkable items). Use for to-dos, itineraries, and step-by-step plans.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: {
            type: 'array',
            items: { type: 'object', properties: { text: { type: 'string' }, done: { type: 'boolean' } }, required: ['text'] },
          },
        },
        required: ['items'],
      },
    },
    handler: async (input, { agent }) => {
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'checklist', title: input.title, items: input.items };
      return { displayed: 'checklist' };
    },
  },
  {
    spec: {
      name: 'drive_search',
      description: "Search the agent's Google Drive for files by name. Returns id, name, type, link.",
      input_schema: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'number' } }, required: ['query'] },
    },
    handler: async (input, { agent }) => agent.google.driveSearch(String(input.query), Number(input.max) || 10),
  },
  {
    spec: {
      name: 'drive_read',
      description: 'Read the text content of a Google Drive file (Google Docs and text files) by id.',
      input_schema: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] },
    },
    handler: async (input, { agent }) => agent.google.driveRead(String(input.file_id)),
  },
  {
    spec: {
      name: 'share_drive_file',
      description:
        "Change who can view/comment/edit a Google Drive file (Doc, Sheet, Slide, or any file) — i.e. sharing/viewing permissions. Use this for 'give X access to this doc', 'make this viewable by anyone with the link', 'let so-and-so edit this'. type='user' shares with one person's email (role: reader/commenter/writer); type='anyone' turns on link sharing for everyone.",
      input_schema: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          role: { type: 'string', enum: ['reader', 'commenter', 'writer', 'owner'] },
          type: { type: 'string', enum: ['user', 'anyone', 'domain'], description: "default 'user'" },
          email: { type: 'string', description: "required when type is 'user'" },
        },
        required: ['file_id', 'role'],
      },
    },
    handler: async (input, { agent }) =>
      agent.google.driveShare(
        String(input.file_id),
        String(input.role) as 'reader' | 'commenter' | 'writer' | 'owner',
        (input.type as 'user' | 'anyone' | 'domain') || 'user',
        input.email ? String(input.email) : undefined,
      ),
  },
  {
    spec: {
      name: 'get_drive_permissions',
      description: 'List who currently has access to a Drive file and their role (reader/writer/etc).',
      input_schema: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] },
    },
    handler: async (input, { agent }) => agent.google.driveGetPermissions(String(input.file_id)),
  },
  {
    spec: {
      name: 'revoke_drive_access',
      description: "Remove a person's (or link's) access to a Drive file. Get the permission_id from get_drive_permissions first.",
      input_schema: { type: 'object', properties: { file_id: { type: 'string' }, permission_id: { type: 'string' } }, required: ['file_id', 'permission_id'] },
    },
    handler: async (input, { agent }) => agent.google.driveRevokeAccess(String(input.file_id), String(input.permission_id)),
  },
  {
    spec: {
      name: 'create_doc',
      description: 'Create a Google Doc with a title and optional body text. Returns the id + link.',
      input_schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title'] },
    },
    handler: async (input, { agent }) => agent.google.docsCreate(String(input.title), input.content ? String(input.content) : ''),
  },
  {
    spec: {
      name: 'read_doc',
      description: 'Read the text of a Google Doc by its document id.',
      input_schema: { type: 'object', properties: { document_id: { type: 'string' } }, required: ['document_id'] },
    },
    handler: async (input, { agent }) => agent.google.docsRead(String(input.document_id)),
  },
  {
    spec: {
      name: 'create_sheet',
      description: 'Create a new Google Sheet. Returns id + link.',
      input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
    handler: async (input, { agent }) => agent.google.sheetsCreate(String(input.title)),
  },
  {
    spec: {
      name: 'read_sheet',
      description: 'Read values from a Google Sheet. range like "A1:D20" (defaults to A1:Z50).',
      input_schema: { type: 'object', properties: { spreadsheet_id: { type: 'string' }, range: { type: 'string' } }, required: ['spreadsheet_id'] },
    },
    handler: async (input, { agent }) => agent.google.sheetsRead(String(input.spreadsheet_id), input.range ? String(input.range) : undefined),
  },
  {
    spec: {
      name: 'append_sheet',
      description: 'Append rows to a Google Sheet. values is an array of row arrays.',
      input_schema: {
        type: 'object',
        properties: { spreadsheet_id: { type: 'string' }, range: { type: 'string' }, values: { type: 'array', items: { type: 'array' } } },
        required: ['spreadsheet_id', 'range', 'values'],
      },
    },
    handler: async (input, { agent }) => agent.google.sheetsAppend(String(input.spreadsheet_id), String(input.range), input.values as unknown[][]),
  },
  {
    spec: {
      name: 'list_tasks',
      description: "List the agent's Google Tasks (to-dos).",
      input_schema: { type: 'object', properties: { max: { type: 'number' } } },
    },
    handler: async (input, { agent }) => agent.google.tasksList(Number(input.max) || 20),
  },
  {
    spec: {
      name: 'add_task',
      description: 'Add a to-do to Google Tasks.',
      input_schema: { type: 'object', properties: { title: { type: 'string' }, notes: { type: 'string' } }, required: ['title'] },
    },
    handler: async (input, { agent }) => agent.google.taskAdd(String(input.title), input.notes ? String(input.notes) : undefined),
  },
  {
    spec: {
      name: 'search_contacts',
      description: "Search the agent's Google Contacts by name. Returns name, email, phone. Use before emailing someone by name.",
      input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    handler: async (input, { agent }) => agent.google.contactsSearch(String(input.query)),
  },
  {
    spec: {
      name: 'youtube_channel_stats',
      description:
        "Get a YouTube channel's subscriber count, video count, and total views BY NAME (e.g. 'MrBeast'). Use this for 'how many subs does X have' — do NOT open a browser for it.",
      input_schema: { type: 'object', properties: { channel: { type: 'string' } }, required: ['channel'] },
    },
    handler: async (input, { agent }) => agent.google.youtubeChannelStats(String(input.channel)),
  },
  {
    spec: {
      name: 'youtube_search',
      description: 'Search YouTube for videos. Returns titles, channels, and URLs (usable with firetv_open_url or open_on_computer).',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'number' } }, required: ['query'] },
    },
    handler: async (input, { agent }) => agent.google.youtubeSearch(String(input.query), Number(input.max) || 5),
  },
  {
    spec: {
      name: 'analyze_image',
      description:
        "Analyze an image with Google Cloud Vision. source = a local file path or an image URL. features can include: text (OCR), document (dense OCR), labels, objects, faces, landmarks, logos, safe. Great paired with screenshot_screen to 'read' what's on screen.",
      input_schema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Local file path or https image URL' },
          features: { type: 'array', items: { type: 'string' } },
        },
        required: ['source'],
      },
    },
    handler: async (input, { agent }) =>
      agent.google.analyzeImage(String(input.source), Array.isArray(input.features) ? (input.features as string[]) : ['labels', 'text']),
  },
  {
    spec: {
      name: 'create_apps_script',
      description:
        'Create a Google Apps Script project (automation) in the account with the given JS code. Returns the script id + editor link. Use to build Workspace automations.',
      input_schema: {
        type: 'object',
        properties: { title: { type: 'string' }, code: { type: 'string' } },
        required: ['title', 'code'],
      },
    },
    handler: async (input, { agent }) => agent.google.appsScriptCreate(String(input.title), String(input.code)),
  },
  {
    spec: {
      name: 'read_apps_script',
      description: 'Read the code files of an existing Apps Script project by id.',
      input_schema: { type: 'object', properties: { script_id: { type: 'string' } }, required: ['script_id'] },
    },
    handler: async (input, { agent }) => agent.google.appsScriptGet(String(input.script_id)),
  },
  {
    spec: {
      name: 'ask_gemini',
      description:
        "Ask Google Gemini a question — useful for a second opinion, huge-context reasoning, or Google-flavored knowledge. Returns Gemini's text answer.",
      input_schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
    },
    handler: async (input) => ({ answer: await gemini.ask(String(input.prompt)) }),
  },
  {
    spec: {
      name: 'gemini_generate_image',
      description: 'Generate image(s) with Google Imagen (Gemini) and DISPLAY them (slideshow if multiple).',
      input_schema: {
        type: 'object',
        properties: { prompt: { type: 'string' }, count: { type: 'number' } },
        required: ['prompt'],
      },
    },
    handler: async (input, { agent }) => {
      const imgs = await gemini.generateImages(String(input.prompt), Number(input.count) || 1);
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction =
        imgs.length > 1 ? { type: 'slideshow', images: imgs } : { type: 'image', data: imgs[0] };
      return { generated: imgs.length };
    },
  },
  {
    spec: {
      name: 'generate_image',
      description: 'Generate image(s) from a text prompt with Kling AI and DISPLAY them (slideshow if multiple). Returns the image URLs.',
      input_schema: {
        type: 'object',
        properties: { prompt: { type: 'string' }, aspect_ratio: { type: 'string' }, count: { type: 'number' } },
        required: ['prompt'],
      },
    },
    handler: async (input, { agent }) => {
      const urls = await kling.generateImage(String(input.prompt), {
        aspectRatio: input.aspect_ratio ? String(input.aspect_ratio) : undefined,
        n: Number(input.count) || 1,
      });
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction =
        urls.length > 1 ? { type: 'slideshow', images: urls } : { type: 'image', data: urls[0] };
      return { images: urls };
    },
  },
  {
    spec: {
      name: 'generate_video',
      description: 'Generate a video from a text prompt with Kling AI and DISPLAY it. Slow (minutes). Returns the video URL.',
      input_schema: {
        type: 'object',
        properties: { prompt: { type: 'string' }, aspect_ratio: { type: 'string' }, duration: { type: 'string' } },
        required: ['prompt'],
      },
    },
    handler: async (input, { agent }) => {
      const url = await kling.generateVideo(String(input.prompt), {
        aspectRatio: input.aspect_ratio ? String(input.aspect_ratio) : undefined,
        duration: input.duration ? String(input.duration) : undefined,
      });
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'video', url };
      return { video: url };
    },
  },
  {
    spec: {
      name: 'animate_image',
      description: 'Turn an image (URL) into a short video with Kling AI and DISPLAY it. Returns the video URL.',
      input_schema: {
        type: 'object',
        properties: { image_url: { type: 'string' }, prompt: { type: 'string' } },
        required: ['image_url'],
      },
    },
    handler: async (input, { agent }) => {
      const url = await kling.imageToVideo(String(input.image_url), input.prompt ? String(input.prompt) : '');
      (agent as unknown as { pendingUIAction?: unknown }).pendingUIAction = { type: 'video', url };
      return { video: url };
    },
  },
  {
    spec: {
      name: 'change_voice',
      description:
        'Switch Chance\'s speaking voice. Presets: ' +
        Object.entries(VOICE_PRESETS).map(([n, v]) => `${n}=${v.label}`).join('; ') +
        ". Use when the user says e.g. 'change to voice 2' or 'switch your voice to Christopher'.",
      input_schema: {
        type: 'object',
        properties: { voice: { type: 'string', description: 'Preset number (1-3) or a name like "Christopher"' } },
        required: ['voice'],
      },
    },
    handler: async (input, { agent }) => {
      const raw = String(input.voice).trim();
      const num = Number(raw);
      let chosen: number | string = raw;
      if (!Number.isNaN(num) && VOICE_PRESETS[num]) {
        chosen = num;
      } else {
        const match = Object.entries(VOICE_PRESETS).find(([, v]) => v.label.toLowerCase().includes(raw.toLowerCase()));
        if (match) chosen = Number(match[0]);
      }
      const id = setVoice(chosen);
      try {
        await agent.db.table('settings').upsert({ key: 'tts_voice', value: id, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      } catch { /* best-effort persistence */ }
      const preset = Object.values(VOICE_PRESETS).find((v) => v.id === id);
      return { voice: id, label: preset?.label || id };
    },
  },
  {
    spec: {
      name: 'firetv_status',
      description: 'Check the Fire TV connection (connects if needed and lists ADB devices).',
      input_schema: { type: 'object', properties: {} },
    },
    handler: async () => ({ status: await firetv.status() }),
  },
  {
    spec: {
      name: 'firetv_launch_app',
      description:
        'Launch an app on the Fire TV. Known names: ' + FireTV.appList().join(', ') + '. Or pass a package id.',
      input_schema: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] },
    },
    handler: async (input) => ({ result: await firetv.launchApp(String(input.app)) }),
  },
  {
    spec: {
      name: 'firetv_remote',
      description:
        'Press a Fire TV remote key. Options: ' + FireTV.keyList().join(', ') + '. Use for navigation (up/down/left/right/select/back/home) and playback (play_pause/rewind/fast_forward).',
      input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    },
    handler: async (input) => ({ result: await firetv.key(String(input.key)) }),
  },
  {
    spec: {
      name: 'firetv_type',
      description: 'Type text into the focused field on the Fire TV (e.g. a search box).',
      input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    handler: async (input) => ({ result: await firetv.type(String(input.text)) }),
  },
  {
    spec: {
      name: 'firetv_open_url',
      description: 'Open a URL / deep link on the Fire TV, e.g. a YouTube video URL to play it.',
      input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
    handler: async (input) => ({ result: await firetv.openUrl(String(input.url)) }),
  },
  {
    spec: {
      name: 'send_telegram',
      description:
        "Send a Telegram message. Defaults to the owner (Beckitt) — so 'text me ...' works. To reach a group or another person, pass their numeric chat_id (they must have messaged this bot first; Telegram bots cannot DM strangers by username or phone).",
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          chat_id: { type: 'string', description: 'Numeric chat id; defaults to the owner' },
        },
        required: ['text'],
      },
    },
    handler: async (input) => {
      const token = env.telegram.tokenChance;
      if (!token) return { error: 'No Telegram bot token configured.' };
      const chatId = String(input.chat_id || env.telegram.ownerId || '');
      if (!chatId) return { error: 'No chat_id given and no owner configured to default to.' };
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: String(input.text) }),
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) return { error: data.description || 'Telegram send failed' };
      return { sent: true, chat_id: chatId };
    },
  },
  {
    spec: {
      name: 'save_memory',
      description: 'Persist an important fact or note to long-term memory so it survives across conversations.',
      input_schema: {
        type: 'object',
        properties: { content: { type: 'string' } },
        required: ['content'],
      },
    },
    handler: async (input, { agent }) => {
      await agent.db.remember('note', String(input.content), { via: 'tool' });
      return { saved: true };
    },
  },
  {
    spec: {
      name: 'search_memory',
      description: 'Search long-term memory for relevant past notes or conversation turns.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
    },
    handler: async (input, { agent }) => {
      const rows = await agent.db.recall(50);
      const q = String(input.query || '').toLowerCase();
      return rows
        .filter((r) => String(r.content).toLowerCase().includes(q))
        .slice(0, Number(input.limit) || 5)
        .map((r) => ({ role: r.role, content: r.content, at: r.created_at }));
    },
  },
  {
    spec: {
      name: 'display_in_ui',
      description: 'Display content in the central UI instead of the glowing avatar. Use to show a file, map, screenshot, image, or email to the user visually. When you do this, you do NOT need to describe it in extreme detail in your voice reply, just mention you are putting it on screen.',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['image', 'file', 'map', 'email', 'screenshot'], description: 'The type of content to show.' },
          data: { type: 'string', description: 'The actual data to show: a URL for an image/map/screenshot, or text content for a file/email.' },
        },
        required: ['type', 'data'],
      },
    },
    handler: async (input, { agent }) => {
      agent.pendingUIAction = { type: input.type, data: input.data };
      return { success: true, note: `Displayed ${input.type} on the UI.` };
    },
  },
];

export function toolSpecs(): Anthropic.Tool[] {
  // Native tools + any enabled Zapier actions (8,000+ apps via one connection).
  return [...TOOLS.map((t) => t.spec), ...(zapierMCP.specs() as unknown as Anthropic.Tool[])];
}

export function toolHandler(name: string): ToolDef['handler'] | undefined {
  const native = TOOLS.find((t) => t.spec.name === name)?.handler;
  if (native) return native;
  if (zapierMCP.isZapierTool(name)) {
    return async (input) => zapierMCP.call(name, input as Record<string, unknown>);
  }
  return undefined;
}
