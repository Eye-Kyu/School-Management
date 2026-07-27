import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { isIpAllowed } from './ip-allowlist';
import { PaybillReconciliationService } from './paybill-reconciliation.service';

// Safaricom's real, documented C2B validation-rejection codes — not invented.
const REJECT_INVALID_MSISDN = 'C2B00011';
const REJECT_INVALID_ACCOUNT = 'C2B00012';
const REJECT_INVALID_AMOUNT = 'C2B00013';
const REJECT_INVALID_SHORTCODE = 'C2B00015';

// A sanity ceiling for a school-fee Paybill payment — not a business rule,
// just enough to reject an obviously-wrong amount at validation time.
const MAX_REASONABLE_AMOUNT_KES = 500_000;

export type DarajaC2BPayload = {
  TransactionType?: string;
  TransID?: string;
  TransTime?: string;
  TransAmount?: string | number;
  BusinessShortCode?: string;
  BillRefNumber?: string;
  InvoiceNumber?: string;
  OrgAccountBalance?: string;
  ThirdPartyTransID?: string;
  MSISDN?: string;
  FirstName?: string;
  MiddleName?: string;
  LastName?: string;
};

type DarajaResult = { ResultCode: number | string; ResultDesc: string };

function parseDarajaTimestamp(transTime: string | undefined): string {
  // Daraja's TransTime is YYYYMMDDHHmmss, no separators.
  if (!transTime || !/^\d{14}$/.test(transTime)) return new Date().toISOString();
  const y = transTime.slice(0, 4);
  const mo = transTime.slice(4, 6);
  const d = transTime.slice(6, 8);
  const h = transTime.slice(8, 10);
  const mi = transTime.slice(10, 12);
  const s = transTime.slice(12, 14);
  const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

@Injectable()
export class MpesaDarajaService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly reconciliation: PaybillReconciliationService,
  ) {}

  /**
   * Sandbox mode is deliberately permissive (no real Safaricom IP range to
   * check against in dev/test) — production mode enforces the real
   * allowlist. Matches the AFRICASTALKING_MODE precedent from sub-sprint 1a.
   */
  isRequestFromSafaricom(ip: string): boolean {
    const mode = this.config.get<string>('MPESA_DARAJA_MODE') ?? 'sandbox';
    if (mode !== 'production') return true;
    return isIpAllowed(ip, this.config.get<string>('MPESA_ALLOWED_IPS'));
  }

  /**
   * Safaricom calls this first, before attempting the transaction.
   * Rejecting here doesn't retry the payment itself — it just tells
   * Safaricom not to proceed. Always resolves (never throws) so the
   * controller can always return HTTP 200 — Safaricom retries on a
   * non-200 response, which is never what we want here, even for a reject.
   */
  async validate(payload: DarajaC2BPayload): Promise<DarajaResult> {
    this.logCallback('validate', payload);

    const shortcode = payload.BusinessShortCode;
    if (!shortcode) return { ResultCode: REJECT_INVALID_SHORTCODE, ResultDesc: 'Rejected' };

    const { data: school } = await this.supabase.admin
      .from('schools').select('id').eq('paybill_shortcode', shortcode).maybeSingle();
    if (!school) return { ResultCode: REJECT_INVALID_SHORTCODE, ResultDesc: 'Rejected' };

    const amount = Number(payload.TransAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_REASONABLE_AMOUNT_KES) {
      return { ResultCode: REJECT_INVALID_AMOUNT, ResultDesc: 'Rejected' };
    }

    if (!payload.MSISDN || !/^\d{9,15}$/.test(payload.MSISDN)) {
      return { ResultCode: REJECT_INVALID_MSISDN, ResultDesc: 'Rejected' };
    }

    // "Plausible," not "resolves to a real student" — accepting here
    // doesn't commit to a match. Reconciliation (after confirm) is what
    // actually looks a student up; an unmatched-but-plausible reference
    // still gets accepted and lands in the admin's unmatched queue.
    const ref = payload.BillRefNumber?.trim() ?? '';
    if (ref.length === 0 || ref.length > 50) {
      return { ResultCode: REJECT_INVALID_ACCOUNT, ResultDesc: 'Rejected' };
    }

    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }

  /**
   * The money moment. Persist first, respond immediately, reconcile async
   * (per the task's own instruction) — the parent-facing "did it work"
   * signal is Safaricom's own payment confirmation, not our reconciliation
   * outcome, so there's no need to block the response on matching.
   */
  async confirm(payload: DarajaC2BPayload): Promise<DarajaResult> {
    this.logCallback('confirm', payload);

    const receiptNumber = payload.TransID;
    if (!receiptNumber) {
      return { ResultCode: 1, ResultDesc: 'Missing TransID' }; // non-zero -> Safaricom retries
    }

    // Idempotency: a retried confirmation for an already-persisted receipt
    // number is told "success" (Safaricom already believes it worked)
    // without touching anything again.
    const { data: existing } = await this.supabase.admin
      .from('payment_paybill_transactions').select('id').eq('mpesa_receipt_number', receiptNumber).maybeSingle();
    if (existing) return { ResultCode: 0, ResultDesc: 'Success' };

    const shortcode = payload.BusinessShortCode ?? '';
    const { data: school } = await this.supabase.admin
      .from('schools').select('id').eq('paybill_shortcode', shortcode).maybeSingle();
    if (!school) {
      console.warn(`[MpesaDarajaService] confirm callback for unregistered shortcode: ${shortcode}`);
    }

    const id = randomUUID();
    const { error } = await this.supabase.admin.from('payment_paybill_transactions').insert({
      id,
      school_id: school?.id ?? null,
      mpesa_receipt_number: receiptNumber,
      transaction_type: payload.TransactionType ?? 'Pay Bill',
      transaction_time: parseDarajaTimestamp(payload.TransTime),
      amount: Number(payload.TransAmount) || 0,
      msisdn: payload.MSISDN ?? '',
      bill_reference_number: payload.BillRefNumber ?? '',
      business_shortcode: shortcode,
      raw_callback: payload,
    });

    if (error) {
      if (error.code === '23505') {
        // Unique-violation race — another concurrent callback persisted
        // this receipt number first. Same as the "already exists" branch.
        return { ResultCode: 0, ResultDesc: 'Success' };
      }
      console.error('[MpesaDarajaService] persistence failed:', error.message);
      return { ResultCode: 1, ResultDesc: 'Failed to persist' }; // non-zero -> Safaricom retries
    }

    this.reconciliation.reconcile(id).catch((e) => console.error('[MpesaDarajaService] reconciliation error:', e));

    return { ResultCode: 0, ResultDesc: 'Success' };
  }

  private logCallback(kind: 'validate' | 'confirm', payload: DarajaC2BPayload): void {
    // Redacted summary only — operationally useful (support can trace a
    // specific transaction) without logging the payer's name or the full
    // raw payload.
    console.log(`[MpesaDarajaService] ${kind} callback`, {
      shortcode: payload.BusinessShortCode,
      amount: payload.TransAmount,
      billRef: payload.BillRefNumber,
      receiptNumber: payload.TransID,
    });
  }
}
