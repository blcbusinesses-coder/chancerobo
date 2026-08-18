import { ChanceAgent } from '../src/agents/chance/ChanceAgent.js';

/**
 * Exercises the agentic tool-use loop through run() (same path every channel uses).
 *   npm run tool:test -- "your prompt"
 * Defaults to a safe, read-only calendar check.
 */
const chance = new ChanceAgent();
const q =
  process.argv.slice(2).join(' ').trim() ||
  'Check my Google Calendar and tell me exactly what is coming up. If nothing, say so plainly.';

console.log(`\n> ${q}\n`);
const res = await chance.run({ channel: 'api', text: q });
console.log(`\n──────── reply [${res.modelUsed} · ${res.complexity}] ────────`);
console.log(res.text);
console.log('────────────────────────────────────────────\n');
await chance.shutdown();
