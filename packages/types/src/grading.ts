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
