import { Injectable, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { buildReceiptToken } from './receipt-token';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Initialize a Paystack payment session. Returns the hosted payment URL. */
  async initializePayment(
    accessToken: string,
    input: { feeBalanceId: string; amount: number; currency?: string },
  ) {
    const client = this.supabase.forUser(accessToken);

    const userRow = await this.supabase.currentUserRow(accessToken, 'id, email, school_id, full_name') as
      { id: string; email: string | null; school_id: string; full_name: string } | null;
    if (!userRow) throw new BadRequestException('User not found');

    // RLS-scoped: a cross-school feeBalanceId simply won't resolve, instead of
    // being trusted at face value.
    const { data: feeBalance } = await client
      .from('fee_balances')
      .select('id, student_id, amount_due, amount_paid')
      .eq('id', input.feeBalanceId)
      .maybeSingle();
    if (!feeBalance) throw new BadRequestException('Fee balance not found');

    const outstanding = Number(feeBalance.amount_due) - Number(feeBalance.amount_paid);
    const amountKobo = Math.round(Math.min(input.amount, outstanding) * 100); // Paystack uses smallest unit

    const reference = `sm_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const currency = input.currency ?? 'KES';

    // Store pending transaction
    const transactionId = randomUUID();
    await this.supabase.admin.from('payment_transactions').insert({
      id: transactionId,
      school_id: userRow.school_id,
      student_id: feeBalance.student_id,
      parent_user_id: userRow.id,
      fee_balance_id: input.feeBalanceId,
      reference,
      amount: input.amount,
      currency,
      status: 'PENDING',
    });

    // Fold-in fix (Task 6b): payment initialization was previously
    // unaudited — only the eventual success path logged anything.
    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: userRow.school_id,
      user_id: userRow.id,
      action: 'payment.initialized',
      entity_type: 'payment_transaction',
      entity_id: transactionId,
      metadata: { reference, amount: input.amount, feeBalanceId: input.feeBalanceId, provider: 'PAYSTACK' },
    });

    const secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      throw new BadRequestException(
        'Payment provider not configured. Set PAYSTACK_SECRET_KEY in environment.',
      );
    }

    const callbackUrl = `${this.config.get<string>('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000'}/parent/fees?payment=done`;

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: userRow.email ?? `${reference}@schoolmanager.app`,
        amount: amountKobo,
        currency,
        reference,
        callback_url: callbackUrl,
        metadata: {
          school_id: userRow.school_id,
          student_id: feeBalance.student_id,
          fee_balance_id: input.feeBalanceId,
          parent_name: userRow.full_name,
        },
      }),
    });

    const data = (await res.json()) as { status: boolean; data?: { authorization_url: string; reference: string } };
    if (!data.status || !data.data?.authorization_url) {
      throw new BadRequestException('Payment initialization failed');
    }

    return { authorizationUrl: data.data.authorization_url, reference };
  }

  /** Paystack webhook — verifies signature and reconciles the payment. */
  async handleWebhook(signature: string, rawBody: string): Promise<void> {
    const secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '';

    // Verify HMAC-SHA512 signature — constant-time comparison (fold-in fix,
    // Task 6c: the previous plain `!==` was a timing side-channel).
    // timingSafeEqual throws on unequal-length buffers rather than
    // returning false, so a length check comes first — a mismatched
    // signature length is itself a clear reject, not something to crash on.
    const crypto = await import('crypto');
    const expected = crypto
      .createHmac('sha512', secretKey)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature ?? '', 'hex');
    const validSignature = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
    if (!validSignature) {
      console.warn('[PaymentsService] Invalid webhook signature');
      return;
    }

    const event = JSON.parse(rawBody) as { event: string; data: Record<string, unknown> };
    if (event.event !== 'charge.success') return;

    const reference = event.data.reference as string;
    await this.reconcilePayment(reference, event.data);
  }

  /** Called after payment — verify with Paystack and update records. */
  async verifyAndReconcile(reference: string): Promise<void> {
    const secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '';
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const data = (await res.json()) as { status: boolean; data?: Record<string, unknown> };
    if (!data.status || !data.data) return;
    await this.reconcilePayment(reference, data.data);
  }

  private async reconcilePayment(reference: string, providerData: Record<string, unknown>): Promise<void> {
    const { data: txn } = await this.supabase.admin
      .from('payment_transactions')
      .select('id, school_id, student_id, parent_user_id, fee_balance_id, amount, status')
      .eq('reference', reference)
      .maybeSingle();

    if (!txn || txn.status === 'SUCCESS') return; // Already processed — idempotent

    const paystackStatus = (providerData.status as string)?.toLowerCase();
    const newStatus = paystackStatus === 'success' ? 'SUCCESS' : 'FAILED';

    await this.supabase.admin
      .from('payment_transactions')
      .update({
        status: newStatus,
        provider_payload: providerData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', txn.id);

    if (newStatus !== 'SUCCESS') {
      // Fold-in fix (Task 6b): failed reconciliation was previously unaudited.
      await this.supabase.admin.from('audit_logs').insert({
        id: randomUUID(),
        school_id: txn.school_id,
        user_id: txn.parent_user_id,
        action: 'payment.reconciliation_failed',
        entity_type: 'payment_transaction',
        entity_id: txn.id,
        metadata: { reference, paystackStatus: paystackStatus ?? null },
      });
      return;
    }

    if (txn.fee_balance_id) {
      await this.creditFeeBalance(txn.fee_balance_id, txn.amount);
    }

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: txn.school_id,
      user_id: txn.parent_user_id,
      action: 'fee.paid',
      entity_type: 'payment_transaction',
      entity_id: txn.id,
      metadata: { reference, amount: txn.amount, feeBalanceId: txn.fee_balance_id },
    });

    await this.queuePaymentReceiptNotifications({
      schoolId: txn.school_id,
      recipientId: txn.parent_user_id,
      paymentId: txn.id,
      paymentType: 'paystack',
      amount: txn.amount,
      studentId: txn.student_id,
    });

    // Trigger webhooks for fee.paid
    this.dispatchWebhookEvent(txn.school_id, 'fee.paid', {
      paymentId: txn.id,
      reference,
      amount: txn.amount,
      studentId: txn.student_id,
      feeBalanceId: txn.fee_balance_id,
    }).catch((e) => console.error('[PaymentsService] webhook dispatch error:', e));
  }

  /**
   * Shared crediting logic — the one place any payment path (Paystack here,
   * Paybill in PaybillReconciliationService) adds a paid amount to a fee
   * balance. Extracted so Paybill reconciliation reuses this exact shape
   * rather than re-implementing it (previously inlined only in
   * reconcilePayment).
   */
  async creditFeeBalance(feeBalanceId: string, amount: number): Promise<void> {
    const { data: balance } = await this.supabase.admin
      .from('fee_balances')
      .select('amount_paid')
      .eq('id', feeBalanceId)
      .single();

    await this.supabase.admin
      .from('fee_balances')
      .update({ amount_paid: Number(balance?.amount_paid ?? 0) + amount, updated_at: new Date().toISOString() })
      .eq('id', feeBalanceId);
  }

  /**
   * Queues the two payment-notification types (Task 4) for any successful
   * payment, Paystack or Paybill. PAYMENT_RECEIVED carries the receipt link
   * and is the only one of the two enabled for SMS (see
   * NotificationsService.SMS_ELIGIBLE_TYPES) — RECEIPT_AVAILABLE is
   * in-app/email only, since both fire at the same instant (receipts are
   * generated on-demand, not pre-generated, so there's no real gap between
   * "payment received" and "receipt available" to justify a second SMS).
   */
  async queuePaymentReceiptNotifications(input: {
    schoolId: string;
    recipientId: string;
    paymentId: string;
    paymentType: 'paystack' | 'paybill';
    amount: number;
    studentId: string | null;
  }): Promise<void> {
    const { data: student } = input.studentId
      ? await this.supabase.admin.from('students').select('user:users!user_id(full_name)').eq('id', input.studentId).maybeSingle()
      : { data: null };
    const studentName = (student?.user as unknown as { full_name: string } | null)?.full_name ?? 'your child';

    const secret = this.config.get<string>('NOTIFICATION_HMAC_SECRET') ?? 'default-secret';
    const token = buildReceiptToken(secret, input.paymentId, input.paymentType);
    const apiUrl = this.config.get<string>('NEXT_PUBLIC_API_URL') ?? 'http://localhost:4000';
    const receiptUrl = `${apiUrl}/payments/receipts/${input.paymentId}?type=${input.paymentType}&token=${token}`;
    const amountStr = `KES ${input.amount.toLocaleString()}`;

    await this.notifications.queue([{
      schoolId: input.schoolId,
      recipientId: input.recipientId,
      type: 'PAYMENT_RECEIVED',
      title: `Payment confirmed — ${amountStr}`,
      // Kept short deliberately — this is the one of the two that goes out
      // over SMS too, and Africa's Talking bills per 160-char segment.
      body: `${amountStr} received for ${studentName}. Receipt: ${receiptUrl}`,
      metadata: { paymentId: input.paymentId, paymentType: input.paymentType, receiptUrl },
    }, {
      schoolId: input.schoolId,
      recipientId: input.recipientId,
      type: 'RECEIPT_AVAILABLE',
      title: 'Your receipt is ready',
      body: `Your receipt for the ${amountStr} payment for ${studentName} is ready to download: ${receiptUrl}`,
      metadata: { paymentId: input.paymentId, paymentType: input.paymentType, receiptUrl },
    }]);
  }

  async listTransactions(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('payment_transactions')
      .select('id, reference, amount, currency, status, created_at, student:students!student_id(user:users!user_id(full_name))')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async adminReconciliation(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('payment_transactions')
      .select('id, reference, amount, currency, status, created_at, updated_at, student:students!student_id(user:users!user_id(full_name)), parent:users!parent_user_id(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const today = new Date().toDateString();
    const week = new Date(Date.now() - 7 * 86400000).toISOString();

    return {
      all: rows,
      paidToday: rows.filter((r) => r.status === 'SUCCESS' && new Date(r.created_at).toDateString() === today),
      paidThisWeek: rows.filter((r) => r.status === 'SUCCESS' && r.created_at >= week),
      failed: rows.filter((r) => r.status === 'FAILED'),
      pending: rows.filter((r) => r.status === 'PENDING'),
      totalCollected: rows.filter((r) => r.status === 'SUCCESS').reduce((s, r) => s + r.amount, 0),
    };
  }

  /**
   * Task 5.4 — a single time-ordered, source-labeled read across all three
   * payment record-keeping tables (payment_records, payment_transactions,
   * payment_paybill_transactions). Deliberately read-only and additive —
   * this does not unify or edit the underlying tables, it exists to make
   * the three-source fragmentation visible, per the plan. RLS-scoped via
   * forUser throughout, so this is already correctly tenant-isolated.
   */
  async unifiedPaymentView(accessToken: string, filters: { studentId?: string; from?: string; to?: string } = {}) {
    const client = this.supabase.forUser(accessToken);

    let manualQuery = client.from('payment_records')
      .select('id, amount, payment_method, reference_no, paid_date, notes, created_at, student:students!student_id(admission_no, user:users!user_id(full_name))')
      .order('created_at', { ascending: false }).limit(100);
    let onlineQuery = client.from('payment_transactions')
      .select('id, amount, currency, status, reference, created_at, student:students!student_id(admission_no, user:users!user_id(full_name))')
      .order('created_at', { ascending: false }).limit(100);
    let paybillQuery = client.from('payment_paybill_transactions')
      .select('id, amount, currency, reconciliation_status, mpesa_receipt_number, bill_reference_number, created_at, matched_student:students!matched_student_id(admission_no, user:users!user_id(full_name))')
      .order('created_at', { ascending: false }).limit(100);

    if (filters.studentId) {
      manualQuery = manualQuery.eq('student_id', filters.studentId);
      onlineQuery = onlineQuery.eq('student_id', filters.studentId);
      paybillQuery = paybillQuery.eq('matched_student_id', filters.studentId);
    }
    if (filters.from) {
      manualQuery = manualQuery.gte('created_at', filters.from);
      onlineQuery = onlineQuery.gte('created_at', filters.from);
      paybillQuery = paybillQuery.gte('created_at', filters.from);
    }
    if (filters.to) {
      manualQuery = manualQuery.lte('created_at', filters.to);
      onlineQuery = onlineQuery.lte('created_at', filters.to);
      paybillQuery = paybillQuery.lte('created_at', filters.to);
    }

    const [{ data: manual }, { data: online }, { data: paybill }] = await Promise.all([manualQuery, onlineQuery, paybillQuery]);

    type Row = { id: string; source: 'manual' | 'paystack' | 'paybill'; amount: number; currency: string; status: string; studentName: string | null; admissionNo: string | null; reference: string | null; createdAt: string };

    // supabase-js infers to-many array types for these embedded resources
    // even though PostgREST returns a single object for a to-one FK — the
    // same mismatch the rest of this codebase papers over with `as any`
    // (e.g. the admin payments page) rather than fighting with generated
    // Database types that don't exist in this project.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manualRows: Row[] = (manual ?? []).map((r: any) => ({
      id: r.id, source: 'manual', amount: Number(r.amount), currency: 'KES', status: r.payment_method,
      studentName: r.student?.user?.full_name ?? null, admissionNo: r.student?.admission_no ?? null,
      reference: r.reference_no, createdAt: r.created_at,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onlineRows: Row[] = (online ?? []).map((r: any) => ({
      id: r.id, source: 'paystack', amount: Number(r.amount), currency: r.currency, status: r.status,
      studentName: r.student?.user?.full_name ?? null, admissionNo: r.student?.admission_no ?? null,
      reference: r.reference, createdAt: r.created_at,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paybillRows: Row[] = (paybill ?? []).map((r: any) => ({
      id: r.id, source: 'paybill', amount: Number(r.amount), currency: r.currency, status: r.reconciliation_status,
      studentName: r.matched_student?.user?.full_name ?? null, admissionNo: r.matched_student?.admission_no ?? r.bill_reference_number,
      reference: r.mpesa_receipt_number, createdAt: r.created_at,
    }));

    return [...manualRows, ...onlineRows, ...paybillRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ── Webhooks ────────────────────────────────────────────────

  async dispatchWebhookEvent(schoolId: string, eventType: string, payload: object): Promise<void> {
    const { data: endpoints } = await this.supabase.admin
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .contains('events', [eventType]);

    for (const ep of endpoints ?? []) {
      const body = JSON.stringify({ event: eventType, data: payload, timestamp: new Date().toISOString() });
      const crypto = await import('crypto');
      const sig = crypto.createHmac('sha256', ep.secret).update(body).digest('hex');

      let statusCode: number | null = null;
      let errorMsg: string | null = null;

      try {
        const res = await fetch(ep.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sig },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        statusCode = res.status;
        if (!res.ok) errorMsg = `HTTP ${res.status}`;
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : 'Request failed';
      }

      await this.supabase.admin.from('webhook_deliveries').insert({
        id: randomUUID(),
        endpoint_id: ep.id,
        event_type: eventType,
        payload,
        status_code: statusCode,
        error: errorMsg,
        delivered_at: errorMsg ? null : new Date().toISOString(),
      });
    }
  }

  async listWebhookEndpoints(accessToken: string) {
    const { data } = await this.supabase.forUser(accessToken).from('webhook_endpoints').select('id, url, events, is_active, created_at').order('created_at');
    return data ?? [];
  }

  async createWebhookEndpoint(accessToken: string, input: { url: string; events: string[] }) {
    const client = this.supabase.forUser(accessToken);
    const userRow = await this.supabase.currentUserRow(accessToken, 'school_id') as { school_id: string } | null;
    const secret = randomUUID().replace(/-/g, '');
    const { data, error } = await client.from('webhook_endpoints').insert({
      id: randomUUID(),
      school_id: userRow?.school_id,
      url: input.url,
      secret,
      events: input.events,
    }).select('id, url, events, is_active, created_at').single();
    if (error) throw new BadRequestException(error.message);
    return { ...data, secret }; // Return secret once only
  }

  async deleteWebhookEndpoint(accessToken: string, id: string) {
    await this.supabase.forUser(accessToken).from('webhook_endpoints').delete().eq('id', id);
  }
}
