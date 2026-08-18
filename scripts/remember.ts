import { AgentDatabase } from '../src/core/functions/database.js';

/** Write a note directly into Chance's memory. npm run remember -- "text" */
const db = new AgentDatabase('chance', { overseer: true, canDelegate: true, schemaAccess: ['*'] });
const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error('provide text');
  process.exit(1);
}
await db.remember('note', text, { source: 'system-correction' });
console.log('[remember] saved:', text);
