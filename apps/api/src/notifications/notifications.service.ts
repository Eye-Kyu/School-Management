import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID, createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { AfricasTalkingClient } from './africastalking.client';
import { invalidateUserFeedCache } from '../notifications-aggregation/feed-cache';

// Notification types SMS applies to. Deliberately narrow (not "every type
// with sms_enabled=true") — a preference row alone isn't trusted to gate a
// real per-message cost; this is the actual scope boundary. PAYMENT_RECEIVED
// is the only payment-notification type enabled for SMS (sub-sprint 2) —
// RECEIPT_AVAILABLE fires at the same instant and would just duplicate the
// cost for one event, since receipts are generated on-demand, not staged.
const SMS_ELIGIBLE_TYPES = new Set<string>(['ABSENT_STUDENT', 'PAYMENT_RECEIVED']);
const SMS_MAX_ATTEMPTS = 3;

export type NotifType =
  | 'ABSENT_STUDENT'
  | 'NEW_ANNOUNCEMENT'
  | 'HOMEWORK_ASSIGNED'
  | 'HOMEWORK_GRADED'
  | 'NEW_MESSAGE'
  | 'PREFECT_MESSAGE'
  | 'BEHAVIOR_INCIDENT_SUBMITTED'
  | 'BEHAVIOR_INCIDENT_REVIEWED'
  | 'ATTENDANCE_REMARK_REQUESTED'
  | 'ATTENDANCE_REMARK_DECIDED'
  | 'ABSENCE_REQUEST_SUBMITTED'
  | 'PAYMENT_RECEIVED'
  | 'RECEIPT_AVAILABLE'
  | 'ABSENCE_REQUEST_DECIDED';

interface BrevoClient {
  sendTransacEmail(params: {
    sender: { email: string; name: string };
    to: { email: string }[];
    subject: string;
    textContent: string;
  }): Promise<unknown>;
}

type PendingNotif = {
  id: string; school_id: string; recipient_id: string; type: string; title: string; body: string;
  email_sent_at: string | null; sms_status: string; sms_send_attempts: number;
  metadata: { paymentId?: string; paymentType?: 'paystack' | 'paybill' } | null;
};
const RECEIPT_NOTIF_TYPES = new Set<string>(['PAYMENT_RECEIVED', 'RECEIPT_AVAILABLE']);
type UserRow = { id: string; email: string | null; phone: string | null };
type PrefRow = { user_id: string; notification_type: string; email_enabled: boolean; sms_enabled: boolean };

export interface NotifPayload {
  schoolId: string;
  recipientId: string;
  type: NotifType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  /** When true, pre-fills email_sent_at so the dispatcher skips delivery (in-app only). */
  skipExternalChannels?: boolean;
  /** ISO timestamp — notification is hidden until this time (quiet hours). */
  deliverAfter?: string;
}

