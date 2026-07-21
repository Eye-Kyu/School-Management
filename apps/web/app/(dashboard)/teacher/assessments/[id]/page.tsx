import { createClient } from '@/lib/supabase/server';
import BackButton from '@/components/BackButton';
import GradeEntryClient from './GradeEntryClient';
import { notFound } from 'next/navigation';

export default async function GradeEntryPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, name, max_marks:max_score, assessment_date:date, class:classes(id, name), subject:subjects(name, code), term:terms(name)')
    .eq('id', params.id)
    .maybeSingle();

  if (!assessment) return notFound();

  const classId = (assessment.class as any)?.id;

  const [{ data: students }, { data: existingScores }] = await Promise.all([
    supabase
      .from('students')
      .select('id, admission_no, user:users!inner(full_name)')
      .eq('current_class_id', classId)
      .eq('is_active', true)
      .order('admission_no'),
    supabase
      .from('grades')
      .select('student_id, marks_obtained:score, comments:comment')
      .eq('assessment_id', params.id),
  ]);

  const scoresMap = Object.fromEntries(
    (existingScores ?? []).map((s) => [s.student_id, s]),
  );

  const roster = (students ?? []).map((s: any) => ({
    id: s.id,
    admissionNo: s.admission_no as string,
    fullName: s.user?.full_name as string ?? '',
    marksObtained: scoresMap[s.id]?.marks_obtained ?? null,
    comments: scoresMap[s.id]?.comments ?? '',
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackButton href="/teacher/assessments" />
        <div>
          <h1 className="text-2xl font-semibold">{(assessment as any).name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {(assessment.subject as any)?.name} · {(assessment.class as any)?.name} · out of {assessment.max_marks}
            {assessment.assessment_date
              ? ` · ${new Date(assessment.assessment_date).toLocaleDateString()}`
              : ''}
          </p>
        </div>
      </div>

      <GradeEntryClient
        assessmentId={params.id}
        maxMarks={assessment.max_marks}
        roster={roster}
      />
    </div>
  );
}
