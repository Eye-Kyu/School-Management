// =============================================================================
// API client - thin wrapper around fetch that adds the auth header
// =============================================================================
// Use from client components via TanStack Query hooks (see lib/hooks/).
// Server components should query Supabase directly via lib/supabase/server.
// =============================================================================

import { createClient } from '@/lib/supabase/client';
import { ASSIST_MODE_COOKIE } from '@school-manager/types';

function getAssistToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${ASSIST_MODE_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : undefined;
}

// A scheme-less NEXT_PUBLIC_API_URL (e.g. "api.example.com" instead of
// "https://api.example.com") gets resolved by fetch() as a same-origin
// relative path — every API call silently 404s against the web app itself
// instead of erroring loudly against the wrong host. Normalize it so a
// misconfigured env var fails visibly (cross-origin/network error naming
// the real host) instead of silently.
function resolveApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return 'http://localhost:4000';
  if (!/^https?:\/\//i.test(raw)) {
    const fixed = `https://${raw}`;
    // eslint-disable-next-line no-console
    console.error(
      `[api] NEXT_PUBLIC_API_URL="${raw}" is missing a scheme and would resolve as a relative path. Using "${fixed}" instead — fix the env var.`,
    );
    return fixed;
  }
  return raw;
}

export const API_BASE = resolveApiBase();

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
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

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const assistToken = getAssistToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(assistToken ? { 'X-Assist-Token': assistToken } : {}),
      ...init.headers,
    },
  });

  return handleResponse<T>(res);
}

// For multipart/form-data bodies (file uploads) — apiFetch() always sets
// Content-Type: application/json, which stomps the browser-generated
// `multipart/form-data; boundary=...` header a FormData body needs. No
// Content-Type is set here at all; fetch() derives the correct one (with
// boundary) automatically whenever the body is a FormData instance.
export async function apiUpload<T>(path: string, formData: FormData, init: RequestInit = {}): Promise<T> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const assistToken = getAssistToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    method: init.method ?? 'POST',
    body: formData,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(assistToken ? { 'X-Assist-Token': assistToken } : {}),
      ...init.headers,
    },
  });

  return handleResponse<T>(res);
}
