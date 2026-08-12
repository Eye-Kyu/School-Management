// =============================================================================
// hashForAnalytics — server-only. NEVER import this from a 'use client' file.
// =============================================================================
// Uses Node's `crypto` module directly, which does not exist in the browser
// — importing this from client code would break the client bundle, not just
// leak POSTHOG_HASH_SALT (see docs/audits/posthog-capture-audit.md for why
// the salt must stay server-only in the first place). Client components that
// need a hashed identity call GET /api/analytics/identity instead, which
// wraps this function server-side.
// =============================================================================

import { createHash } from 'crypto';

export function hashForAnalytics(value: string): string {
  const salt = process.env.POSTHOG_HASH_SALT;
  if (!salt) {
    throw new Error('POSTHOG_HASH_SALT is not set — see apps/web/README-POSTHOG.md');
  }
  return createHash('sha256').update(`${value}${salt}`).digest('hex');
}
