import http from 'node:http';
import path from 'node:path';
import { AgentBrowser } from '../src/core/functions/browser.js';

/**
 * VISIBLE BROWSER CONTROL SERVER
 * ------------------------------
 * Launches the agent's browser in VISIBLE mode and exposes a tiny local HTTP
 * control surface so it can be driven across separate commands:
 *
 *   GET /open?url=<url>   open (or navigate) the visible window
 *   GET /screenshot       save a PNG of the current page -> returns { path }
 *   GET /status           { open, visible, title }
 *   GET /close            close the window (server stays up, can /open again)
 *   GET /shutdown         close everything and exit
 *
 * Run in the background so the window persists:
 *   PORT=8790 START_URL=https://www.youtube.com/watch?v=aqz-KE-bpKQ \
 *     npx tsx scripts/browser-console.ts
 */
const PORT = Number(process.env.PORT || 8790);
const START_URL = process.env.START_URL || '';

const browser = new AgentBrowser({
  headless: false,
  // Interactive/login browser keeps the logged-in profile.
  userDataDir: path.resolve('.browser-profile'),
  // CHANNEL=chrome uses your real installed Chrome — required to log into Google.
  channel: (process.env.CHANNEL as 'chrome' | undefined) || undefined,
  onCaptcha: ({ url }) => console.warn(`[browser-console] 🧩 CAPTCHA at ${url} — solve it in the window.`),
});

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  try {
    switch (u.pathname) {
      case '/open': {
        const url = u.searchParams.get('url');
        if (!url) return json(res, 400, { error: 'missing ?url=' });
        await browser.showWindow();
        await browser.gotoSafe(url);
        return json(res, 200, { ok: true, url, title: await browser.title(), captcha: await browser.hasCaptcha() });
      }
      case '/screenshot': {
        if (!browser.isOpen) return json(res, 409, { error: 'browser not open' });
        const path = u.searchParams.get('path') || `browser_${PORT}.png`;
        await browser.screenshot(path);
        return json(res, 200, { ok: true, path });
      }
      case '/status':
        return json(res, 200, {
          open: browser.isOpen,
          visible: browser.visible,
          title: browser.isOpen ? await browser.title() : null,
        });
      case '/close':
        await browser.close();
        return json(res, 200, { ok: true, closed: true });
      case '/shutdown':
        json(res, 200, { ok: true, bye: true });
        await browser.close();
        server.close();
        setTimeout(() => process.exit(0), 100);
        return;
      default:
        return json(res, 404, { error: 'unknown route', try: ['/open?url=', '/screenshot', '/status', '/close', '/shutdown'] });
    }
  } catch (err) {
    return json(res, 500, { error: (err as Error).message });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`[browser-console] control server on http://127.0.0.1:${PORT}`);
  if (START_URL) {
    try {
      await browser.showWindow();
      await browser.goto(START_URL);
      console.log(`[browser-console] opened visible window: ${await browser.title()}`);
    } catch (err) {
      console.error('[browser-console] failed to open START_URL:', (err as Error).message);
    }
  }
});

process.on('SIGINT', async () => { await browser.close(); process.exit(0); });
process.on('SIGTERM', async () => { await browser.close(); process.exit(0); });
