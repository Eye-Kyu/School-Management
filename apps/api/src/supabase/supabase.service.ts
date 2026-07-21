// =============================================================================
// SupabaseService - two ways to talk to Supabase
// =============================================================================
//
//   admin                    Bypasses RLS. Service-role key.
//                            Use for: signup, system jobs, admin operations.
//
//   forUser(accessToken)     Respects RLS. Anon key + user's JWT.
//                            Use for: 99% of feature queries.
//
// Almost every endpoint should reach for forUser() first. Reaching for admin
// is a code-review red flag - it should come with a comment explaining why.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

// Node.js < 22 has no native WebSocket global, which @supabase/realtime-js
// requires. Passing `ws` as the transport works deterministically regardless
// of Node version or global state — unlike a `globalThis.WebSocket = ws`
// polyfill, this doesn't depend on running before every createClient() call
// (e.g. e2e tests that construct this service directly via NestJS DI,
// bypassing main.ts's top-level polyfill entirely).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALTIME_OPTIONS = { transport: ws } as any;

@Injectable()
export class SupabaseService {
  readonly admin: SupabaseClient;
  private readonly url: string;
  private readonly anonKey: string;

  constructor() {
    this.url = required('SUPABASE_URL');
    this.anonKey = required('SUPABASE_ANON_KEY');
    const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');

    this.admin = createClient(this.url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
    });
  }

  /**
   * Returns a Supabase client scoped to the given user's access token.
   * All queries respect Row-Level Security as that user.
   */
  forUser(accessToken: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      realtime: REALTIME_OPTIONS,
    });
  }

  /** Decodes the JWT's `sub` claim (the Supabase auth user id) — no network call. */
  getAuthUserId(accessToken: string): string | null {
    try {
      const parts = accessToken.split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(
        Buffer.from(parts[1]!, 'base64').toString('utf8'),
      ) as { sub?: string };
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch the caller's own `users` row, filtered by their decoded auth id via
   * the admin client. Use this instead of `client.from('users').select(...).
   * maybeSingle()` with no filter — that pattern breaks as soon as a school
   * has more than one user, because the school-wide RLS SELECT policy
   * legitimately returns every user in the school, and `.maybeSingle()`
   * errors out (not just returns null) on more than one row.
   */
  async currentUserRow(accessToken: string, select: string): Promise<Record<string, unknown> | null> {
    const authUserId = this.getAuthUserId(accessToken);
    if (!authUserId) return null;
    const { data } = await this.admin.from('users').select(select).eq('auth_id', authUserId).maybeSingle();
    return data as unknown as Record<string, unknown> | null;
  }

  /**
   * Reliably fetch the current user's role by decoding the JWT to get the
   * auth UID, then querying via the admin client (bypasses RLS).
   * This avoids the multi-row maybeSingle() failure that occurs when the
   * school-wide RLS policy returns all users in the school.
   */
  async getUserRole(accessToken: string): Promise<string | null> {
    const row = await this.currentUserRow(accessToken, 'role');
    return (row?.role as string | null) ?? null;
  }
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
