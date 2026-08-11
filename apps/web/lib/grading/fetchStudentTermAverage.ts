// =============================================================================
// Frontend fetcher for calculateStudentTermAverage() (packages/types/src/grading.ts)
// =============================================================================
// Mirrors apps/api/src/attendance/fetchers.ts' fetchStudentTermAverageInputs
// (same three sources, same dedup-by-source_id join) using the page's own
// RLS-scoped Supabase client — every one of grades/homework_completions/
// quiz_attempts is directly readable server-side for the roles that call
// this (ADMIN/TEACHER/the student themself/their guardian), unlike the
// approved-absences overlay, so no API round-trip is needed here.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentTermAverageInput, GradeRow, HomeworkCompletion, QuizAttempt } from '@school-manager/types';

export async function fetchStudentTermAverage(
  client: SupabaseClient,
  params: { studentId: string; termId?: string },
): Promise<StudentTermAverageInput> {
  // source_type/source_id live on `assessments`, not `grades` — selected
  // off the joined `assessment` embed below, matching the corrected shape
  // in apps/api/src/attendance/fetchers.ts' fetchStudentTermAverageInputs.
  let gradesQuery = client
    .from('grades')
    .select(
      'score, assessment:assessments!inner(id, subject_id, max_marks, term_id, source_type, source_id, subject:subjects!inner(name))',
    )
    .eq('student_id', params.studentId);
  if (params.termId) gradesQuery = gradesQuery.eq('assessment.term_id', params.termId);
  const { data: gradeRows } = await gradesQuery;

  const gradesFromGradebook: GradeRow[] = (gradeRows ?? [])
    .filter((g: any) => g.score != null && g.assessment)
    .map((g: any) => {
      const assessment = g.assessment as {
        id: string; subject_id: string; max_marks: number; subject: { name: string } | null;
        source_type?: string | null; source_id?: string | null;
      };
      return {
        assessment_id: assessment.id,
        subject_id: assessment.subject_id,
        subject_name: assessment.subject?.name ?? '',
        score: Number(g.score),
        max_marks: assessment.max_marks,
        source_type: (assessment.source_type as GradeRow['source_type']) ?? 'DIRECT',
        source_id: assessment.source_id ?? null,
      };
    });

  const { data: completionRows } = await client
    .from('homework_completions')
    .select('homework_id, score, homework:homework_assignments!inner(subject_id, max_score, subject:subjects(name))')
    .eq('student_id', params.studentId)
    .not('score', 'is', null);

  const homeworkCompletions: HomeworkCompletion[] = (completionRows ?? [])
    .filter((c: any) => c.homework && c.homework.max_score != null)
    .map((c: any) => {
      const homework = c.homework as { subject_id: string | null; max_score: number; subject: { name: string } | null };
      return {
        homework_id: c.homework_id,
        subject_id: homework.subject_id ?? '',
        subject_name: homework.subject?.name ?? '',
        score: Number(c.score),
        max_score: homework.max_score,
      };
    });

  const { data: attemptRows } = await client
    .from('quiz_attempts')
    .select('quiz_id, score, max_score, quiz:quizzes!inner(subject_id, subject:subjects(name))')
    .eq('student_id', params.studentId)
    .not('score', 'is', null)
    .not('max_score', 'is', null);

  const quizAttempts: QuizAttempt[] = (attemptRows ?? [])
    .filter((a: any) => a.quiz)
    .map((a: any) => {
      const quiz = a.quiz as { subject_id: string | null; subject: { name: string } | null };
      return {
        quiz_id: a.quiz_id,
        subject_id: quiz.subject_id ?? '',
        subject_name: quiz.subject?.name ?? '',
        score: Number(a.score),
        max_score: Number(a.max_score),
      };
    });

  return { gradesFromGradebook, homeworkCompletions, quizAttempts };
}
