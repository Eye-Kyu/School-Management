import { createClient } from '@/lib/supabase/server';
import MessagesClient from './MessagesClient';

export default async function MessagesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Read role server-side — reliable, doesn't depend on API call
  const { data: userRow } = await supabase
    .from('users')
    .select('id, role')
    .eq('auth_id', user.id)
    .maybeSingle();

  const role = userRow?.role as string ?? '';

  // Class Teacher gets a "Broadcast to class parents" entry point.
  let classTeacherOf: { id: string; name: string } | null = null;
  if (role === 'TEACHER') {
    const { data: teacherRow } = await supabase
      .from('teachers')
      .select('is_class_teacher_of, class:classes!is_class_teacher_of(id, name)')
      .eq('user_id', userRow?.id ?? '')
      .maybeSingle();
    const cls = teacherRow?.class as unknown as { id: string; name: string } | null;
    if (teacherRow?.is_class_teacher_of && cls) classTeacherOf = cls;
  }

  // Pre-fetch conversations so the list isn't empty on first load
  const { data: conversations } = await supabase
    .from('conversations')
    .select(`
      id, last_message_body, last_message_at, is_flagged,
      parent_unread_count, teacher_unread_count, admin_unread_count,
      parent:users!parent_user_id(id, full_name, avatar_url),
      teacher:users!teacher_user_id(id, full_name, avatar_url),
      admin:users!admin_user_id(id, full_name, avatar_url),
      student:students(id, user:users!user_id(full_name))
    `)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(50);

  return (
    <MessagesClient
      role={role}
      initialConversations={(conversations ?? []) as any[]}
      userId={userRow?.id ?? ''}
      classTeacherOf={classTeacherOf}
    />
  );
}
