import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import NotificationsView from './NotificationsView';

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'SUPER_ADMIN';

function notifHref(type: string, metadata: any, role: Role): string {
  switch (type) {
    case 'ABSENT_STUDENT':
      return role === 'PARENT' ? '/parent/attendance' : role === 'ADMIN' ? '/admin/attendance' : '/notifications';
    case 'HOMEWORK_ASSIGNED':
      return role === 'STUDENT' ? '/student/homework' : role === 'PARENT' ? '/parent/homework' : role === 'TEACHER' ? '/teacher/homework' : '/notifications';
    case 'NEW_ANNOUNCEMENT':
      return role === 'ADMIN' ? '/admin/announcements' : `/${role.toLowerCase()}`;
    case 'NEW_MESSAGE':
      return metadata?.conversationId
        ? (role === 'ADMIN' ? `/admin/messages/${metadata.conversationId}` : `/messages/${metadata.conversationId}`)
        : (role === 'ADMIN' ? '/admin/messages' : '/messages');
    default:
      return '/notifications';
  }
}

export default async function NotificationsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users').select('id, role').eq('auth_id', user.id).maybeSingle();
  if (!userRow) return null;
  const role = userRow.role as Role;

  // ── Alerts: notifications table + (ADMIN only) unread platform messages ──
  const { data: notifRows } = await supabase
    .from('notifications')
    .select('id, type, title, body, is_read, acknowledged_at, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  const alerts = (notifRows ?? []).map((n) => ({
    id: n.id as string,
    kind: 'notification' as const,
    title: n.title as string,
    body: n.body as string,
    timestamp: n.created_at as string,
    isRead: n.is_read as boolean,
    href: notifHref(n.type as string, n.metadata, role),
    notifType: n.type as string,
    acknowledgedAt: n.acknowledged_at as string | null,
  }));

  if (role === 'ADMIN') {
    const { data: pmRows } = await supabase
      .from('platform_message_recipients')
      .select('id, read_at, message:platform_messages(subject, body, sent_at)')
      .is('dismissed_at', null);
    for (const r of pmRows ?? []) {
      const msg = (r as any).message;
      if (!msg) continue;
      alerts.push({
        id: `pm:${r.id}`,
        kind: 'notification' as const,
        title: `[Platform] ${msg.subject}`,
        body: msg.body,
        timestamp: msg.sent_at,
        isRead: !!r.read_at,
        href: '/notifications/platform',
        notifType: 'PLATFORM_MESSAGE',
        acknowledgedAt: null,
      });
    }
  }
  alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // ── Conversations: unread threads the caller is party to ──
  const unreadColumn = role === 'PARENT' ? 'parent_unread_count' : role === 'TEACHER' ? 'teacher_unread_count' : role === 'ADMIN' ? 'admin_unread_count' : null;
  let conversations: { id: string; otherPartyName: string; preview: string; timestamp: string; unreadCount: number; href: string }[] = [];
  if (unreadColumn) {
    const { data: convRows } = await supabase
      .from('conversations')
      .select(`
        id, last_message_body, last_message_at, ${unreadColumn},
        parent:users!parent_user_id(full_name), teacher:users!teacher_user_id(full_name), admin:users!admin_user_id(full_name)
      `)
      .gt(unreadColumn, 0)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    conversations = (convRows ?? []).map((c: any) => {
      const otherParty = role === 'PARENT' ? c.teacher?.full_name : role === 'TEACHER' ? (c.parent?.full_name ?? c.admin?.full_name) : (c.parent?.full_name ?? c.teacher?.full_name);
      return {
        id: c.id as string,
        otherPartyName: otherParty ?? 'Unknown',
        preview: c.last_message_body ?? '',
        timestamp: c.last_message_at ?? '',
        unreadCount: c[unreadColumn] as number,
        href: role === 'ADMIN' ? `/admin/messages/${c.id}` : `/messages/${c.id}`,
      };
    });
  }

  // ── Reminders: role-specific upcoming deadlines ──
  const reminders: { id: string; title: string; subtitle: string; dueDate: string; href: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const in7Days = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  if (role === 'STUDENT') {
    const { data: student } = await supabase.from('students').select('id, current_class_id').eq('user_id', userRow.id).maybeSingle();
    if (student) {
      const { data: assignments } = await supabase
        .from('assignments').select('id, title, due_date')
        .eq('class_id', student.current_class_id).gte('due_date', today).lte('due_date', in7Days);
      const { data: submissions } = await supabase
        .from('submissions').select('assignment_id').eq('student_id', student.id);
      const submittedIds = new Set((submissions ?? []).map((s) => s.assignment_id));
      for (const a of assignments ?? []) {
        if (submittedIds.has(a.id)) continue;
        reminders.push({ id: `a:${a.id}`, title: a.title, subtitle: 'Assignment due', dueDate: a.due_date, href: '/student/assignments' });
      }
    }
  }

  if (role === 'PARENT') {
    const { data: guardianLinks } = await supabase
      .from('guardians').select('student:students!inner(id, current_class_id, user:users!inner(full_name))').eq('user_id', userRow.id);
    const students = (guardianLinks ?? []).map((g: any) => g.student).filter(Boolean);
    const classIds = Array.from(new Set(students.map((s: any) => s.current_class_id).filter(Boolean)));
    const studentIds = students.map((s: any) => s.id);

    if (classIds.length > 0) {
      const { data: homework } = await supabase
        .from('homework_assignments').select('id, title, due_date, class_id')
        .in('class_id', classIds).gte('due_date', today).lte('due_date', in7Days);
      const { data: completions } = await supabase
        .from('homework_completions').select('homework_id, student_id')
        .in('homework_id', (homework ?? []).map((h) => h.id));
      const completedSet = new Set((completions ?? []).map((c) => `${c.homework_id}:${c.student_id}`));
      for (const hw of homework ?? []) {
        const classStudents = students.filter((s: any) => s.current_class_id === hw.class_id);
        for (const s of classStudents) {
          if (completedSet.has(`${hw.id}:${s.id}`)) continue;
          reminders.push({
            id: `hw:${hw.id}:${s.id}`, title: hw.title,
            subtitle: `Homework for ${s.user?.full_name ?? 'your child'}`, dueDate: hw.due_date, href: '/parent/homework',
          });
        }
      }
    }

    const { data: slips } = await supabase.from('permission_slips').select('id, title, response_deadline, audience, target_class_id');
    const relevantSlips = (slips ?? []).filter((sl) => sl.audience === 'SCHOOL_WIDE' || classIds.includes(sl.target_class_id));
    if (relevantSlips.length > 0) {
      const { data: responses } = await supabase
        .from('permission_slip_responses').select('slip_id, student_id')
        .in('slip_id', relevantSlips.map((s) => s.id)).in('student_id', studentIds);
      const respondedSet = new Set((responses ?? []).map((r) => `${r.slip_id}:${r.student_id}`));
      for (const slip of relevantSlips) {
        for (const s of students as any[]) {
          if (respondedSet.has(`${slip.id}:${s.id}`)) continue;
          reminders.push({
            id: `slip:${slip.id}:${s.id}`, title: slip.title,
            subtitle: `Permission slip for ${s.user?.full_name ?? 'your child'}`,
            dueDate: slip.response_deadline ?? '', href: '/parent/permission-slips',
          });
        }
      }
    }
  }

  if (role === 'TEACHER') {
    const { data: teacher } = await supabase.from('teachers').select('id, is_class_teacher_of').eq('user_id', userRow.id).maybeSingle();
    if (teacher?.is_class_teacher_of) {
      const { data: currentTerm } = await supabase.from('terms').select('id, name').eq('is_current', true).maybeSingle();
      if (currentTerm) {
        const { data: unsigned } = await supabase
          .from('student_report_cards')
          .select('id, student_id, students!inner(current_class_id, user:users!inner(full_name))')
          .eq('term_id', currentTerm.id).is('class_teacher_comment', null).eq('students.current_class_id', teacher.is_class_teacher_of);
        for (const rc of unsigned ?? []) {
          // No dedicated teacher report-card page exists yet (admin/report-cards
          // is admin-only) — link home rather than to a route that 404s/misroutes.
          reminders.push({
            id: `rc:${rc.id}`, title: `Report card awaiting sign-off`,
            subtitle: (rc as any).students?.user?.full_name ?? 'Student', dueDate: '', href: '/teacher',
          });
        }
      }
    }
  }

  reminders.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <BackButton href="/" />
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {alerts.length + conversations.length + reminders.length === 0
              ? 'Nothing to see here.'
              : `${alerts.filter((a) => !a.isRead).length + conversations.length + reminders.length} need your attention`}
          </p>
        </div>
      </div>

      <NotificationsView alerts={alerts} conversations={conversations} reminders={reminders} />
    </div>
  );
}
