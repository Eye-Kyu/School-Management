// =============================================================================
// Browser-side Supabase client
// =============================================================================
// Use this from CLIENT components ('use client').
// It reads cookies from document.cookie and respects RLS via the user's JWT.
// =============================================================================

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
