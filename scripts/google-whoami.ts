import { GoogleServices } from '../src/core/functions/google.js';

/**
 * Confirms which Google account Chance is connected as, and what she can see.
 *   npm run google:whoami
 */
const g = new GoogleServices();

if (!g.configured) {
  console.error('\n[google] Not configured — add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to .env.\n');
  process.exit(1);
}
if (!g.authorized) {
  console.error('\n[google] No refresh token yet — run `npm run google:auth` first.\n');
  process.exit(1);
}

try {
  const email = await g.whoami();
  console.log(`\n  ✅ Connected as: ${email}\n`);

  try {
    const channels = await g.myChannel();
    if (channels.length) {
      for (const c of channels) {
        console.log(`  📺 YouTube: ${c.snippet?.title}  (subs: ${c.statistics?.subscriberCount ?? '?'}, videos: ${c.statistics?.videoCount ?? '?'})`);
      }
    } else {
      console.log('  📺 YouTube: no channel on this account yet (create one at youtube.com).');
    }
  } catch {
    console.log('  📺 YouTube: API not enabled or no channel (skip).');
  }

  try {
    const events = await g.upcomingEvents(3);
    console.log(`  📅 Calendar: ${events.length} upcoming event(s).`);
  } catch {
    console.log('  📅 Calendar: API not enabled (skip).');
  }
  console.log('');
} catch (e) {
  console.error('\n[google] Call failed:', (e as Error).message);
  console.error('If this says invalid_grant, the refresh token expired (consent screen still in "Testing"?). Re-run google:auth after publishing.\n');
  process.exit(1);
}
