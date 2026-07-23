import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import LeaderboardClient from './LeaderboardClient';

export default async function LeaderboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users').select('id, role').eq('auth_id', user.id).maybeSingle();
  const role = (userRow?.role as string) ?? '';

  let teachableClasses: { id: string; name: string }[] = [];
  let classTeacherOfId: string | null = null;
  let gradeLevels: number[] = [];

  if (role === 'TEACHER') {
    const { data: teacherRow } = await supabase
      .from('teachers').select('id, is_class_teacher_of').eq('user_id', userRow?.id ?? '').maybeSingle();
    classTeacherOfId = teacherRow?.is_class_teacher_of ?? null;

    const { data: assigns } = await supabase
      .from('subject_assignments').select('class:classes(id, name)').eq('teacher_id', teacherRow?.id ?? '');
    const seen = new Set<string>();
    teachableClasses = [
      ...(assigns ?? []).map((a) => a.class as unknown as { id: string; name: string } | null).filter((c): c is { id: string; name: string } => !!c),
      ...(classTeacherOfId ? [{ id: classTeacherOfId, name: '' }] : []),
    ].filter((c) => c.id && !seen.has(c.id) && seen.add(c.id));
    // Fill in the class-teacher class's real name if it was only added as a placeholder above.
    if (classTeacherOfId && !teachableClasses.find((c) => c.id === classTeacherOfId && c.name)) {
      const { data: cls } = await supabase.from('classes').select('id, name').eq('id', classTeacherOfId).maybeSingle();
      if (cls) teachableClasses = teachableClasses.map((c) => (c.id === cls.id ? cls : c));
    }
  }

  if (role === 'ADMIN') {
    const { data: classes } = await supabase.from('classes').select('id, name, grade_level').order('grade_level');
    teachableClasses = (classes ?? []).map((c) => ({ id: c.id, name: c.name }));
    gradeLevels = [...new Set((classes ?? []).map((c) => c.grade_level))].sort((a, b) => a - b);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href={`/${role.toLowerCase()}`} />
        <div>
          <h1 className="text-2xl font-semibold">Behaviour Leaderboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Recognizing positive behaviour across the school.</p>
        </div>
      </div>
      <LeaderboardClient
        role={role}
        classTeacherOfId={classTeacherOfId}
        teachableClasses={teachableClasses}
        gradeLevels={gradeLevels}
      />
    </div>
  );
}
