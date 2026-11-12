import { promises as dns } from 'dns';
import { isIP } from 'net';
import { isIpAllowed } from '../payments/ip-allowlist';

/**
 * SA-35 (security audit 2026-11): school admins configure webhook URLs that
 * the API server POSTs to. Without checks, an admin could aim them at
 * internal services (Railway private network, loopback, cloud metadata) and
 * read status codes back from webhook_deliveries.
 *
 * Addresses that must never be an outbound webhook target. Used with the
 * existing CIDR matcher.
 */
const BLOCKED_RANGES = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
  '224.0.0.0/4', '240.0.0.0/4',
  '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8', '2001:db8::/32', '64:ff9b::/96',
].join(',');

export class UnsafeOutboundUrlError extends Error {}

/** True when the address is loopback/private/link-local/metadata/reserved. */
export function isBlockedAddress(address: string): boolean {
  let ip = address.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  // IPv4-mapped IPv6 (::ffff:10.0.0.1): judge the embedded IPv4 address.
  // The URL parser normalizes it to hex (::ffff:7f00:1), so accept both forms.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) ip = mapped[1]!;
  else if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16), lo = parseInt(mappedHex[2]!, 16);
    ip = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (!isIP(ip)) return true; // unparseable: refuse
  return isIpAllowed(ip, BLOCKED_RANGES);
}

/** Synchronous shape checks (scheme, credentials, literal host). Throws UnsafeOutboundUrlError. */
export function assertWebhookUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeOutboundUrlError('Webhook URL is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new UnsafeOutboundUrlError('Webhook URL must use https');
  if (url.username || url.password) throw new UnsafeOutboundUrlError('Webhook URL must not contain credentials');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new UnsafeOutboundUrlError('Webhook URL must point to a public host');
  }
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(literal) && isBlockedAddress(literal)) throw new UnsafeOutboundUrlError('Webhook URL must point to a public host');
  return url;
}

type Lookup = (host: string) => Promise<Array<{ address: string }>>;
const defaultLookup: Lookup = (host) => dns.lookup(host, { all: true, verbatim: true });

/**
 * Full check: shape, plus every address the hostname resolves to must be
 * public. Called when an endpoint is saved and again just before each
 * delivery. The re-check narrows DNS rebinding; a small time-of-check gap
 * between this lookup and fetch's own connection remains.
 */
export async function assertSafeWebhookUrl(raw: string, lookup: Lookup = defaultLookup): Promise<URL> {
  const url = assertWebhookUrlShape(raw);
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(host)) return url; // literal already checked
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host);
  } catch {
    throw new UnsafeOutboundUrlError('Webhook host could not be resolved');
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new UnsafeOutboundUrlError('Webhook URL must point to a public host');
  }
  return url;
}
