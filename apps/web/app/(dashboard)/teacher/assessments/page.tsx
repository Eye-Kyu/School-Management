import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import AssessmentsClient from './AssessmentsClient';

export default async function TeacherAssessmentsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('users.auth_id', user.id)
    .maybeSingle();

  const { data: currentTerm } = await supabase
    .from('terms')
    .select('id, name')
    .eq('is_current', true)
    .maybeSingle();

  // Subject assignments for the "new assessment" form dropdowns
  const { data: assignments } = teacher
    ? await supabase
        .from('subject_assignments')
        .select('class:classes!inner(id, name), subject:subjects!inner(id, name, code)')
        .eq('teacher_id', teacher.id)
    : { data: [] };

  // Unique classes
  const seenClasses = new Set<string>();
  const classes = (assignments ?? [])
    .map((a: any) => a.class)
    .filter((c: any) => c && !seenClasses.has(c.id) && seenClasses.add(c.id))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  // class → subjects map
  const classSubjectsMap: Record<string, { id: string; name: string; code: string }[]> = {};
  for (const a of (assignments ?? []) as any[]) {
    if (!a.class || !a.subject) continue;
    const cid = a.class.id;
    if (!classSubjectsMap[cid]) classSubjectsMap[cid] = [];
    if (!classSubjectsMap[cid].find((s) => s.id === a.subject.id)) {
      classSubjectsMap[cid].push(a.subject);
    }
  }

  // Fetch assessments
  const { data: assessments } = teacher
    ? await supabase
        .from('assessments')
        .select('id, name, max_marks, assessment_date, created_at, term:terms(id, name), class:classes(id, name), subject:subjects(id, name, code)')
        .eq('teacher_id', teacher.id)
        .order('created_at', { ascending: false })
    : { data: [] };

  const terms = currentTerm ? [currentTerm] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher" />
        <div>
          <h1 className="text-2xl font-semibold">Assessments</h1>
          <p className="text-sm text-slate-500 mt-0.5">Create assessments and enter student marks.</p>
        </div>
      </div>

      <AssessmentsClient
        assessments={(assessments ?? []) as any[]}
        classes={classes}
        classSubjectsMap={classSubjectsMap}
        terms={terms}
        currentTermId={currentTerm?.id ?? null}
      />
    </div>
  );
}
