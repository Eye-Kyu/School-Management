import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ASSIST_MODE_COOKIE } from '@school-manager/types';

// Sets the assist-mode cookie on the apps/web origin. Deliberately NOT
// httpOnly — apps/web and apps/api are different origins, and apiFetch
// already forwards the Supabase session as an explicit Authorization header
// rather than relying on cross-origin cookies; the assist token follows the
// same pattern via an X-Assist-Token header, which requires client JS to be
// able to read this cookie. See packages/types/src/schemas/assist-mode.ts.
export async function POST(req: Request) {
  const { token, expiresAt } = (await req.json()) as { token?: string; expiresAt?: string };
  if (!token || !expiresAt) {
    return NextResponse.json({ error: 'Missing token or expiresAt' }, { status: 400 });
  }

  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  cookies().set(ASSIST_MODE_COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });

  return NextResponse.json({ ok: true });
}
