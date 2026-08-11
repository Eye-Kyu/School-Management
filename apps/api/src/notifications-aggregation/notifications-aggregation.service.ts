import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { PaybillReconciliationService } from '../payments/paybill-reconciliation.service';
import { getCachedFeed, setCachedFeed, invalidateUserFeedCache } from './feed-cache';
import { cascadeNotificationReadToConversation } from '../messaging/message-read-cascade';
import type { DashboardFeedResponse, FeedAlertItem, FeedConversationItem, FeedReminderItem, Role } from './feed.types';

type Client = ReturnType<SupabaseService['forUser']>;

/**
 * Single source of truth for the "what's new for you" aggregation — consumed
 * by the /notifications page, the dashboard feed, and the bell's unread
 * count. Replaces two previously-drifting implementations (the notifications
 * page's own direct-Supabase queries, and NotificationsService.unreadCount()'s
 * separately-maintained counts-only re-implementation of the same logic).
 *
 * Two notification sources are deliberately NOT built here because they
 * already flow through the plain `notifications` table (buildAlerts below),
 * not a dedicated reminders query: Teacher's "attendance re-marking
 * approvals" (queued as ATTENDANCE_REMARK_REQUESTED) and Parent's "absence
 * approval outcomes" (queued as ABSENCE_REQUEST_DECIDED) — both are already
 * NotifType values, queued by attendance/absence-requests services.
 */
