import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';
import type { AgentPermissions } from '../types.js';

/**
 * MANDATORY FUNCTION #1 — DEDICATED SUPABASE TABLES (+ RLS)
 * ---------------------------------------------------------
 * Each agent operates against its own dedicated schema (named after its slug).
 * Row Level Security (see supabase/migrations) restricts a sub-agent to its
 * own schema. CHANCE (the Overseer) uses the service-role key, which bypasses
 * RLS and therefore has master read/write across ALL agent schemas.
 *
 * Rule of thumb:
 *   - overseer=true  -> service role client (master access, all schemas)
 *   - overseer=false -> anon client (RLS-scoped to the agent's own schema)
 */
export class AgentDatabase {
  readonly schema: string;
  private client: SupabaseClient;
  private isOverseer: boolean;

  constructor(schema: string, permissions: AgentPermissions) {
    this.schema = schema;
    this.isOverseer = permissions.overseer;

    if (this.isOverseer) {
      // Master keys: full cross-schema access for the Overseer.
      this.client = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
        auth: { persistSession: false },
        db: { schema },
      });
    } else {
      // Scoped: RLS in Postgres constrains this agent to its own schema.
      this.client = createClient(env.supabase.url, env.supabase.anonKey, {
        auth: { persistSession: false },
        db: { schema },
      });
    }
  }

  /** Returns a query builder bound to a table in THIS agent's schema. */
  table(name: string) {
    return this.client.from(name);
  }

  /**
   * Overseer-only: reach into any agent's schema. Throws for non-overseers
   * as a defense-in-depth check on top of database RLS.
   */
  crossSchema(schema: string) {
    if (!this.isOverseer) {
      throw new Error(
        `[db] Agent "${this.schema}" is not the Overseer and cannot access schema "${schema}".`,
      );
    }
    const master = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
      auth: { persistSession: false },
      db: { schema },
    });
    return {
      table: (name: string) => master.from(name),
    };
  }

  /** Convenience: append a row to this agent's memory/log table. */
  async remember(role: string, content: string, meta: Record<string, unknown> = {}) {
    const { error } = await this.table('memory').insert({ role, content, meta });
    if (error) throw new Error(`[db] remember() failed: ${error.message}`);
  }

  /** Convenience: fetch this agent's recent memory rows. */
  async recall(limit = 20) {
    const { data, error } = await this.table('memory')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`[db] recall() failed: ${error.message}`);
    return data ?? [];
  }
}
