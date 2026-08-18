import { AgentBrowser } from '../src/core/functions/browser.js';

const b = new AgentBrowser();
try {
  await b.goto('https://example.com');
  console.log('[browse:test] ✅ title:', await b.title());
  console.log('[browse:test] text:', (await b.extractText()).slice(0, 80));
} catch (e) {
  console.error('[browse:test] ❌ ERROR:', (e as Error).message);
} finally {
  await b.close();
}
