import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import AssignmentsTeacherClient from './AssignmentsTeacherClient';

export default async function TeacherAssignmentsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user.id).maybeSingle();

  const { data: teacher } = await supabase
    .from('teachers').select('id')
    .eq('user_id', userRow?.id ?? '').maybeSingle();

  const [{ data: myAssignments }, { data: classes }, { data: subjects }, { data: terms }] = await Promise.all([
    supabase
      .from('assignments')
      .select('id, title, description, due_date, created_at, class:classes(name), subject:subjects(name), term:terms(name)')
      .eq('created_by_id', userRow?.id ?? '')
      .order('due_date', { ascending: true }),
    supabase.from('classes').select('id, name').eq('is_active', true).order('name'),
    supabase.from('subjects').select('id, name').order('name'),
    supabase.from('terms').select('id, name, is_current').order('start_date', { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Assignments</h1>
          <p className="text-sm text-slate-500 mt-0.5">Create online assignments for students to submit.</p>
        </div>
      </div>
      <AssignmentsTeacherClient
        assignments={(myAssignments ?? []) as any[]}
        classes={(classes ?? []) as { id: string; name: string }[]}
        subjects={(subjects ?? []) as { id: string; name: string }[]}
        terms={(terms ?? []) as { id: string; name: string; is_current: boolean }[]}
        teacherUserId={userRow?.id ?? ''}
      />
    </div>
  );
}
