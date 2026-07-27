import { isIPv4, isIPv6 } from 'net';

/**
 * Hand-rolled CIDR matching (IPv4 + IPv6) — no new dependency, matching this
 * codebase's consistent house style of small utility functions over adding a
 * library for something this contained. Used to restrict the Daraja C2B
 * callback endpoints to Safaricom's published IP ranges in production.
 */

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

// A plain `x << (32 - prefix)` breaks at prefix=0 in JS: shift amounts are
// taken mod 32, so `<< 32` is actually `<< 0` (a no-op), not "shift
// everything out." Building the mask this way handles prefix=0 (match
// everything) and prefix=32 (exact match) correctly.
function ipv4Mask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff >>> 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

// Expands "::" compression and (partially) zero-pads to 8 groups. Handles
// the common real-world forms; doesn't handle zone IDs (%eth0) or embedded
// IPv4-in-IPv6 — not needed for matching Safaricom's published ranges,
// which are IPv4, but implemented properly (BigInt, not a 32-bit shift)
// since the task explicitly asks for IPv6 support too.
function ipv6ToBigInt(ip: string): bigint {
  const parts = ip.split('::');
  let head: string[];
  let tail: string[];
  if (parts.length === 2) {
    head = parts[0] ? parts[0].split(':') : [];
    tail = parts[1] ? parts[1].split(':') : [];
  } else {
    head = ip.split(':');
    tail = [];
  }
  const missing = 8 - (head.length + tail.length);
  if (missing < 0) throw new Error(`Malformed IPv6 address: ${ip}`);
  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  if (groups.length !== 8) throw new Error(`Malformed IPv6 address: ${ip}`);

  let result = 0n;
  for (const g of groups) {
    const n = parseInt(g === '' ? '0' : g, 16);
    if (!Number.isFinite(n) || n < 0 || n > 0xffff) throw new Error(`Malformed IPv6 group in: ${ip}`);
    result = (result << 16n) | BigInt(n);
  }
  return result;
}

function ipv6Mask(prefix: number): bigint {
  if (prefix <= 0) return 0n;
  if (prefix >= 128) return (1n << 128n) - 1n;
  return ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
}

/** Fails closed: any parse error or address-family mismatch returns false, never throws. */
export function ipInCidr(ip: string, cidr: string): boolean {
  try {
    const slashIndex = cidr.lastIndexOf('/');
    if (slashIndex === -1) return false;
    const rangeIp = cidr.slice(0, slashIndex);
    const prefix = Number(cidr.slice(slashIndex + 1));
    if (!Number.isInteger(prefix) || prefix < 0) return false;

    if (isIPv4(ip) && isIPv4(rangeIp)) {
      if (prefix > 32) return false;
      const mask = ipv4Mask(prefix);
      return (ipv4ToInt(ip) & mask) === (ipv4ToInt(rangeIp) & mask);
    }
    if (isIPv6(ip) && isIPv6(rangeIp)) {
      if (prefix > 128) return false;
      const mask = ipv6Mask(prefix);
      return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(rangeIp) & mask);
    }
    return false; // address-family mismatch (e.g. a v4 ip against a v6 range)
  } catch {
    return false;
  }
}

/** Checks an IP against a comma-separated CIDR list (from an env var). Empty/blank list matches nothing. */
export function isIpAllowed(ip: string, allowlistCsv: string | undefined): boolean {
  const ranges = (allowlistCsv ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return ranges.some((cidr) => ipInCidr(ip, cidr));
}
