// =============================================================================
// Server-side Supabase client (App Router server components)
// =============================================================================
// Use this from SERVER components and route handlers. It reads/writes the
// session cookie via next/headers. RLS is enforced as the authenticated user.
// =============================================================================

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component where cookies are read-only.
            // The middleware refreshes the session cookie, so this is safe to ignore.
          }
        },
        remove(name: string, options: Record<string, unknown>) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // See note above.
          }
        },
      },
    },
  );
}
