// =============================================================================
// API client - thin wrapper around fetch that adds the auth header
// =============================================================================
// Use from client components via TanStack Query hooks (see lib/hooks/).
// Server components should query Supabase directly via lib/supabase/server.
// =============================================================================

import { createClient } from '@/lib/supabase/client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new ApiError(res.status, `API ${res.status}: ${res.statusText}`, body);
  }

  return (await res.json()) as T;
}
