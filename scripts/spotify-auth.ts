import http from 'node:http';
import { promises as fs } from 'node:fs';
import open from 'open';
import { env } from '../src/config/env.js';
import { SPOTIFY_SCOPES } from '../src/core/functions/spotify.js';

/**
 * ONE-TIME SPOTIFY CONSENT.
 *   node --import tsx scripts/spotify-auth.ts
 *
 * Opens Spotify's authorize screen, catches the redirect on 127.0.0.1:8888,
 * exchanges the code for tokens, and writes SPOTIFY_REFRESH_TOKEN back into
 * .env. Run once; after that Chance can control your playback forever.
 */
if (!env.spotify.clientId || !env.spotify.clientSecret) {
  console.error('\n[spotify:auth] Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in .env.\n');
  process.exit(1);
}

const redirect = new URL(env.spotify.redirectUri);
const port = Number(redirect.port || '8888');
const callbackPath = redirect.pathname;
const basic = Buffer.from(`${env.spotify.clientId}:${env.spotify.clientSecret}`).toString('base64');

const authUrl =
  'https://accounts.spotify.com/authorize?' +
  new URLSearchParams({
    response_type: 'code',
    client_id: env.spotify.clientId,
    scope: SPOTIFY_SCOPES,
    redirect_uri: env.spotify.redirectUri,
    show_dialog: 'true',
  }).toString();

async function writeEnv(key: string, value: string): Promise<void> {
  const file = '.env';
  let content = await fs.readFile(file, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) content = content.replace(re, () => `${key}=${value}`);
  else content += `${content.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
  await fs.writeFile(file, content);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if (u.pathname !== callbackPath) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const err = u.searchParams.get('error');
  const code = u.searchParams.get('code');

  const done = (msg: string, exitCode = 0) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<body style="font-family:system-ui;background:#050b18;color:#e6f1ff;text-align:center;padding:60px"><h2>${msg}</h2><p>You can close this tab and return to the terminal.</p></body>`);
    setTimeout(() => { server.close(); process.exit(exitCode); }, 400);
  };

  if (err) return done(`❌ Consent error: ${err}`, 1);
  if (!code) { res.writeHead(400); res.end('missing code'); return; }

  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: env.spotify.redirectUri,
      }),
    });
    const j: any = await tokenRes.json();
    if (!tokenRes.ok || !j.refresh_token) {
      console.error('[spotify:auth] token exchange failed:', JSON.stringify(j));
      return done('❌ Token exchange failed — check the terminal.', 1);
    }
    await writeEnv('SPOTIFY_REFRESH_TOKEN', j.refresh_token);
    console.log('\n[spotify:auth] ✅ Refresh token saved to .env — Chance can now control Spotify.\n');
    done('✅ Chance is now connected to Spotify.');
  } catch (e) {
    console.error('[spotify:auth] error:', (e as Error).message);
    done('❌ Token exchange failed — check the terminal.', 1);
  }
});

server.listen(port, async () => {
  console.log(`\n[spotify:auth] Listening for the callback on ${env.spotify.redirectUri}`);
  console.log('[spotify:auth] Opening the Spotify authorize screen...');
  console.log('[spotify:auth] If it does not open, paste this URL manually:\n\n' + authUrl + '\n');
  await open(authUrl).catch(() => {
    console.log('[spotify:auth] (Could not auto-open a browser — use the URL above.)');
  });
});
