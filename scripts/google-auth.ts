import http from 'node:http';
import { promises as fs } from 'node:fs';
import open from 'open';
import { env } from '../src/config/env.js';
import { GoogleServices } from '../src/core/functions/google.js';

/**
 * ONE-TIME GOOGLE CONSENT.
 *   npm run google:auth
 *
 * Opens the consent screen, catches the redirect on localhost, exchanges the
 * code, and writes GOOGLE_REFRESH_TOKEN back into .env. Run once; after that
 * Chance is permanently connected.
 */
if (!env.google.clientId || !env.google.clientSecret) {
  console.error('\n[google:auth] Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.');
  console.error('Create an OAuth client (Web application) in Google Cloud Console first.\n');
  process.exit(1);
}

const g = new GoogleServices();
const redirect = new URL(env.google.redirectUri);
const port = Number(redirect.port || '80');
const callbackPath = redirect.pathname;
const authUrl = g.authUrl();

async function writeEnv(key: string, value: string): Promise<void> {
  const file = '.env';
  let content = await fs.readFile(file, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) content = content.replace(re, () => `${key}=${value}`);
  else content += `${content.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
  await fs.writeFile(file, content);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (u.pathname !== callbackPath) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const err = u.searchParams.get('error');
  const code = u.searchParams.get('code');

  const done = (msg: string, code = 0) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<body style="font-family:system-ui;background:#050b18;color:#e6f1ff;text-align:center;padding:60px"><h2>${msg}</h2><p>You can close this tab and return to the terminal.</p></body>`);
    setTimeout(() => { server.close(); process.exit(code); }, 400);
  };

  if (err) return done(`❌ Consent error: ${err}`, 1);
  if (!code) { res.writeHead(400); res.end('missing code'); return; }

  try {
    const tokens = await g.exchangeCode(code);
    if (!tokens.refresh_token) {
      return done('⚠️ No refresh token returned. Revoke the app under your Google account → Security → Third-party access, then run auth again.', 1);
    }
    await writeEnv('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
    console.log('\n[google:auth] ✅ Refresh token saved to .env — Chance is connected.\n');
    done('✅ Chance is now connected to Google.');
  } catch (e) {
    console.error('[google:auth] token exchange failed:', (e as Error).message);
    done('❌ Token exchange failed — check the terminal.', 1);
  }
});

server.listen(port, async () => {
  console.log(`\n[google:auth] Listening for the callback on ${env.google.redirectUri}`);
  console.log('[google:auth] Opening the consent screen in your browser...');
  console.log('[google:auth] If it does not open, paste this URL manually:\n\n' + authUrl + '\n');
  await open(authUrl).catch(() => {
    console.log('[google:auth] (Could not auto-open a browser — use the URL above.)');
  });
});
