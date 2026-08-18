import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentBrowser } from '../src/core/functions/browser.js';

/**
 * Interactive proof of the CAPTCHA -> human hand-off.
 *
 * 1. Starts the browser HEADLESS (invisible) and loads a page that looks like a
 *    bot-check (has a `.g-recaptcha` widget + "verify you are human" text).
 * 2. gotoSafe() detects it and AUTOMATICALLY opens a visible window.
 * 3. YOU click "I'm human" in the window.
 * 4. The check clears, and automation resumes on its own and reads the page.
 */
const scratch = process.env.SCRATCH || path.resolve('.captcha-demo');
await fs.mkdir(scratch, { recursive: true });

const html = `<!doctype html><meta charset="utf-8">
<title>Bot Check</title>
<body style="font-family:system-ui;background:#0b1b2e;color:#e6f1ff;text-align:center;padding:60px">
  <h1>Security check</h1>
  <p id="phrase">Please verify you are human to continue.</p>
  <div class="g-recaptcha" style="display:inline-block;padding:18px 26px;border:1px solid #00e5ff;border-radius:12px;margin:16px">
    &#9744; &nbsp; I'm not a robot
  </div>
  <p><button id="solve" style="font-size:18px;padding:12px 22px;border:0;border-radius:10px;background:#00e5ff;color:#04222c;font-weight:700;cursor:pointer">
    Click to solve (this is you, the human)
  </button></p>
  <script>
    document.getElementById('solve').onclick = () => {
      document.querySelector('.g-recaptcha').remove();  // remove the widget marker
      document.getElementById('phrase').remove();       // remove the trigger phrase
      document.body.insertAdjacentHTML('beforeend', '<h2 id="ok" style="color:#29e0a8">✅ Verified — you may proceed</h2>');
    };
  </script>
</body>`;

const file = path.join(scratch, 'botcheck.html');
await fs.writeFile(file, html);
const url = pathToFileURL(file).href;

const browser = new AgentBrowser({
  headless: true, // start INVISIBLE, like real automation
  userDataDir: path.join(scratch, 'profile'),
  onCaptcha: ({ url }) => console.warn(`\n>>> CAPTCHA detected at ${url} — a window is opening. Click the button in it. <<<\n`),
});

console.log('[captcha-test] Loading bot-check page headlessly...');
await browser.gotoSafe(url); // detects captcha -> opens window -> waits for you -> resumes

// If we got here, the check cleared.
const proceed = await browser.evaluate(() => document.getElementById('ok')?.textContent || document.title);
console.log(`[captcha-test] Resumed automation. Page now says: "${proceed}"`);

await browser.close();
console.log('[captcha-test] Done — window closed.');
