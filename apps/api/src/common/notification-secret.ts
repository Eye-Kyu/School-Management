import type { ConfigService } from '@nestjs/config';

/**
 * SA-05 (security audit 2026-11): NOTIFICATION_HMAC_SECRET signs receipt
 * download links and email unsubscribe links. Every call site used to fall
 * back to the public literal 'default-secret' when the variable was unset,
 * so anyone could mint a valid link for any payment or user.
 *
 * Returns null when the secret is missing, blank, or still the old public
 * fallback value. Callers must fail closed: verifiers reject the token, and
 * signers omit the link instead of signing with a guessable key.
 */
export function getNotificationHmacSecret(config: ConfigService): string | null {
  const secret = config.get<string>('NOTIFICATION_HMAC_SECRET')?.trim();
  if (!secret || secret === 'default-secret') return null;
  return secret;
}
