import { existsSync } from 'node:fs';
import { AgentBrowser } from '../src/core/functions/browser.js';

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
console.log('[browsers:test] Edge executable:', edge ?? 'NOT FOUND');

const cases: Array<[string, Record<string, unknown>]> = [
  ['chrome', { channel: 'chrome' }],
  ['edge', { executablePath: edge }],
];

for (const [name, opts] of cases) {
  const b = new AgentBrowser({ headless: true, userDataDir: `.browser-test-${name}`, ...opts });
  try {
    await b.goto('https://example.com');
    console.log(`[browsers:test] ${name} ✅ launched — title: "${await b.title()}"`);
  } catch (e) {
    console.log(`[browsers:test] ${name} ❌ ${(e as Error).message}`);
  } finally {
    await b.close();
  }
}
