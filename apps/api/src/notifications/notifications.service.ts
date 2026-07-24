import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID, createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

export type NotifType = 'ABSENT_STUDENT' | 'NEW_ANNOUNCEMENT' | 'HOMEWORK_ASSIGNED' | 'NEW_MESSAGE';

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
  /** ISO timestamp — notification is hidden until this time (quiet hours). */
  deliverAfter?: string;
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
      deliver_after: p.deliverAfter ?? null,
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
      .or(`deliver_after.is.null,deliver_after.lte.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // Bubble count = unread across all three /notifications sections combined
  // (Alerts, Conversations, Reminders) — not just the notifications table.
  async unreadCount(accessToken: string): Promise<number> {
    const client = this.supabase.forUser(accessToken);
    const me = (await this.supabase.currentUserRow(accessToken, 'id, role')) as { id: string; role: string } | null;
    if (!me) return 0;

    const [alerts, conversations, platformMessages, reminders] = await Promise.all([
      this.alertsUnreadCount(client),
      this.conversationsUnreadCount(client, me.role),
      me.role === 'ADMIN' ? this.platformMessagesUnreadCount(client) : Promise.resolve(0),
      this.remindersCount(client, me.id, me.role),
    ]);
    return alerts + conversations + platformMessages + reminders;
  }

  private async alertsUnreadCount(client: ReturnType<SupabaseService['forUser']>): Promise<number> {
    const { count, error } = await client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  private async conversationsUnreadCount(client: ReturnType<SupabaseService['forUser']>, role: string): Promise<number> {
    const column = role === 'PARENT' ? 'parent_unread_count' : role === 'TEACHER' ? 'teacher_unread_count' : role === 'ADMIN' ? 'admin_unread_count' : null;
    if (!column) return 0;
    const { data, error } = await client.from('conversations').select(column).gt(column, 0);
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  }

  private async platformMessagesUnreadCount(client: ReturnType<SupabaseService['forUser']>): Promise<number> {
    const { count, error } = await client
      .from('platform_message_recipients')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .is('dismissed_at', null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  private async remindersCount(client: ReturnType<SupabaseService['forUser']>, userId: string, role: string): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const in7Days = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    if (role === 'STUDENT') {
      const { data: student } = await client.from('students').select('id, current_class_id').eq('user_id', userId).maybeSingle();
      if (!student) return 0;
      const { data: assignments } = await client
        .from('assignments').select('id')
        .eq('class_id', student.current_class_id).gte('due_date', today).lte('due_date', in7Days);
      if (!assignments || assignments.length === 0) return 0;
      const { data: submissions } = await client
        .from('submissions').select('assignment_id')
        .eq('student_id', student.id).in('assignment_id', assignments.map((a) => a.id));
      const submittedIds = new Set((submissions ?? []).map((s) => s.assignment_id));
      return assignments.filter((a) => !submittedIds.has(a.id)).length;
    }

    if (role === 'PARENT') {
      const { data: guardianLinks } = await client
        .from('guardians').select('student:students!inner(id, current_class_id)').eq('user_id', userId);
      const students = (guardianLinks ?? []).map((g) => g.student as unknown as { id: string; current_class_id: string | null }).filter(Boolean);
      if (students.length === 0) return 0;
      const classIds = Array.from(new Set(students.map((s) => s.current_class_id).filter((c): c is string => !!c)));
      const studentIds = students.map((s) => s.id);

      let homeworkCount = 0;
      if (classIds.length > 0) {
        const { data: homework } = await client
          .from('homework_assignments').select('id, class_id')
          .in('class_id', classIds).gte('due_date', today).lte('due_date', in7Days);
        if (homework && homework.length > 0) {
          const { data: completions } = await client
            .from('homework_completions').select('homework_id, student_id')
            .in('homework_id', homework.map((h) => h.id)).in('student_id', studentIds);
          const completedSet = new Set((completions ?? []).map((c) => `${c.homework_id}:${c.student_id}`));
          for (const hw of homework) {
            const classStudents = students.filter((s) => s.current_class_id === hw.class_id);
            for (const s of classStudents) {
              if (!completedSet.has(`${hw.id}:${s.id}`)) homeworkCount += 1;
            }
          }
        }
      }

      const { data: slips } = await client.from('permission_slips').select('id, audience, target_class_id');
      let slipCount = 0;
      const relevantSlips = (slips ?? []).filter((sl) => sl.audience === 'SCHOOL_WIDE' || classIds.includes(sl.target_class_id ?? ''));
      if (relevantSlips.length > 0) {
        const { data: responses } = await client
          .from('permission_slip_responses').select('slip_id, student_id')
          .in('slip_id', relevantSlips.map((s) => s.id)).in('student_id', studentIds);
        const respondedSet = new Set((responses ?? []).map((r) => `${r.slip_id}:${r.student_id}`));
        for (const slip of relevantSlips) {
          for (const s of students) {
            if (!respondedSet.has(`${slip.id}:${s.id}`)) slipCount += 1;
          }
        }
      }
      return homeworkCount + slipCount;
    }

    if (role === 'TEACHER') {
      const { data: teacher } = await client.from('teachers').select('id, is_class_teacher_of').eq('user_id', userId).maybeSingle();
      if (!teacher?.is_class_teacher_of) return 0;
      const { data: currentTerm } = await client.from('terms').select('id').eq('is_current', true).maybeSingle();
      if (!currentTerm) return 0;
      const { data: unsigned } = await client
        .from('student_report_cards').select('student_id, students!inner(current_class_id)')
        .eq('term_id', currentTerm.id).is('class_teacher_comment', null).eq('students.current_class_id', teacher.is_class_teacher_of);
      return (unsigned ?? []).length;
    }

    return 0;
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

  async acknowledge(accessToken: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .forUser(accessToken)
      .from('notifications')
      .update({ acknowledged_at: new Date().toISOString(), is_read: true })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  /**
   * Dispatcher — called by the scheduler every minute.
   * Sends pending email notifications via Brevo.
   * Uses admin client to bypass RLS. Per-row errors are logged, not thrown.
   */
  async dispatch(): Promise<void> {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const now = new Date().toISOString();
    const { data: rows, error } = await this.supabase.admin
      .from('notifications')
      .select('id, recipient_id, type, title, body, email_sent_at')
      .is('email_sent_at', null)
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
        const unsubToken = this.buildUnsubscribeToken(row.recipient_id, row.type);
        const sent = await this.sendEmail(senderEmail, senderName, user.email, row.title, row.body, unsubToken);
        if (sent) {
          emailSentAt = new Date().toISOString();
        } else {
          // Email failed — record error so admins can see it; retry next minute
          await this.supabase.admin
            .from('notifications')
            .update({ error_message: 'Email delivery failed — will retry' })
            .eq('id', row.id);
          continue; // do not mark email_sent_at — retry on next dispatch
        }
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
