import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

export type NotifType = 'ABSENT_STUDENT' | 'NEW_ANNOUNCEMENT' | 'HOMEWORK_ASSIGNED';

interface BrevoClient {
  sendTransacEmail(params: {
    sender: { email: string; name: string };
    to: { email: string }[];
    subject: string;
    textContent: string;
  }): Promise<unknown>;
}

type PendingNotif = { id: string; recipient_id: string; type: string; title: string; body: string };
type UserRow = { id: string; email: string | null };
type PrefRow = { user_id: string; notification_type: string; email_enabled: boolean };

export interface NotifPayload {
  schoolId: string;
  recipientId: string;
  type: NotifType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  /** When true, pre-fills email_sent_at so the dispatcher skips delivery (in-app only). */
  skipExternalChannels?: boolean;
}

@Injectable()
export class NotificationsService {
  private brevo: BrevoClient | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
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
      sms_sent_at: now, // SMS not implemented; pre-fill so dispatcher skips this column
    }));

    const { error } = await this.supabase.admin.from('notifications').insert(rows);
    if (error) {
      // Log but don't throw — notification failures shouldn't break the main operation
      console.error('[NotificationsService] queue insert failed:', error.message);
    }
  }

  async list(accessToken: string) {
    const { data, error } = await this.supabase
      .forUser(accessToken)
      .from('notifications')
      .select('id, type, title, body, metadata, is_read, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async unreadCount(accessToken: string): Promise<number> {
    const { count, error } = await this.supabase
      .forUser(accessToken)
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async markRead(accessToken: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase
      .forUser(accessToken)
      .from('notifications')
      .update({ is_read: true })
      .in('id', ids);
    if (error) throw new Error(error.message);
  }

  /**
   * Dispatcher — called by the scheduler every minute.
   * Sends pending email notifications via Brevo.
   * Uses admin client to bypass RLS. Per-row errors are logged, not thrown.
   */
  async dispatch(): Promise<void> {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await this.supabase.admin
      .from('notifications')
      .select('id, recipient_id, type, title, body, email_sent_at')
      .is('email_sent_at', null)
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
      this.supabase.admin.from('users').select('id, email').in('id', recipientIds),
      this.supabase.admin
        .from('notification_preferences')
        .select('user_id, notification_type, email_enabled')
        .in('user_id', recipientIds),
    ]);

    const userMap = Object.fromEntries(((users ?? []) as UserRow[]).map((u) => [u.id, u]));

    // prefMap[user_id][notification_type] = { email }
    const prefMap: Record<string, Record<string, { email: boolean }>> = {};
    for (const p of (prefs as PrefRow[]) ?? []) {
      (prefMap[p.user_id] ??= {})[p.notification_type] = { email: p.email_enabled };
    }

    const senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL') ?? 'noreply@schoolmanager.app';
    const senderName = this.config.get<string>('BREVO_SENDER_NAME') ?? 'School Manager';

    for (const row of pendingRows) {
      const user = userMap[row.recipient_id];
      if (!user) continue;

      const emailEnabled = prefMap[row.recipient_id]?.[row.type]?.email ?? true;

      let emailSentAt: string | null = null;
      if (emailEnabled && user.email) {
        const sent = await this.sendEmail(senderEmail, senderName, user.email, row.title, row.body);
        if (sent) emailSentAt = new Date().toISOString();
      } else {
        // No email address or user opted out — mark done so it's not re-attempted
        emailSentAt = new Date().toISOString();
      }

      if (emailSentAt) {
        await this.supabase.admin
          .from('notifications')
          .update({ email_sent_at: emailSentAt })
          .eq('id', row.id);
      }
    }
  }

  private async sendEmail(
    senderEmail: string,
    senderName: string,
    to: string,
    subject: string,
    textContent: string,
  ): Promise<boolean> {
    if (!this.brevo) return false;
    try {
      await this.brevo.sendTransacEmail({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to }],
        subject,
        textContent,
      });
      return true;
    } catch (err) {
      console.error('[NotificationsService] email send failed:', err);
      return false;
    }
  }
}
