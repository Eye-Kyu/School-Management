import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AttendanceRateInput,
  StudentTermAverageInput,
  GradeRow,
  HomeworkCompletion,
  QuizAttempt,
} from '@school-manager/types';

// =============================================================================
// Per-app data fetchers for the shared calculators in
// packages/types/src/attendance-rate.ts and packages/types/src/grading.ts.
// =============================================================================
// Plain exported functions, not NestJS providers — matches the established
// precedent for this exact shape (message-read-cascade.ts, feed-cache.ts):
// callers pick whichever client(s) fit their own trust boundary rather than
// this module owning DI-managed client selection.
// =============================================================================

/**
 * Fetches raw attendance_records + the approved-absence overlay for a set of
 * students over a date range, shaped for calculateAttendanceRate(). Returns
 * the *unfiltered union* across every id in `studentIds` — callers that need
 * a per-class or per-student breakdown (e.g. admin/analytics' per-class
 * table, teacher/analytics' per-student at-risk list) filter both returned
 * arrays by student_id/date themselves before calling
 * calculateAttendanceRate() per grouping, the same way those pages already
 * filter one shared `attRecords` fetch in-memory today.
 *
 * `client` (caller's own RLS scope) is used for the `attendance_records`
 * read — its SELECT policy already permits every relevant caller.
 * `adminClient` is always used for the `absence_requests` overlay read,
 * mirroring AttendanceService._approvedAbsenceStudentIds()'s own reasoning:
 * absence_requests' SELECT policy doesn't grant every subject teacher (or a
 * student/non-submitting-guardian) read access, so a caller-scoped client
 * would silently under-report approved absences instead of erroring.
 */
export async function fetchAttendanceRateInputs(
  client: SupabaseClient,
  adminClient: SupabaseClient,
  params: { studentIds: string[]; startDate: string; endDate: string },
): Promise<AttendanceRateInput> {
  if (params.studentIds.length === 0) {
    return { records: [], approvedAbsences: [] };
  }

  const [{ data: records, error: recordsError }, { data: requests, error: overlayError }] = await Promise.all([
    client
      .from('attendance_records')
      .select('student_id, date, status')
      .in('student_id', params.studentIds)
      .gte('date', params.startDate)
      .lte('date', params.endDate),
    adminClient
      .from('absence_requests')
      .select('student_id, start_date, end_date')
      .in('student_id', params.studentIds)
      .eq('status', 'APPROVED')
      .lte('start_date', params.endDate)
      .gte('end_date', params.startDate),
  ]);
  if (recordsError) throw new Error(recordsError.message);
  if (overlayError) throw new Error(overlayError.message);

  // absence_requests stores date ranges; calculateAttendanceRate() expects
  // one overlay entry per day, clipped to the requested window (mirrors
  // AttendanceService.getApprovedAbsencesForStudent()'s own expansion).
  const approvedAbsences: AttendanceRateInput['approvedAbsences'] = [];
  for (const r of requests ?? []) {
    const rangeStart = r.start_date > params.startDate ? r.start_date : params.startDate;
    const rangeEnd = r.end_date < params.endDate ? r.end_date : params.endDate;
    let cursor = new Date(`${rangeStart}T00:00:00Z`);
    const endDate = new Date(`${rangeEnd}T00:00:00Z`);
    while (cursor <= endDate) {
      approvedAbsences.push({ student_id: r.student_id, absence_date: cursor.toISOString().slice(0, 10) });
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
  }

  return {
    records: (records ?? []).map((r) => ({ student_id: r.student_id, date: r.date, status: r.status })),
    approvedAbsences,
  };
}

/**
 * Fetches and reconciles the three sources calculateStudentTermAverage()
 * unions for one student: `grades` (direct assessments plus already-linked
 * homework/quizzes), plus any homework_completions/quiz_attempts that were
 * never opted into gradebook linking. No apps/api caller uses this within
 * this PR's own scope (all 3 known term-average call sites are apps/web
 * server components) — it exists to satisfy the pure/fetcher split
 * consistently for both calculators, and is Student 360's (B1-4a) first
 * intended consumer.
 */
export async function fetchStudentTermAverageInputs(
  client: SupabaseClient,
  params: { studentId: string; termId?: string },
): Promise<StudentTermAverageInput> {
  // source_type/source_id live on `assessments`, not `grades` (confirmed
  // live — grades has never had those columns, only assessments does, per
  // 20260728000081_assessments_source_link.sql) — selected off the joined
  // `assessment` embed below, not off the top-level grades row.
  let gradesQuery = client
    .from('grades')
    .select(
      'score, assessment:assessments!inner(id, subject_id, max_marks, term_id, source_type, source_id, subject:subjects!inner(name))',
    )
    .eq('student_id', params.studentId);
  if (params.termId) gradesQuery = gradesQuery.eq('assessment.term_id', params.termId);
  const { data: gradeRows, error: gradesError } = await gradesQuery;
  if (gradesError) throw new Error(gradesError.message);

  const gradesFromGradebook: GradeRow[] = (gradeRows ?? [])
    .filter((g) => g.score != null && g.assessment)
    .map((g) => {
      const assessment = g.assessment as unknown as {
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

  const { data: completionRows, error: completionsError } = await client
    .from('homework_completions')
    .select('homework_id, score, homework:homework_assignments!inner(subject_id, max_score, subject:subjects(name))')
    .eq('student_id', params.studentId)
    .not('score', 'is', null);
  if (completionsError) throw new Error(completionsError.message);

  const homeworkCompletions: HomeworkCompletion[] = (completionRows ?? [])
    .filter((c) => c.homework && (c.homework as unknown as { max_score: number | null }).max_score != null)
    .map((c) => {
      const homework = c.homework as unknown as { subject_id: string | null; max_score: number; subject: { name: string } | null };
      return {
        homework_id: c.homework_id,
        subject_id: homework.subject_id ?? '',
        subject_name: homework.subject?.name ?? '',
        score: Number(c.score),
        max_score: homework.max_score,
      };
    });

  const { data: attemptRows, error: attemptsError } = await client
    .from('quiz_attempts')
    .select('quiz_id, score, max_score, quiz:quizzes!inner(subject_id, subject:subjects(name))')
    .eq('student_id', params.studentId)
    .not('score', 'is', null)
    .not('max_score', 'is', null);
  if (attemptsError) throw new Error(attemptsError.message);

  const quizAttempts: QuizAttempt[] = (attemptRows ?? [])
    .filter((a) => a.quiz)
    .map((a) => {
      const quiz = a.quiz as unknown as { subject_id: string | null; subject: { name: string } | null };
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
