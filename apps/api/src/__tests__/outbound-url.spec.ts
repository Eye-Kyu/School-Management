// SA-35 (security audit 2026-11): school webhook URLs must not reach internal hosts.
import { assertSafeWebhookUrl, isBlockedAddress, UnsafeOutboundUrlError } from '../common/outbound-url';

const resolvesTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));

describe('outbound webhook URL guard (SA-35)', () => {
  it.each([
    'http://hooks.example.com/x',
    'https://user:pass@hooks.example.com/x',
    'https://localhost/x',
    'https://api.railway.internal/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.5/x',
    'https://[::1]/x',
    'https://[::ffff:127.0.0.1]/x',
    'not a url',
  ])('rejects %s', async (url) => {
    await expect(assertSafeWebhookUrl(url, resolvesTo('93.184.216.34'))).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });

  it('rejects a public-looking hostname that resolves to a private address (DNS rebinding)', async () => {
    await expect(assertSafeWebhookUrl('https://evil.example/hook', resolvesTo('93.184.216.34', '10.1.2.3')))
      .rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });

  it('rejects an unresolvable hostname', async () => {
    await expect(assertSafeWebhookUrl('https://nope.example/hook', async () => { throw new Error('ENOTFOUND'); }))
      .rejects.toBeInstanceOf(UnsafeOutboundUrlError);
  });

  it('accepts an https URL whose host resolves only to public addresses', async () => {
    await expect(assertSafeWebhookUrl('https://hooks.example.com/skuli', resolvesTo('93.184.216.34', '2606:2800:220:1::1')))
      .resolves.toBeInstanceOf(URL);
  });

  it('classifies addresses', () => {
    for (const a of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(a)).toBe(true);
    }
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:2800:220:1::1']) {
      expect(isBlockedAddress(a)).toBe(false);
    }
  });
});
