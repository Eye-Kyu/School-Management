// =============================================================================
// Shared grading math
// =============================================================================
// Single source of truth for turning a student's raw assessment scores into
// a subject average and a letter grade. Both report-card renderers
// (apps/web/app/report-card/[studentId]/page.tsx and
// apps/web/app/print/report-card/[studentId]/page.tsx) previously computed
// this independently and disagreed — different formula AND different letter
// boundaries for the same student's same grades. Confirmed with the project
// owner, 2026-07-28: unweighted mean of each assessment's own percentage
// (not a total-marks-earned/total-marks-possible ratio), boundaries
// A>=80/B>=70/C>=60/D>=50/else E — already what most of the app's other
// independent grade-averaging call sites (student grades/analytics, teacher
// analytics/gradebook, the AI report-card-comment endpoint) use.
// =============================================================================

export type ScoredAssessment = { score: number; maxMarks: number };

/**
 * Unweighted mean of each assessment's own percentage — a 10-mark quiz and
 * a 100-mark exam count equally. This is a deliberate, confirmed choice,
 * not an oversight; a marks-earned/marks-possible ratio was considered and
 * rejected. Rows with a non-positive maxMarks are dropped (bad data, not a
 * valid zero-weight assessment) rather than allowed to produce NaN/Infinity.
 */
export function calculateSubjectAverage(scores: ScoredAssessment[]): number | null {
  const valid = scores.filter((s) => s.maxMarks > 0);
  if (valid.length === 0) return null;
  const pctSum = valid.reduce((sum, s) => sum + (s.score / s.maxMarks) * 100, 0);
  return pctSum / valid.length;
}

/** Boundaries are inclusive on the lower bound (>=). */
export function assignLetterGrade(pct: number): 'A' | 'B' | 'C' | 'D' | 'E' {
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'E';
}

/**
 * Bucket 1, PR 2b — projects a homework/quiz score onto a linked
 * assessment's own mark scale: (sourceScore / sourceMaxScore) * assessmentMaxMarks,
 * rounded to 2 decimal places. sourceScore === 0 is a valid result (the
 * numerator being zero, not a division), not an error. sourceMaxScore/
 * assessmentMaxMarks must both be positive — callers should already have a
 * DB-level guarantee of this (homework_assignments.max_score's CHECK,
 * assessments.max_marks' CHECK per BUG-9) but this function doesn't trust
 * that blindly, since it's also called from paths where the source's own
 * validity was set up in a different transaction.
 */
export function normalizeScore(sourceScore: number, sourceMaxScore: number, assessmentMaxMarks: number): number {
  if (!(sourceMaxScore > 0)) {
    throw new Error(`Cannot normalize a score against a non-positive source max score (${sourceMaxScore})`);
  }
  if (!(assessmentMaxMarks > 0)) {
    throw new Error(`Cannot normalize a score against a non-positive assessment max marks (${assessmentMaxMarks})`);
  }
  const raw = (sourceScore / sourceMaxScore) * assessmentMaxMarks;
  return Math.round(raw * 100) / 100;
}

// =============================================================================
// Per-student term average — replaces 3+ independent inline
// reimplementations (2 report-card renderers + GradebookClient.tsx's own
// studentAvg(), see docs/audits/shared-helpers-call-sites.md §1.2), none of
// which reconciled unlinked homework/quiz scores against `grades` — all 3
// read `grades` alone.
// =============================================================================

export interface GradeRow {
  assessment_id: string;
  subject_id: string;
  subject_name: string;
  score: number;
  max_marks: number;
  /** Present when this assessment is a B1-2b gradebook link, not a direct entry. */
  source_type?: 'DIRECT' | 'HOMEWORK' | 'QUIZ';
  /** homework_assignments.id or quizzes.id (NOT a homework_completions/quiz_attempts row's own id) when source_type != 'DIRECT'. */
  source_id?: string | null;
}

export interface HomeworkCompletion {
  /** = homework_assignments.id — matched against a GradeRow's source_id for dedup. */
  homework_id: string;
  subject_id: string;
  subject_name: string;
  score: number;
  max_score: number;
}

export interface QuizAttempt {
  /** = quizzes.id — matched against a GradeRow's source_id for dedup. */
  quiz_id: string;
  subject_id: string;
  subject_name: string;
  score: number;
  max_score: number;
}

