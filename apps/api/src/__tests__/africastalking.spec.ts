import { ConfigService } from '@nestjs/config';
import { AfricasTalkingClient, normalizePhoneNumber } from '../notifications/africastalking.client';

function configWith(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('normalizePhoneNumber', () => {
  it('passes through a valid E.164 number unchanged', () => {
    expect(normalizePhoneNumber('+254712345678')).toBe('+254712345678');
  });

  it('converts a local 0-prefixed number to E.164', () => {
    expect(normalizePhoneNumber('0712345678')).toBe('+254712345678');
  });

  it('adds a + to a bare 254-prefixed number', () => {
    expect(normalizePhoneNumber('254712345678')).toBe('+254712345678');
  });

  it('strips whitespace and dashes before normalizing', () => {
    expect(normalizePhoneNumber('0712 345-678')).toBe('+254712345678');
  });

  it('returns null for an unfixable number rather than guessing a country code', () => {
    expect(normalizePhoneNumber('12345')).toBeNull();
    expect(normalizePhoneNumber('not-a-phone')).toBeNull();
    expect(normalizePhoneNumber('')).toBeNull();
  });
});

describe('AfricasTalkingClient.sendSms', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('returns an error and never calls fetch when credentials are missing', async () => {
    const client = new AfricasTalkingClient(configWith({}));
    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await client.sendSms('+254712345678', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns an error for a malformed phone number without calling fetch', async () => {
    const client = new AfricasTalkingClient(configWith({ AFRICASTALKING_USERNAME: 'u', AFRICASTALKING_API_KEY: 'k' }));
    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await client.sendSms('not-a-phone', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/normalize/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports success and the raw provider cost on a successful send', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        SMSMessageData: {
          Message: 'Sent to 1/1',
          Recipients: [{ statusCode: 101, number: '+254712345678', status: 'Success', cost: 'KES 0.8000', messageId: 'ATXid_123' }],
        },
      }),
    }) as unknown as typeof fetch;

    const client = new AfricasTalkingClient(configWith({ AFRICASTALKING_USERNAME: 'u', AFRICASTALKING_API_KEY: 'k' }));
    const result = await client.sendSms('0712345678', 'hello');
    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('ATXid_123');
    expect(result.cost).toBe('KES 0.8000');
  });

  it('treats a provider-side rejection as failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        SMSMessageData: {
          Message: 'Sent to 0/1',
          Recipients: [{ statusCode: 401, number: '+254712345678', status: 'InsufficientBalance' }],
        },
      }),
    }) as unknown as typeof fetch;

    const client = new AfricasTalkingClient(configWith({ AFRICASTALKING_USERNAME: 'u', AFRICASTALKING_API_KEY: 'k' }));
    const result = await client.sendSms('+254712345678', 'hello');
    expect(result.success).toBe(false);
    expect(result.error).toBe('InsufficientBalance');
  });

  it('picks the sandbox URL by default and the production URL when configured', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ SMSMessageData: { Message: '', Recipients: [{ statusCode: 101, number: '+254712345678', status: 'Success' }] } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const sandbox = new AfricasTalkingClient(configWith({ AFRICASTALKING_USERNAME: 'u', AFRICASTALKING_API_KEY: 'k' }));
    await sandbox.sendSms('+254712345678', 'hi');
    expect(fetchMock.mock.calls[0][0]).toContain('sandbox');

    const production = new AfricasTalkingClient(configWith({ AFRICASTALKING_USERNAME: 'u', AFRICASTALKING_API_KEY: 'k', AFRICASTALKING_MODE: 'production' }));
    await production.sendSms('+254712345678', 'hi');
    expect(fetchMock.mock.calls[1][0]).not.toContain('sandbox');
  });
});
