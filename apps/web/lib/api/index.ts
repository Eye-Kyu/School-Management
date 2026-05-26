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

  // Read the body as text once, then try to parse as JSON.
  // This avoids "body stream already read" errors that occur when
  // res.json() throws and we then try res.text() on the same response.
  const text = await res.text();

  if (!res.ok) {
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch { /* keep as plain text */ }
    const msg = (body as Record<string, unknown>)?.message;
    const message = typeof msg === 'string' ? msg : Array.isArray(msg) ? (msg as string[]).join('; ') : text || `${res.status}: ${res.statusText}`;
    throw new ApiError(res.status, message, body);
  }

  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}