@Injectable()
export class NotificationsService {
  private brevo: BrevoClient | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly africasTalking: AfricasTalkingClient,
  ) {
    this.initBrevo();
  }

  private initBrevo() {
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    if (!apiKey) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Brevo = require('@getbrevo/brevo');
      const client = new Brevo.TransactionalEmailsApi();
      client.authentications['api-key'].apiKey = apiKey;
      this.brevo = client;
    } catch {
      // Brevo SDK unavailable — email sending disabled
    }
  }

  /** Insert notification rows for one or more recipients. Uses admin client to bypass RLS. */
  async queue(payloads: NotifPayload[]): Promise<void> {
    if (payloads.length === 0) return;
    const now = new Date().toISOString();
    const rows = payloads.map((p) => ({
      id: randomUUID(),
      school_id: p.schoolId,
      recipient_id: p.recipientId,
      type: p.type,
      title: p.title,
      body: p.body,
      metadata: p.metadata ?? null,
      email_sent_at: p.skipExternalChannels ? now : null,
      sms_status: p.skipExternalChannels ? 'ABANDONED' : 'PENDING',
      deliver_after: p.deliverAfter ?? null,
    }));

    const { error } = await this.supabase.admin.from('notifications').insert(rows);
    if (!error) {
      // A new notification is new feed-visible content for its recipient —
      // invalidate immediately rather than letting them wait out the 60s
      // TTL. This is a same-recipient invalidation on a well-defined write
      // path (unlike a derived reminder with no discrete "write" event), so
      // it doesn't weaken the deliberately-accepted cross-user staleness
      // tradeoff for the feed in general.
      for (const recipientId of new Set(payloads.map((p) => p.recipientId))) {
        invalidateUserFeedCache(recipientId);
      }
    } else {
      // Log but don't throw — notification failures shouldn't break the main operation
      console.error('[NotificationsService] queue insert failed:', error.message);
    }
  }

  async list(accessToken: string) {
    const { data, error } = await this.supabase
      .forUser(accessToken)
      .from('notifications')
      .select('id, type, title, body, metadata, is_read, created_at')
      .or(`deliver_after.is.null,deliver_after.lte.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async markRead(accessToken: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase
      .forUser(accessToken)
      .from('notifications')
      .update({ is_read: true })
      .in('id', ids);
    if (error) throw new Error(error.message);
    const me = (await this.supabase.currentUserRow(accessToken, 'id')) as { id: string } | null;
    if (me) invalidateUserFeedCache(me.id);
  }

  async acknowledge(accessToken: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .forUser(accessToken)
      .from('notifications')
      .update({ acknowledged_at: new Date().toISOString(), is_read: true })
      .eq('id', id);
    if (error) throw new Error(error.message);
    const me = (await this.supabase.currentUserRow(accessToken, 'id')) as { id: string } | null;
    if (me) invalidateUserFeedCache(me.id);
  }

  /**
   * Dispatcher — called by the scheduler every minute.
   * Sends pending email (Brevo) and, for SMS-eligible types, pending SMS
   * (Africa's Talking) notifications. Uses admin client to bypass RLS.
   * Per-row errors are logged, not thrown.
   *
   * Concurrency safety (BUG-4, docs/bug-triage.md): NotificationsScheduler's
   * @Cron(EVERY_MINUTE) has no overlap guard of its own (see
   * notifications.scheduler.ts), so a tick that takes >60s can run
   * concurrently with the next one on the same process — a real risk
   * independent of horizontal scaling. The SMS branch below atomically
   * claims a row (sms_status PENDING -> SENDING via a single conditional
   * UPDATE...RETURNING) before ever calling the paid, external, non-
   * idempotent sendSms() — a second concurrent dispatch() sees 0 rows
   * claimed and skips. The email branch has the identical theoretical race
   * (email_sent_at IS NULL -> send -> write) but is a deliberately accepted,
   * lower-severity gap: no per-message cost, and no retry-attempt-count
   * field to build the same claim pattern onto without a new column. Do not
   * remove the claim step or "simplify" this back to select-then-send.
   */
  async dispatch(): Promise<void> {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // A row needs work if email hasn't been resolved yet, OR it's an
    // SMS-eligible type still PENDING for SMS — these are independent
    // lifecycles on the same row, so a row already done with email but
    // still retrying SMS (or vice versa) must still be fetched.
    const smsTypesList = Array.from(SMS_ELIGIBLE_TYPES).join(',');
    const { data: rows, error } = await this.supabase.admin
      .from('notifications')
      .select('id, school_id, recipient_id, type, title, body, email_sent_at, sms_status, sms_send_attempts, metadata')
      .or(`email_sent_at.is.null,and(sms_status.eq.PENDING,type.in.(${smsTypesList}))`)
      .or(`deliver_after.is.null,deliver_after.lte.${now}`)
      .gte('created_at', cutoff)
      .limit(100);

    if (error) {
      console.error('[NotificationsService] dispatch fetch failed:', error.message);
      return;
    }
    if (!rows?.length) return;

    const pendingRows = rows as PendingNotif[];
    const recipientIds = [...new Set(pendingRows.map((r) => r.recipient_id))];

    const [{ data: users }, { data: prefs }] = await Promise.all([
      this.supabase.admin.from('users').select('id, email, phone').in('id', recipientIds),
      this.supabase.admin
        .from('notification_preferences')
        .select('user_id, notification_type, email_enabled, sms_enabled')
        .in('user_id', recipientIds),
    ]);

    const userMap = Object.fromEntries(((users ?? []) as UserRow[]).map((u) => [u.id, u]));

    // prefMap[user_id][notification_type] = { email, sms }
    const prefMap: Record<string, Record<string, { email: boolean; sms: boolean }>> = {};
    for (const p of (prefs as PrefRow[]) ?? []) {
      (prefMap[p.user_id] ??= {})[p.notification_type] = { email: p.email_enabled, sms: p.sms_enabled };
    }

    const senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL') ?? 'noreply@schoolmanager.app';
    const senderName = this.config.get<string>('BREVO_SENDER_NAME') ?? 'School Manager';

    for (const row of pendingRows) {
      const user = userMap[row.recipient_id];
      if (!user) continue;

      const notifPatch: Record<string, unknown> = {};
      let genuinelyDelivered = false; // true delivery only — not the "no email on file, mark done" case

      // ── Email (unchanged logic, but no longer short-circuits past SMS) ──
      if (row.email_sent_at === null) {
        const emailEnabled = prefMap[row.recipient_id]?.[row.type]?.email ?? true;
        if (emailEnabled && user.email) {
          const unsubToken = this.buildUnsubscribeToken(row.recipient_id, row.type);
          const sent = await this.sendEmail(senderEmail, senderName, user.email, row.title, row.body, unsubToken);
          if (sent) {
            notifPatch.email_sent_at = new Date().toISOString();
            genuinelyDelivered = true;
          } else {
            notifPatch.error_message = 'Email delivery failed — will retry';
          }
        } else {
          // No email address or user opted out — mark done so it's not re-attempted
          notifPatch.email_sent_at = new Date().toISOString();
        }
      }

      // ── SMS — only the types this sub-sprint enables, only while PENDING ──
      if (SMS_ELIGIBLE_TYPES.has(row.type) && row.sms_status === 'PENDING') {
        const smsEnabled = prefMap[row.recipient_id]?.[row.type]?.sms ?? false;
        if (!smsEnabled) {
          notifPatch.sms_status = 'ABANDONED'; // opted out — not a failure, nothing to audit-log
        } else if (!user.phone) {
          notifPatch.sms_status = 'ABANDONED';
          await this.logSmsAbandoned(row, 'No phone number on file');
        } else {
          // Atomically claim this row before ever calling the paid,
          // external, non-idempotent sendSms() — see the dispatch() header
          // comment. A second concurrent dispatch() run attempting the same
          // claim affects 0 rows and is treated exactly like "already
          // handled" — no send, no notifPatch.sms_status write at all.
          const { data: claimed } = await this.supabase.admin
            .from('notifications')
            .update({ sms_status: 'SENDING' })
            .eq('id', row.id)
            .eq('sms_status', 'PENDING')
            .select('id');

          if (claimed && claimed.length > 0) {
            const result = await this.africasTalking.sendSms(user.phone, row.body);
            if (result.success) {
              notifPatch.sms_status = 'SENT';
              notifPatch.sms_sent_at = new Date().toISOString();
              genuinelyDelivered = true;
              await this.logMessageSend(row, user.phone, result);
            } else {
              const attempts = (row.sms_send_attempts ?? 0) + 1;
              notifPatch.sms_send_attempts = attempts;
              if (attempts >= SMS_MAX_ATTEMPTS) {
                notifPatch.sms_status = 'ABANDONED';
                await this.logSmsAbandoned(row, result.error ?? 'Unknown error');
              } else {
                // Release the claim for the next tick's retry — must be
                // explicit now (previously implicit, since a retry-able
                // failure never touched the row at all).
                notifPatch.sms_status = 'PENDING';
              }
            }
          }
        }
      }

      if (Object.keys(notifPatch).length > 0) {
        await this.supabase.admin.from('notifications').update(notifPatch).eq('id', row.id);
      }

      // Fold-in fix (Task 6a): wire up the previously-dead receipt_sent_at
      // column, on whichever payment table the notification's own metadata
      // points at. Whichever of PAYMENT_RECEIVED/RECEIPT_AVAILABLE actually
      // delivers first wins — the second one's write is a no-op (WHERE
      // receipt_sent_at IS NULL), so this is safe to call from both.
      if (genuinelyDelivered && RECEIPT_NOTIF_TYPES.has(row.type) && row.metadata?.paymentId && row.metadata?.paymentType) {
        await this.markReceiptSent(row.metadata.paymentType, row.metadata.paymentId);
      }
    }
  }

  private async markReceiptSent(paymentType: 'paystack' | 'paybill', paymentId: string): Promise<void> {
    const table = paymentType === 'paybill' ? 'payment_paybill_transactions' : 'payment_transactions';
    await this.supabase.admin
      .from(table)
      .update({ receipt_sent_at: new Date().toISOString() })
      .eq('id', paymentId)
      .is('receipt_sent_at', null);
  }

  private async logMessageSend(row: PendingNotif, phone: string, result: { providerMessageId: string | null; cost: string | null }) {
    const { amount, currency } = this.parseSmsCost(result.cost);
    const { error } = await this.supabase.admin.from('message_send_log').insert({
      id: randomUUID(),
      school_id: row.school_id,
      notification_id: row.id,
      channel: 'SMS',
      provider: 'AFRICASTALKING',
      provider_message_id: result.providerMessageId,
      recipient_phone: phone,
      cost_amount: amount,
      cost_currency: currency,
      cost_raw: result.cost,
    });
    if (error) {
      console.error('[NotificationsService] message_send_log insert failed:', error.message);
    }
  }

  private async logSmsAbandoned(row: PendingNotif, reason: string) {
    const { error } = await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: row.school_id,
      user_id: row.recipient_id,
      action: 'notification.sms_abandoned',
      entity_type: 'notification',
      entity_id: row.id,
      metadata: { notifType: row.type, reason },
    });
    if (error) {
      console.error('[NotificationsService] audit_logs sms_abandoned insert failed:', error.message);
    }
  }

  /** Parses Africa's Talking's raw cost string (e.g. "KES 0.8000") without guessing on an unexpected shape. */
  private parseSmsCost(raw: string | null): { amount: number | null; currency: string | null } {
    if (!raw) return { amount: null, currency: null };
    const match = raw.trim().match(/^([A-Z]{3})\s+([\d.]+)$/);
    if (!match) return { amount: null, currency: null };
    const amount = Number(match[2]);
    return { amount: Number.isFinite(amount) ? amount : null, currency: match[1] ?? null };
  }

  async sendTest(accessToken: string, title?: string, message?: string): Promise<void> {
    const userRow = await this.supabase.currentUserRow(accessToken, 'id, school_id') as { id: string; school_id: string } | null;
    if (!userRow) return;

    await this.queue([{
      schoolId: userRow.school_id,
      recipientId: userRow.id,
      type: 'NEW_ANNOUNCEMENT',
      title: title ?? 'Test notification',
      body: message ?? 'This is a test notification from your admin panel.',
    }]);
  }

  async sendReportCardEmail(
    authUserId: string,
    studentId: string,
    termId: string,
    reportCardUrl: string,
  ): Promise<{ sent: number }> {
    // Resolve caller identity (id-filtered by JWT auth_id — safe on the
    // service-role client) and enforce that only staff can trigger this.
    const { data: caller } = await this.supabase.admin
      .from('users')
      .select('id, role, school_id')
      .eq('auth_id', authUserId)
      .maybeSingle();
    if (!caller || !['ADMIN', 'TEACHER'].includes(caller.role)) {
      throw new ForbiddenException('Only admins and teachers can send report card emails');
    }

    // Verify the student belongs to the caller's own school before doing
    // anything else — this was previously trusted from the request body
    // with no check at all.
    const { data: studentRow } = await this.supabase.admin
      .from('students')
      .select('user:users!user_id(full_name), school_id')
      .eq('id', studentId)
      .maybeSingle();
    if (!studentRow || studentRow.school_id !== caller.school_id) {
      throw new NotFoundException('Student not found');
    }

    // Get student's guardians — safe now that ownership is verified above
    const { data: guardians } = await this.supabase.admin
      .from('guardians')
      .select('user:users!user_id(id, full_name, email)')
      .eq('student_id', studentId);

    const studentName = (studentRow.user as unknown as { full_name: string }[])?.[0]?.full_name ?? 'your child';
    const schoolId = caller.school_id;

    const senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL') ?? 'noreply@schoolmanager.app';
    const senderName = this.config.get<string>('BREVO_SENDER_NAME') ?? 'School Manager';

    let sent = 0;
    for (const g of guardians ?? []) {
      const guardian = (g.user as unknown as { id: string; full_name: string; email: string | null }[])?.[0] ?? null;
      if (!guardian?.email) continue;

      await this.sendEmail(
        senderEmail,
        senderName,
        guardian.email,
        `${studentName}'s report card is ready`,
        `Dear ${guardian.full_name ?? 'Parent/Guardian'},\n\n${studentName}'s end-of-term report card is now available.\n\nView and print it here:\n${reportCardUrl}\n\nThank you.`,
      );

      await this.queue([{
        schoolId,
        recipientId: guardian.id,
        type: 'NEW_ANNOUNCEMENT',
        title: `${studentName}'s report card is ready`,
        body: `View and print it at: ${reportCardUrl}`,
        metadata: { studentId, termId, reportCardUrl },
        skipExternalChannels: true, // already sent email above
      }]);

      sent++;
    }
    return { sent };
  }

  async handleUnsubscribe(token: string): Promise<{ message: string }> {
    const secret = this.config.get<string>('NOTIFICATION_HMAC_SECRET') ?? 'default-secret';
    let uid: string, type: string;
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const payload = JSON.parse(decoded) as { uid: string; type: string; sig: string };
      const expected = createHmac('sha256', secret)
        .update(`${payload.uid}:${payload.type}`)
        .digest('hex');
      if (payload.sig !== expected) return { message: 'Invalid unsubscribe link.' };
      uid = payload.uid;
      type = payload.type;
    } catch {
      return { message: 'Invalid unsubscribe link.' };
    }

    await this.supabase.admin
      .from('notification_preferences')
      .upsert(
        { id: randomUUID(), user_id: uid, notification_type: type, email_enabled: false, school_id: '' },
        { onConflict: 'user_id,notification_type' },
      );
    return { message: `You have been unsubscribed from ${type.toLowerCase().replace(/_/g, ' ')} email notifications.` };
  }

  private buildUnsubscribeToken(userId: string, notifType: string): string {
    const secret = this.config.get<string>('NOTIFICATION_HMAC_SECRET') ?? 'default-secret';
    const sig = createHmac('sha256', secret).update(`${userId}:${notifType}`).digest('hex');
    return Buffer.from(JSON.stringify({ uid: userId, type: notifType, sig })).toString('base64url');
  }

  private async sendEmail(
    senderEmail: string,
    senderName: string,
    to: string,
    subject: string,
    textContent: string,
    unsubscribeToken?: string,
  ): Promise<boolean> {
    if (!this.brevo) return false;
    const appUrl = this.config.get<string>('NEXT_PUBLIC_APP_URL') ?? 'https://schoolmanager.app';
    const unsubscribeLink = unsubscribeToken
      ? `\n\n---\nTo stop receiving these emails: ${appUrl}/api/notifications/unsubscribe?token=${unsubscribeToken}`
      : '';
    try {
      await this.brevo.sendTransacEmail({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to }],
        subject,
        textContent: textContent + unsubscribeLink,
      });
      return true;
    } catch (err) {
      console.error('[NotificationsService] email send failed:', err);
      return false;
    }
  }
}
