import { AgentDatabase } from '../src/core/functions/database.js';

/**
 * Verifies Chance's Supabase memory end-to-end (write + read).
 *   npm run db:test
 */
const db = new AgentDatabase('chance', { overseer: true, canDelegate: true, schemaAccess: ['*'] });

console.log('[db:test] writing a memory row...');
await db.remember('user', 'db:test — if you can read this back, memory works.', { source: 'db-test' });

console.log('[db:test] reading recent memory...');
const rows = await db.recall(3);
console.log(`[db:test] ✅ ${rows.length} row(s) in chance.memory:`);
for (const r of rows) {
  console.log(`   - [${r.role}] ${String(r.content).slice(0, 60)}  (${r.created_at})`);
}
