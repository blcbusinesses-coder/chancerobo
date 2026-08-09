import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { env } from '../src/config/env.js';

/**
 * Minimal migration runner: executes every .sql file in supabase/migrations
 * in filename order, using the service-role key (required for DDL + RLS).
 *
 * Requires a Postgres RPC named `exec_sql(sql text)` in your project, OR run
 * the .sql files directly via the Supabase SQL editor / `supabase db push`.
 * This runner uses the RPC path so it works from CI without the Supabase CLI.
 *
 *   Setup once in the SQL editor:
 *     create or replace function exec_sql(sql text) returns void
 *     language plpgsql security definer as $$ begin execute sql; end; $$;
 */
async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(__dirname, '..', 'supabase', 'migrations');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    console.log('[migrate] No migrations found.');
    return;
  }

  const supabase = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });

  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    console.log(`[migrate] Applying ${file} ...`);
    const { error } = await supabase.rpc('exec_sql', { sql });
    if (error) {
      console.error(`[migrate] FAILED on ${file}: ${error.message}`);
      process.exit(1);
    }
    console.log(`[migrate] ✓ ${file}`);
  }
  console.log('[migrate] All migrations applied.');
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
