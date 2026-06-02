import { Injectable, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';

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

    const { data: userRow } = await client
      .from('users')
      .select('id, email, school_id, full_name')
      .maybeSingle();
    if (!userRow) throw new BadRequestException('User not found');

    const { data: feeBalance } = await this.supabase.admin
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
    await this.supabase.admin.from('payment_transactions').insert({
      id: randomUUID(),
      school_id: userRow.school_id,
      student_id: feeBalance.student_id,
      parent_user_id: userRow.id,
      fee_balance_id: input.feeBalanceId,
      reference,
      amount: input.amount,
      currency,
      status: 'PENDING',
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

    // Verify HMAC-SHA512 signature
    const crypto = await import('crypto');
    const expected = crypto
      .createHmac('sha512', secretKey)
      .update(rawBody)
      .digest('hex');

    if (expected !== signature) {
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

    if (newStatus !== 'SUCCESS') return;

    // Update fee balance — add the paid amount
    if (txn.fee_balance_id) {
      const { data: balance } = await this.supabase.admin
        .from('fee_balances')
        .select('amount_paid')
        .eq('id', txn.fee_balance_id)
        .single();

      await this.supabase.admin
        .from('fee_balances')
        .update({ amount_paid: Number(balance?.amount_paid ?? 0) + txn.amount })
        .eq('id', txn.fee_balance_id);
    }

    // Audit log
    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: txn.school_id,
      user_id: txn.parent_user_id,
      action: 'fee.paid',
      entity_type: 'payment_transaction',
      entity_id: txn.id,
      metadata: { reference, amount: txn.amount, feeBalanceId: txn.fee_balance_id },
    });

    // Send receipt notification
    const { data: parentUser } = await this.supabase.admin
      .from('users')
      .select('id, full_name')
      .eq('id', txn.parent_user_id)
      .single();

    const receiptUrl = `${this.config.get<string>('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000'}/print/receipt/${txn.id}`;

    await this.notifications.queue([{
      schoolId: txn.school_id,
      recipientId: txn.parent_user_id,
      type: 'NEW_ANNOUNCEMENT' as const, // reuse closest type
      title: `Payment confirmed — KES ${txn.amount.toLocaleString()}`,
      body: `Your payment of KES ${txn.amount.toLocaleString()} has been received. View your receipt: ${receiptUrl}`,
      metadata: { paymentId: txn.id, reference, receiptUrl },
    }]);

    // Trigger webhooks for fee.paid
    this.dispatchWebhookEvent(txn.school_id, 'fee.paid', {
      paymentId: txn.id,
      reference,
      amount: txn.amount,
      studentId: txn.student_id,
      feeBalanceId: txn.fee_balance_id,
    }).catch((e) => console.error('[PaymentsService] webhook dispatch error:', e));
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
    const { data: userRow } = await client.from('users').select('school_id').maybeSingle();
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