export interface StudentTermAverageInput {
  gradesFromGradebook: GradeRow[];
  homeworkCompletions: HomeworkCompletion[];
  quizAttempts: QuizAttempt[];
}

export interface StudentTermAverageResult {
  overall_average_percentage: number | null;
  assessment_count: number;
  by_subject: Array<{
    subject_id: string;
    subject_name: string;
    average_percentage: number;
    assessment_count: number;
  }>;
}

/**
 * Unions three sources into one per-student term average: `grades` (direct
 * assessments plus already-linked homework/quizzes), plus any
 * `homework_completions`/`quiz_attempts` that were never opted into gradebook
 * linking (B1-2b's `linkToGradebook` is explicit opt-in, not automatic — see
 * docs/audits/student-360-data-sources.md §1.3). A linked homework/quiz is
 * counted exactly once, via its `grades` row — `source_id` on that row
 * points at `homework_assignments.id`/`quizzes.id`, not at the
 * completion/attempt row's own id, so dedup matches on that FK, not a
 * literal id-to-id comparison. Overall average is the mean across every
 * post-dedup assessment's own percentage (equally weighted per assessment,
 * not per subject) — a student with 8 assessments in one subject and 2 in
 * another isn't diluted by averaging two already-averaged subject figures.
 */
export function calculateStudentTermAverage(input: StudentTermAverageInput): StudentTermAverageResult {
  type Scored = { subject_id: string; subject_name: string; score: number; maxMarks: number };
  const scored: Scored[] = [];

  for (const g of input.gradesFromGradebook) {
    if (!(g.max_marks > 0)) {
      // eslint-disable-next-line no-console
      console.warn(`calculateStudentTermAverage: skipping assessment ${g.assessment_id} with non-positive max_marks`);
      continue;
    }
    scored.push({ subject_id: g.subject_id, subject_name: g.subject_name, score: g.score, maxMarks: g.max_marks });
  }

  const linkedHomeworkIds = new Set(
    input.gradesFromGradebook.filter((g) => g.source_type === 'HOMEWORK' && g.source_id).map((g) => g.source_id as string),
  );
  const linkedQuizIds = new Set(
    input.gradesFromGradebook.filter((g) => g.source_type === 'QUIZ' && g.source_id).map((g) => g.source_id as string),
  );

  for (const h of input.homeworkCompletions) {
    if (linkedHomeworkIds.has(h.homework_id)) continue;
    if (!(h.max_score > 0)) {
      // eslint-disable-next-line no-console
      console.warn(`calculateStudentTermAverage: skipping homework ${h.homework_id} with non-positive max_score`);
      continue;
    }
    scored.push({ subject_id: h.subject_id, subject_name: h.subject_name, score: h.score, maxMarks: h.max_score });
  }

  for (const q of input.quizAttempts) {
    if (linkedQuizIds.has(q.quiz_id)) continue;
    if (!(q.max_score > 0)) {
      // eslint-disable-next-line no-console
      console.warn(`calculateStudentTermAverage: skipping quiz ${q.quiz_id} with non-positive max_score`);
      continue;
    }
    scored.push({ subject_id: q.subject_id, subject_name: q.subject_name, score: q.score, maxMarks: q.max_score });
  }

  if (scored.length === 0) {
    return { overall_average_percentage: null, assessment_count: 0, by_subject: [] };
  }

  const percentages = scored.map((s) => (s.score / s.maxMarks) * 100);
  const overall = percentages.reduce((sum, p) => sum + p, 0) / percentages.length;

  const bySubjectMap = new Map<string, { subject_name: string; scores: ScoredAssessment[] }>();
  for (const s of scored) {
    let entry = bySubjectMap.get(s.subject_id);
    if (!entry) {
      entry = { subject_name: s.subject_name, scores: [] };
      bySubjectMap.set(s.subject_id, entry);
    }
    entry.scores.push({ score: s.score, maxMarks: s.maxMarks });
  }

  const by_subject = Array.from(bySubjectMap.entries()).map(([subject_id, entry]) => ({
    subject_id,
    subject_name: entry.subject_name,
    // Never null here — every row already passed the maxMarks > 0 guard above.
    average_percentage: calculateSubjectAverage(entry.scores) as number,
    assessment_count: entry.scores.length,
  }));

  return {
    overall_average_percentage: overall,
    assessment_count: scored.length,
    by_subject,
  };
}
