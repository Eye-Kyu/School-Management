import { ipInCidr, isIpAllowed } from '../payments/ip-allowlist';

describe('ipInCidr — IPv4', () => {
  it('matches an exact /32', () => {
    expect(ipInCidr('196.201.214.200', '196.201.214.200/32')).toBe(true);
    expect(ipInCidr('196.201.214.201', '196.201.214.200/32')).toBe(false);
  });

  it('matches within a range', () => {
    expect(ipInCidr('196.201.214.5', '196.201.214.0/24')).toBe(true);
    expect(ipInCidr('196.201.215.5', '196.201.214.0/24')).toBe(false);
  });

  it('/0 matches everything', () => {
    expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).toBe(true);
    expect(ipInCidr('255.255.255.255', '0.0.0.0/0')).toBe(true);
  });

  it('respects a non-byte-aligned prefix', () => {
    expect(ipInCidr('10.0.0.1', '10.0.0.0/30')).toBe(true);
    expect(ipInCidr('10.0.0.3', '10.0.0.0/30')).toBe(true);
    expect(ipInCidr('10.0.0.4', '10.0.0.0/30')).toBe(false);
  });
});

describe('ipInCidr — IPv6', () => {
  it('matches an exact /128', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::1/128')).toBe(true);
    expect(ipInCidr('2001:db8::2', '2001:db8::1/128')).toBe(false);
  });

  it('matches within a range using :: compression', () => {
    expect(ipInCidr('2001:db8::abcd', '2001:db8::/32')).toBe(true);
    expect(ipInCidr('2001:db9::abcd', '2001:db8::/32')).toBe(false);
  });

  it('/0 matches everything', () => {
    expect(ipInCidr('::1', '::/0')).toBe(true);
    expect(ipInCidr('ffff::1', '::/0')).toBe(true);
  });
});

describe('ipInCidr — malformed input fails closed', () => {
  it('returns false (never throws) for garbage input', () => {
    expect(ipInCidr('not-an-ip', '10.0.0.0/8')).toBe(false);
    expect(ipInCidr('10.0.0.1', 'not-a-cidr')).toBe(false);
    expect(ipInCidr('10.0.0.1', '10.0.0.0/999')).toBe(false);
    expect(ipInCidr('', '')).toBe(false);
  });

  it('returns false for an address-family mismatch', () => {
    expect(ipInCidr('10.0.0.1', '::/0')).toBe(false);
    expect(ipInCidr('::1', '0.0.0.0/0')).toBe(false);
  });
});

describe('isIpAllowed', () => {
  it('matches against any entry in a comma-separated list', () => {
    expect(isIpAllowed('196.201.214.5', '10.0.0.0/8, 196.201.214.0/24')).toBe(true);
    expect(isIpAllowed('8.8.8.8', '10.0.0.0/8, 196.201.214.0/24')).toBe(false);
  });

  it('matches nothing for an empty or undefined allowlist', () => {
    expect(isIpAllowed('1.2.3.4', '')).toBe(false);
    expect(isIpAllowed('1.2.3.4', undefined)).toBe(false);
  });
});
