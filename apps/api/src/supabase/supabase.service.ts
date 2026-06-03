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
    });
  }

  /**
   * Reliably fetch the current user's role by decoding the JWT to get the
   * auth UID, then querying via the admin client (bypasses RLS).
   * This avoids the multi-row maybeSingle() failure that occurs when the
   * school-wide RLS policy returns all users in the school.
   */
  async getUserRole(accessToken: string): Promise<string | null> {
    try {
      const parts = accessToken.split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(
        Buffer.from(parts[1]!, 'base64').toString('utf8'),
      ) as { sub?: string };
      const authUserId = payload.sub;
      if (!authUserId) return null;

      const { data } = await this.admin
        .from('users')
        .select('role')
        .eq('auth_id', authUserId)
        .maybeSingle();

      return (data?.role as string | null) ?? null;
    } catch {
      return null;
    }
  }
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
