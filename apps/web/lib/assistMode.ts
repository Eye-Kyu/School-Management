// =============================================================================
// Assist-mode helpers shared between lib/supabase/server.ts (read scoping),
// middleware.ts (routing), and the banner component (display).
// =============================================================================
// Two verify functions, deliberately not one: @nestjs/jwt signs with HS256,
// and lib/supabase/server.ts's createClient() MUST stay synchronous (every
// server component in this app calls it without `await` — making it async
// would be a breaking change across the entire dashboard). verifyAssistTokenSync
// checks the HMAC by hand with Node's `crypto` for that call site.
// middleware.ts runs in the Edge runtime instead, where Node's `crypto` isn't
// available and the function is already async by nature — it uses `jose`.

import { createHmac, timingSafeEqual } from 'crypto';
import { AssistModeClaims, type AssistModeClaims as AssistModeClaimsType } from '@school-manager/types';

export { ASSIST_MODE_COOKIE } from '@school-manager/types';

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/** Node-runtime, synchronous HS256 verify — for server components / route handlers. */
export function verifyAssistTokenSync(token: string | undefined | null): AssistModeClaimsType | null {
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  try {
    const expectedSig = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
    const actualSig = base64UrlDecode(sigB64);
    if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) return null;

    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;

    return AssistModeClaims.parse(payload);
  } catch {
    return null;
  }
}

/** Edge-runtime, async HS256 verify (jose) — for middleware.ts only. */
export async function verifyAssistTokenEdge(token: string | undefined | null): Promise<AssistModeClaimsType | null> {
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return AssistModeClaims.parse(payload);
  } catch {
    return null;
  }
}
