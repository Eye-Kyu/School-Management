import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendSmsResult = {
  success: boolean;
  providerMessageId: string | null;
  /** Raw provider-reported cost string, e.g. "KES 0.8000" — parsed at the call site, not here. */
  cost: string | null;
  error?: string;
};

type AfricasTalkingRecipient = {
  statusCode: number;
  number: string;
  status: string;
  cost?: string;
  messageId?: string;
};
type AfricasTalkingResponse = {
  SMSMessageData?: {
    Message: string;
    Recipients: AfricasTalkingRecipient[];
  };
};

const SANDBOX_URL = 'https://api.sandbox.africastalking.com/version1/messaging';
const PRODUCTION_URL = 'https://api.africastalking.com/version1/messaging';

/**
 * Converts a locally-stored phone number to the E.164 shape Africa's
 * Talking requires. Returns null (not a guess) if the number can't be
 * normalized confidently — a wrong country-code guess would silently send
 * to the wrong person.
 */
export function normalizePhoneNumber(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s-]/g, '');
  if (/^\+\d{7,15}$/.test(trimmed)) return trimmed;
  if (/^0\d{8,9}$/.test(trimmed)) return `+254${trimmed.slice(1)}`;
  if (/^254\d{9}$/.test(trimmed)) return `+${trimmed}`;
  return null;
}

/**
 * Thin wrapper around Africa's Talking's SMS API. A real NestJS provider
 * (not just instantiated inline like initBrevo()) specifically so e2e tests
 * can override it with a mock via moduleBuilder.overrideProvider() —
 * without live credentials, sendSms() would otherwise always short-circuit
 * to "not configured" and the SENT/message_send_log path could never be
 * exercised in this environment.
 */
@Injectable()
export class AfricasTalkingClient {
  private readonly username: string | null;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.username = config.get<string>('AFRICASTALKING_USERNAME') || null;
    this.apiKey = config.get<string>('AFRICASTALKING_API_KEY') || null;
    const mode = config.get<string>('AFRICASTALKING_MODE') ?? 'sandbox';
    this.baseUrl = mode === 'production' ? PRODUCTION_URL : SANDBOX_URL;
  }

  get isConfigured(): boolean {
    return !!this.username && !!this.apiKey;
  }

  async sendSms(recipient: string, message: string, senderId?: string): Promise<SendSmsResult> {
    if (!this.username || !this.apiKey) {
      return { success: false, providerMessageId: null, cost: null, error: 'Africa\'s Talking credentials not configured' };
    }

    const to = normalizePhoneNumber(recipient);
    if (!to) {
      return { success: false, providerMessageId: null, cost: null, error: `Could not normalize phone number: ${recipient}` };
    }

    const body = new URLSearchParams({ username: this.username, to, message });
    if (senderId) body.set('from', senderId);

    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          apiKey: this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });
    } catch (err) {
      return { success: false, providerMessageId: null, cost: null, error: err instanceof Error ? err.message : 'Network error' };
    }

    let data: AfricasTalkingResponse;
    try {
      data = (await res.json()) as AfricasTalkingResponse;
    } catch {
      return { success: false, providerMessageId: null, cost: null, error: `Non-JSON response (HTTP ${res.status})` };
    }

    const recipientResult = data.SMSMessageData?.Recipients?.[0];
    if (!recipientResult || recipientResult.status !== 'Success') {
      return {
        success: false,
        providerMessageId: recipientResult?.messageId ?? null,
        cost: recipientResult?.cost ?? null,
        error: recipientResult?.status ?? `Unexpected response (HTTP ${res.status})`,
      };
    }

    return {
      success: true,
      providerMessageId: recipientResult.messageId ?? null,
      cost: recipientResult.cost ?? null,
    };
  }
}
