import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import GradebookClient from './GradebookClient';

export default async function GradebookPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Two-step lookup: auth user → users row → teachers row
  const { data: userRow } = await supabase
    .from('users').select('id').eq('auth_id', user.id).maybeSingle();

  const { data: teacher } = userRow
    ? await supabase.from('teachers').select('id').eq('user_id', userRow.id).maybeSingle()
    : { data: null };

  const [{ data: assignments }, { data: subjects }, { data: terms }] = await Promise.all([
    teacher
      ? supabase
          .from('subject_assignments')
          .select('class_id, subject_id, class:classes!class_id(id, name, grade_level), subject:subjects!subject_id(id, name)')
          .eq('teacher_id', teacher.id)
      : { data: [] },
    supabase.from('subjects').select('id, name').order('name'),
    supabase.from('terms').select('id, name, is_current').order('start_date', { ascending: false }),
  ]);

  // Unique classes this teacher is assigned to
  const seen = new Set<string>();
  const myClasses = (assignments ?? [])
    .map((a) => a.class as unknown as { id: string; name: string; grade_level: number })
    .filter((c) => c?.id && !seen.has(c.id) && seen.add(c.id));

  const currentTerm = (terms ?? []).find((t) => t.is_current) ?? (terms ?? [])[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Gradebook</h1>
          <p className="text-sm text-slate-500 mt-0.5">Create assessments and enter scores for your classes.</p>
        </div>
      </div>
      <GradebookClient
        teacherId={teacher?.id ?? ''}
        myClasses={myClasses}
        subjects={(subjects ?? []) as { id: string; name: string }[]}
        terms={(terms ?? []) as { id: string; name: string; is_current: boolean }[]}
        currentTermId={currentTerm?.id ?? ''}
      />
    </div>
  );
}
