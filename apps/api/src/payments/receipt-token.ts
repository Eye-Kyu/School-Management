import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed, short-lived, unauthenticated receipt-download token — so a
 * parent can tap a receipt link from an SMS/email on their phone without
 * needing to be logged in.
 *
 * Deliberately NOT a copy of NotificationsService's buildUnsubscribeToken/
 * handleUnsubscribe (notifications.service.ts) — that pattern has no
 * expiry at all, which would make a "short-lived" token permanent if
 * copied verbatim. Same overall shape (HMAC-SHA256 over a colon-joined
 * string, base64url-encoded), but with `exp` baked into the signed string
 * and checked on verify, and a constant-time comparison from the start
 * rather than the existing pattern's plain `!==` (matching the spirit of
 * this PR's Task 6c fix elsewhere, without touching that unrelated code).
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h — long enough to tap a link from a phone notification, not permanent

export type ReceiptType = 'paybill' | 'paystack' | 'manual';

export function buildReceiptToken(
  secret: string,
  paymentId: string,
  paymentType: ReceiptType,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const exp = Date.now() + ttlMs;
  const sig = createHmac('sha256', secret).update(`${paymentId}:${paymentType}:${exp}`).digest('hex');
  return Buffer.from(JSON.stringify({ paymentId, paymentType, exp, sig })).toString('base64url');
}

export function verifyReceiptToken(secret: string, token: string): { paymentId: string; paymentType: ReceiptType } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const payload = JSON.parse(decoded) as { paymentId: string; paymentType: ReceiptType; exp: number; sig: string };
    const expected = createHmac('sha256', secret).update(`${payload.paymentId}:${payload.paymentType}:${payload.exp}`).digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(payload.sig, 'hex');
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;
    if (Date.now() > payload.exp) return null;

    return { paymentId: payload.paymentId, paymentType: payload.paymentType };
  } catch {
    return null;
  }
}
