import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import HomeworkClient from './HomeworkClient';

export default async function TeacherHomeworkPage() {
  const supabase = createClient();

  // Get current user's teacher record to find their classes
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: userRow }, { data: subjects }, { data: terms }] = await Promise.all([
    supabase.from('users').select('id').eq('auth_id', user?.id ?? '').maybeSingle(),
    supabase.from('subjects').select('id, name').order('name'),
    supabase.from('terms').select('id, name, is_current, start_date, end_date').order('start_date', { ascending: false }),
  ]);

  const [{ data: teacherRow }, { data: assignments }] = await Promise.all([
    userRow
      ? supabase.from('teachers').select('id').eq('user_id', userRow.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('homework_assignments')
      .select('id, title, description, due_date, class_id, subject_id, max_score, class:classes(name), subject:subjects(name)')
      .order('due_date', { ascending: true }),
  ]);

  // Which of these homework assignments are already linked to the gradebook.
  const homeworkIds = (assignments ?? []).map((a) => a.id);
  const { data: links } = homeworkIds.length > 0
    ? await supabase.from('assessments').select('id, source_id').eq('source_type', 'HOMEWORK').in('source_id', homeworkIds)
    : { data: [] };
  const linkedByHomeworkId = Object.fromEntries((links ?? []).map((l) => [l.source_id, l.id]));

  // Classes this teacher is assigned to
  const { data: assignedClasses } = teacherRow
    ? await supabase
        .from('subject_assignments')
        .select('class_id, class:classes(id, name)')
        .eq('teacher_id', teacherRow.id)
    : { data: [] };

  const uniqueClasses = Object.values(
    (assignedClasses ?? []).reduce<Record<string, { id: string; name: string }>>((acc, sa) => {
      const cls = sa.class as unknown as { id: string; name: string } | null;
      if (cls && !acc[cls.id]) acc[cls.id] = cls;
      return acc;
    }, {})
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Homework</h1>
          <p className="text-sm text-slate-500 mt-0.5">Assign physical homework. Students tick off when done on paper.</p>
        </div>
      </div>
      <HomeworkClient
        assignments={(assignments ?? []).map((a) => ({ ...a, linkedAssessmentId: linkedByHomeworkId[a.id] ?? null })) as any[]}
        classes={uniqueClasses}
        subjects={(subjects ?? []) as any[]}
        terms={(terms ?? []) as any[]}
      />
    </div>
  );
}