@Injectable()
export class NotificationsAggregationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly paybill: PaybillReconciliationService,
  ) {}

  async getFeed(accessToken: string): Promise<DashboardFeedResponse> {
    const me = (await this.supabase.currentUserRow(accessToken, 'id, role')) as { id: string; role: Role } | null;
    if (!me) return { alerts: [], conversations: [], reminders: [] };

    const cached = getCachedFeed(me.id);
    if (cached) return cached;

    const client = this.supabase.forUser(accessToken);
    const [alerts, conversations, reminders] = await Promise.all([
      this.buildAlerts(client, me.role),
      this.buildConversations(client, me.role),
      this.buildReminders(accessToken, client, me.id, me.role),
    ]);

    const feed: DashboardFeedResponse = { alerts, conversations, reminders };
    setCachedFeed(me.id, feed);
    return feed;
  }

  // Bubble count = unread across all three sections — derived from the same
  // buckets getFeed() builds, not a separate query path (the thing that made
  // the old unreadCount() drift from the page's own logic in the first place).
  async getUnreadCount(accessToken: string): Promise<number> {
    const feed = await this.getFeed(accessToken);
    const unreadAlerts = feed.alerts.filter((a) => !a.isRead).length;
    // Conversations/reminders are unread/outstanding-only by construction.
    return unreadAlerts + feed.conversations.length + feed.reminders.length;
  }

  // Handles both plain `notifications` row ids and `pm:`-prefixed
  // platform_message_recipients ids in one call — replaces the old split
  // between PATCH /notifications/read and a direct client-side Supabase
  // write for platform messages, so both paths can invalidate the cache.
  async markRead(accessToken: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const notifIds = ids.filter((id) => !id.startsWith('pm:'));
    const pmIds = ids.filter((id) => id.startsWith('pm:')).map((id) => id.slice(3));

    const client = this.supabase.forUser(accessToken);

    // BUG-6: look up which of these are NEW_MESSAGE before marking them
    // read, so their conversations can cascade too — see
    // message-read-cascade.ts for why this can't recurse into
    // MessagingService.markRead().
    let newMessageConversationIds: string[] = [];
    if (notifIds.length > 0) {
      const { data: newMessageRows } = await client
        .from('notifications')
        .select('metadata')
        .in('id', notifIds)
        .eq('type', 'NEW_MESSAGE');
      newMessageConversationIds = Array.from(new Set(
        (newMessageRows ?? [])
          .map((r) => (r.metadata as Record<string, unknown> | null)?.conversationId as string | undefined)
          .filter((id): id is string => !!id),
      ));
    }

    await Promise.all([
      notifIds.length > 0
        ? client.from('notifications').update({ is_read: true }).in('id', notifIds)
        : Promise.resolve(),
      pmIds.length > 0
        ? client.from('platform_message_recipients').update({ read_at: new Date().toISOString() }).in('id', pmIds)
        : Promise.resolve(),
    ]);

    const me = (await this.supabase.currentUserRow(accessToken, 'id, role')) as { id: string; role: Role } | null;
    if (me) {
      await Promise.all(
        newMessageConversationIds.map((conversationId) =>
          cascadeNotificationReadToConversation(client, conversationId, me.role),
        ),
      );
      invalidateUserFeedCache(me.id);
    }
  }

  private notifHref(type: string, metadata: Record<string, unknown> | null, role: Role): string {
    switch (type) {
      case 'ABSENT_STUDENT':
        return role === 'PARENT' ? '/parent/attendance' : role === 'ADMIN' ? '/admin/attendance' : '/notifications';
      case 'HOMEWORK_ASSIGNED':
        return role === 'STUDENT' ? '/student/homework' : role === 'PARENT' ? '/parent/homework' : role === 'TEACHER' ? '/teacher/homework' : '/notifications';
      case 'HOMEWORK_GRADED':
        return role === 'STUDENT' ? '/student/homework' : role === 'PARENT' ? '/parent/homework' : '/notifications';
      case 'NEW_ANNOUNCEMENT':
        return role === 'ADMIN' ? '/admin/announcements' : `/${role.toLowerCase()}`;
      case 'NEW_MESSAGE': {
        const conversationId = metadata?.conversationId as string | undefined;
        return conversationId
          ? (role === 'ADMIN' ? `/admin/messages/${conversationId}` : `/messages/${conversationId}`)
          : (role === 'ADMIN' ? '/admin/messages' : '/messages');
      }
      default:
        return '/notifications';
    }
  }

  private async buildAlerts(client: Client, role: Role): Promise<FeedAlertItem[]> {
    const { data: notifRows, error } = await client
      .from('notifications')
      .select('id, type, title, body, is_read, acknowledged_at, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) console.error('[NotificationsAggregationService] buildAlerts notifications fetch failed:', error.message);

    const alerts: FeedAlertItem[] = (notifRows ?? []).map((n) => ({
      id: n.id as string,
      kind: 'notification' as const,
      title: n.title as string,
      body: n.body as string,
      timestamp: n.created_at as string,
      isRead: n.is_read as boolean,
      href: this.notifHref(n.type as string, n.metadata as Record<string, unknown> | null, role),
      notifType: n.type as string,
      acknowledgedAt: n.acknowledged_at as string | null,
    }));

    if (role === 'ADMIN') {
      const { data: pmRows } = await client
        .from('platform_message_recipients')
        .select('id, read_at, message:platform_messages(subject, body, sent_at)')
        .is('dismissed_at', null);
      for (const r of (pmRows ?? []) as unknown as { id: string; read_at: string | null; message: { subject: string; body: string; sent_at: string } | null }[]) {
        if (!r.message) continue;
        alerts.push({
          id: `pm:${r.id}`,
          kind: 'notification',
          title: r.message.subject,
          body: r.message.body,
          timestamp: r.message.sent_at,
          isRead: !!r.read_at,
          href: '/notifications/platform',
          notifType: 'PLATFORM_MESSAGE',
          acknowledgedAt: null,
        });
      }
    }
    alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return alerts;
  }

  private async buildConversations(client: Client, role: Role): Promise<FeedConversationItem[]> {
    const unreadColumn = role === 'PARENT' ? 'parent_unread_count' : role === 'TEACHER' ? 'teacher_unread_count' : role === 'ADMIN' ? 'admin_unread_count' : null;
    if (!unreadColumn) return [];

    const { data: convRows } = await client
      .from('conversations')
      .select(`
        id, last_message_body, last_message_at, ${unreadColumn},
        parent:users!parent_user_id(full_name), teacher:users!teacher_user_id(full_name), admin:users!admin_user_id(full_name)
      `)
      .gt(unreadColumn, 0)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    return ((convRows ?? []) as unknown as Record<string, unknown>[]).map((c) => {
      const parentName = (c.parent as { full_name?: string } | null)?.full_name;
      const teacherName = (c.teacher as { full_name?: string } | null)?.full_name;
      const adminName = (c.admin as { full_name?: string } | null)?.full_name;
      const otherParty = role === 'PARENT' ? teacherName : role === 'TEACHER' ? (parentName ?? adminName) : (parentName ?? teacherName);
      return {
        id: c.id as string,
        otherPartyName: otherParty ?? 'Unknown',
        preview: (c.last_message_body as string | null) ?? '',
        timestamp: (c.last_message_at as string | null) ?? '',
        unreadCount: c[unreadColumn] as number,
        href: role === 'ADMIN' ? `/admin/messages/${c.id}` : `/messages/${c.id}`,
      };
    });
  }

  private async buildReminders(accessToken: string, client: Client, userId: string, role: Role): Promise<FeedReminderItem[]> {
    let reminders: FeedReminderItem[] = [];
    if (role === 'STUDENT') reminders = await this.studentReminders(client, userId);
    else if (role === 'PARENT') reminders = await this.parentReminders(client, userId);
    else if (role === 'TEACHER') reminders = await this.teacherReminders(client, userId);
    else if (role === 'ADMIN') reminders = await this.adminReminders(accessToken, client);

    reminders.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    return reminders;
  }

  private async studentReminders(client: Client, userId: string): Promise<FeedReminderItem[]> {
    const reminders: FeedReminderItem[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const in7Days = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const { data: student } = await client.from('students').select('id, current_class_id').eq('user_id', userId).maybeSingle();
    if (!student) return reminders;

    const { data: assignments } = await client
      .from('assignments').select('id, title, due_date')
      .eq('class_id', student.current_class_id).gte('due_date', today).lte('due_date', in7Days);
    const { data: ownSubmissions } = await client
      .from('submissions').select('assignment_id, graded_at').eq('student_id', student.id);
    const submittedIds = new Set((ownSubmissions ?? []).map((s) => s.assignment_id));
    for (const a of assignments ?? []) {
      if (submittedIds.has(a.id)) continue;
      reminders.push({
        id: `a:${a.id}`, title: a.title, subtitle: 'Assignment due', dueDate: a.due_date,
        href: '/student/assignments', badge: a.due_date <= tomorrow ? 'Due tomorrow' : undefined,
      });
    }

    // Recently graded/returned work (feedback available) — no "seen" state
    // exists on submissions, so this is time-boxed like every other reminder
    // here rather than a persistent unread flag.
    const recentlyGraded = (ownSubmissions ?? []).filter((s) => s.graded_at && s.graded_at >= sevenDaysAgoIso);
    if (recentlyGraded.length > 0) {
      const { data: gradedAssignments } = await client
        .from('assignments').select('id, title').in('id', recentlyGraded.map((s) => s.assignment_id));
      for (const s of recentlyGraded) {
        const a = (gradedAssignments ?? []).find((x) => x.id === s.assignment_id);
        reminders.push({
          id: `feedback:${s.assignment_id}`, title: a?.title ?? 'Assignment', subtitle: 'Feedback available',
          dueDate: '', href: '/student/assignments', badge: 'New feedback',
        });
      }
    }

    return reminders;
  }

  private async parentReminders(client: Client, userId: string): Promise<FeedReminderItem[]> {
    const reminders: FeedReminderItem[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const in7Days = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    const { data: guardianLinks } = await client
      .from('guardians').select('student:students!inner(id, current_class_id, user:users!inner(full_name))').eq('user_id', userId);
    type LinkedStudent = { id: string; current_class_id: string | null; user: { full_name: string } | null };
    const students = ((guardianLinks ?? []) as unknown as { student: LinkedStudent }[]).map((g) => g.student).filter(Boolean);
    if (students.length === 0) return reminders;
    const classIds = Array.from(new Set(students.map((s) => s.current_class_id).filter((c): c is string => !!c)));
    const studentIds = students.map((s) => s.id);

    if (classIds.length > 0) {
      const { data: homework } = await client
        .from('homework_assignments').select('id, title, due_date, class_id')
        .in('class_id', classIds).gte('due_date', today).lte('due_date', in7Days);
      const { data: completions } = await client
        .from('homework_completions').select('homework_id, student_id')
        .in('homework_id', (homework ?? []).map((h) => h.id));
      const completedSet = new Set((completions ?? []).map((c) => `${c.homework_id}:${c.student_id}`));
      for (const hw of homework ?? []) {
        const classStudents = students.filter((s) => s.current_class_id === hw.class_id);
        for (const s of classStudents) {
          if (completedSet.has(`${hw.id}:${s.id}`)) continue;
          reminders.push({
            id: `hw:${hw.id}:${s.id}`, title: hw.title,
            subtitle: `Homework for ${s.user?.full_name ?? 'your child'}`, dueDate: hw.due_date, href: '/parent/homework',
          });
        }
      }
    }

    const { data: slips } = await client.from('permission_slips').select('id, title, response_deadline, audience, target_class_id');
    const relevantSlips = (slips ?? []).filter((sl) => sl.audience === 'SCHOOL_WIDE' || classIds.includes(sl.target_class_id ?? ''));
    if (relevantSlips.length > 0) {
      const { data: responses } = await client
        .from('permission_slip_responses').select('slip_id, student_id')
        .in('slip_id', relevantSlips.map((s) => s.id)).in('student_id', studentIds);
      const respondedSet = new Set((responses ?? []).map((r) => `${r.slip_id}:${r.student_id}`));
      for (const slip of relevantSlips) {
        for (const s of students) {
          if (respondedSet.has(`${slip.id}:${s.id}`)) continue;
          reminders.push({
            id: `slip:${slip.id}:${s.id}`, title: slip.title,
            subtitle: `Permission slip for ${s.user?.full_name ?? 'your child'}`,
            dueDate: slip.response_deadline ?? '', href: '/parent/permission-slips',
          });
        }
      }
    }

    const { data: feeBalances } = await client
      .from('fee_balances').select('student_id, amount_due, amount_paid, currency').in('student_id', studentIds);
    const outstandingByStudent = new Map<string, { amount: number; currency: string }>();
    for (const fb of feeBalances ?? []) {
      const outstanding = Number(fb.amount_due) - Number(fb.amount_paid);
      if (outstanding <= 0) continue;
      const prev = outstandingByStudent.get(fb.student_id);
      outstandingByStudent.set(fb.student_id, { amount: (prev?.amount ?? 0) + outstanding, currency: fb.currency });
    }
    for (const [studentId, { amount, currency }] of outstandingByStudent) {
      const s = students.find((x) => x.id === studentId);
      reminders.push({
        id: `fee:${studentId}`, title: `Fee balance: ${currency} ${amount.toFixed(2)}`,
        subtitle: `Outstanding for ${s?.user?.full_name ?? 'your child'}`, dueDate: '', href: '/parent/fees',
        badge: 'Awaiting your action',
      });
    }

    return reminders;
  }

  private async teacherReminders(client: Client, userId: string): Promise<FeedReminderItem[]> {
    const reminders: FeedReminderItem[] = [];
    const { data: teacher } = await client.from('teachers').select('id, is_class_teacher_of').eq('user_id', userId).maybeSingle();
    if (!teacher) return reminders;

    if (teacher.is_class_teacher_of) {
      const { data: currentTerm } = await client.from('terms').select('id').eq('is_current', true).maybeSingle();
      if (currentTerm) {
        const { data: unsigned } = await client
          .from('student_report_cards')
          .select('id, student_id, students!inner(current_class_id, user:users!inner(full_name))')
          .eq('term_id', currentTerm.id).is('class_teacher_comment', null).eq('students.current_class_id', teacher.is_class_teacher_of);
        for (const rc of (unsigned ?? []) as unknown as { id: string; students: { user: { full_name: string } | null } }[]) {
          reminders.push({
            id: `rc:${rc.id}`, title: 'Report card awaiting sign-off',
            subtitle: rc.students?.user?.full_name ?? 'Student', dueDate: '', href: '/teacher',
          });
        }
      }
    }

    // Assignments awaiting grading — same class-scope resolution
    // messaging.service.ts uses for teacher messaging scope (subject_assignments + is_class_teacher_of).
    const { data: assignmentsRows } = await client.from('subject_assignments').select('class_id').eq('teacher_id', teacher.id);
    const classIds = Array.from(new Set([
      ...(assignmentsRows ?? []).map((a) => a.class_id).filter((c): c is string => !!c),
      ...(teacher.is_class_teacher_of ? [teacher.is_class_teacher_of] : []),
    ]));
    if (classIds.length > 0) {
      const { data: assignments } = await client.from('assignments').select('id, title').in('class_id', classIds);
      if (assignments && assignments.length > 0) {
        const { data: ungraded } = await client
          .from('submissions').select('id, assignment_id')
          .in('assignment_id', assignments.map((a) => a.id)).is('grade_score', null);
        const gradingByAssignment = new Map<string, number>();
        for (const s of ungraded ?? []) {
          gradingByAssignment.set(s.assignment_id, (gradingByAssignment.get(s.assignment_id) ?? 0) + 1);
        }
        for (const [assignmentId, count] of gradingByAssignment) {
          const a = assignments.find((x) => x.id === assignmentId);
          reminders.push({
            id: `grading:${assignmentId}`, title: a?.title ?? 'Assignment',
            subtitle: `${count} submission${count === 1 ? '' : 's'} awaiting grading`, dueDate: '', href: '/teacher/assignments',
            badge: 'Awaiting your action',
          });
        }
      }
    }

    return reminders;
  }

  private async adminReminders(accessToken: string, client: Client): Promise<FeedReminderItem[]> {
    const reminders: FeedReminderItem[] = [];

    // Permission slips still missing signatures — the same gap PARENT sees
    // per-child, re-surfaced per-slip (not fanned out per student, which
    // would be huge for a whole-school view).
    const { data: slips } = await client.from('permission_slips').select('id, title, response_deadline, audience, target_class_id');
    for (const slip of slips ?? []) {
      // students has no deleted_at column (that lives on users) — is_active
      // is the established soft-delete flag here, per students.service.ts.
      const studentsQuery = slip.audience === 'SCHOOL_WIDE'
        ? client.from('students').select('id').eq('is_active', true)
        : client.from('students').select('id').eq('current_class_id', slip.target_class_id ?? '').eq('is_active', true);
      const { data: students } = await studentsQuery;
      const studentIds = (students ?? []).map((s) => s.id);
      if (studentIds.length === 0) continue;

      const { data: responses } = await client
        .from('permission_slip_responses').select('student_id')
        .eq('slip_id', slip.id).in('student_id', studentIds);
      const respondedCount = new Set((responses ?? []).map((r) => r.student_id)).size;
      const missing = studentIds.length - respondedCount;
      if (missing > 0) {
        reminders.push({
          id: `slip-gap:${slip.id}`, title: slip.title, subtitle: `${missing} student${missing === 1 ? '' : 's'} haven't responded`,
          dueDate: slip.response_deadline ?? '', href: '/admin/permission-slips',
        });
      }
    }

    // Paybill sources — only if the payments module is enabled for this
    // school; a disabled module means an empty array, never an error, since
    // this is a sub-section of a bigger response, not a whole gated route.
    const me = (await this.supabase.currentUserRow(accessToken, 'school_id')) as { school_id: string } | null;
    if (me?.school_id) {
      const { data: enabled } = await this.supabase.admin.rpc('module_enabled', { p_school_id: me.school_id, p_module_key: 'payments' });
      if (enabled) {
        const [unmatched, overpayments] = await Promise.all([
          this.paybill.listUnmatched(accessToken),
          this.paybill.listOverpayments(accessToken),
        ]);
        for (const u of unmatched as { id: string; amount: number; bill_reference_number: string }[]) {
          reminders.push({
            id: `paybill-unmatched:${u.id}`, title: `Unmatched payment: KES ${u.amount}`,
            subtitle: `Ref ${u.bill_reference_number} — awaiting match`, dueDate: '', href: '/admin/payments',
            badge: 'Awaiting your action',
          });
        }
        for (const o of overpayments as { id: string; amount: number }[]) {
          reminders.push({
            id: `paybill-overpayment:${o.id}`, title: `Overpayment: KES ${o.amount}`,
            subtitle: 'Needs resolution', dueDate: '', href: '/admin/payments',
            badge: 'Awaiting your action',
          });
        }
      }
    }

    return reminders;
  }
}
