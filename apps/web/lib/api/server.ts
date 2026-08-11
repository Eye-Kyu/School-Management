// =============================================================================
// Server-side API client — same shape as apiFetch (lib/api/index.ts), but
// resolves the session via the server-side Supabase client (cookies) instead
// of the browser SDK. No prior precedent for a server component calling the
// NestJS API existed before this (every existing apiFetch call site is in a
// 'use client' file) — this is what the /notifications page needs to stop
// querying Supabase directly and call GET /dashboard-feed instead.
// =============================================================================

import { createClient } from '@/lib/supabase/server';
import { API_BASE, ApiError } from './index';

export async function serverApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    // Next.js extends fetch with its own data cache — the backend already
    // has a 60s per-user TTL cache of its own, so this must always hit it
    // fresh rather than being cached again at the Next.js layer on top.
    cache: 'no-store',
  });

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
