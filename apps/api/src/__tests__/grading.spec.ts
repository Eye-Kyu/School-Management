/**
 * Shared grading math (packages/types/src/grading.ts) — the single source
 * both report-card renderers (apps/web/app/report-card/[studentId]/page.tsx
 * and apps/web/app/print/report-card/[studentId]/page.tsx) now import,
 * replacing two independent implementations that disagreed on both the
 * aggregation formula and the letter-grade boundaries for the same student.
 *
 * A true page-level "render both renderers and diff the output" test isn't
 * achievable in this environment — apps/web's vitest runs with
 * `environment: 'node'` (no jsdom/testing-library) and no Playwright/browser
 * harness exists anywhere in this repo. The real guarantee that the two
 * renderers can no longer diverge is structural: both import and call these
 * exact functions rather than reimplementing the math locally. What's
 * actually testable — and where the real risk lives — is this module's own
 * correctness, including the concrete "Amina" example from the sub-sprint 4
 * planning research that originally proved the two renderers disagreed
 * (Renderer A said 61%/Grade B, Renderer B said 68.3%/Grade C for the same
 * three grades) — locking in that it now has exactly one answer.
 */

import { calculateSubjectAverage, assignLetterGrade, normalizeScore, calculateStudentTermAverage } from '@school-manager/types';

describe('calculateSubjectAverage', () => {
  it('returns null for an empty list (nothing graded yet)', () => {
    expect(calculateSubjectAverage([])).toBeNull();
  });

  it('returns the single score\'s percentage for one assessment', () => {
    expect(calculateSubjectAverage([{ score: 18, maxMarks: 20 }])).toBe(90);
  });

  it('is an unweighted mean of percentages — a 100-mark exam does not outweigh a 20-mark CAT', () => {
    // The "Amina" example: CAT1 18/20 (90%), CAT2 12/20 (60%), Exam 55/100 (55%).
    const avg = calculateSubjectAverage([
      { score: 18, maxMarks: 20 },
      { score: 12, maxMarks: 20 },
      { score: 55, maxMarks: 100 },
    ]);
    expect(avg).toBeCloseTo((90 + 60 + 55) / 3, 5); // 68.33...
    expect(avg).not.toBeCloseTo((18 + 12 + 55) / (20 + 20 + 100) * 100, 5); // NOT the old weighted-total answer (60.7%)
  });

  it('drops rows with non-positive maxMarks as bad data rather than producing NaN/Infinity', () => {
    const avg = calculateSubjectAverage([
      { score: 18, maxMarks: 20 },
      { score: 5, maxMarks: 0 },
    ]);
    expect(avg).toBe(90); // only the valid row counts
  });

  it('returns null if every row has non-positive maxMarks', () => {
    expect(calculateSubjectAverage([{ score: 5, maxMarks: 0 }])).toBeNull();
  });
});

describe('assignLetterGrade', () => {
  it.each([
    [100, 'A'], [80, 'A'],
    [79.9, 'B'], [70, 'B'],
    [69.9, 'C'], [60, 'C'],
    [59.9, 'D'], [50, 'D'],
    [49.9, 'E'], [0, 'E'],
  ])('%d%% -> %s', (pct, letter) => {
    expect(assignLetterGrade(pct)).toBe(letter);
  });

  // Explicit boundary sweep at every integer transition point.
  it.each([39, 40, 41, 49, 50, 59, 60, 69, 70, 79, 80])('boundary at %d%%', (pct) => {
    const letter = assignLetterGrade(pct);
    expect(['A', 'B', 'C', 'D', 'E']).toContain(letter);
  });

  it('the lower bound of each boundary is inclusive (>=), matching the app-wide convention', () => {
    expect(assignLetterGrade(80)).toBe('A');
    expect(assignLetterGrade(79)).toBe('B');
    expect(assignLetterGrade(70)).toBe('B');
    expect(assignLetterGrade(69)).toBe('C');
    expect(assignLetterGrade(60)).toBe('C');
    expect(assignLetterGrade(59)).toBe('D');
    expect(assignLetterGrade(50)).toBe('D');
    expect(assignLetterGrade(49)).toBe('E');
  });
});

describe('normalizeScore (Bucket 1, PR 2b — homework/quiz score onto a linked assessment)', () => {
  it('projects a homework/quiz score onto the assessment scale', () => {
    expect(normalizeScore(8, 10, 100)).toBe(80); // 8/10 -> 80/100
    expect(normalizeScore(3, 5, 20)).toBe(12); // 3/5 -> 12/20
  });

  it('sourceScore = 0 is a valid result (0), not treated as division-by-zero', () => {
    expect(normalizeScore(0, 10, 100)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    expect(normalizeScore(1, 3, 10)).toBe(3.33); // 3.333... -> 3.33
    expect(normalizeScore(2, 3, 10)).toBe(6.67); // 6.666... -> 6.67
  });

  it('handles a small source max score without precision blowing up', () => {
    expect(normalizeScore(1, 1, 100)).toBe(100);
  });

  it('handles large numbers correctly', () => {
    expect(normalizeScore(950, 1000, 500)).toBe(475);
  });

  it('throws for a non-positive source max score (would be a division by zero/negative)', () => {
    expect(() => normalizeScore(5, 0, 100)).toThrow(/source max score/);
    expect(() => normalizeScore(5, -1, 100)).toThrow(/source max score/);
  });

  it('throws for a non-positive assessment max marks', () => {
    expect(() => normalizeScore(5, 10, 0)).toThrow(/assessment max marks/);
    expect(() => normalizeScore(5, 10, -5)).toThrow(/assessment max marks/);
  });

  it('a perfect score normalizes to exactly the assessment max, not a rounding-drifted near-value', () => {
    expect(normalizeScore(10, 10, 37)).toBe(37);
  });
});

describe('calculateStudentTermAverage (Foundation PR — shared helpers)', () => {
  it('returns null/zero for a student with nothing graded yet', () => {
    const result = calculateStudentTermAverage({ gradesFromGradebook: [], homeworkCompletions: [], quizAttempts: [] });
    expect(result).toEqual({ overall_average_percentage: null, assessment_count: 0, by_subject: [] });
  });

  it('overall average is the mean across every post-dedup assessment percentage, not a mean of subject averages', () => {
    // Maths: two assessments (90%, 50%) -> subject avg 70%. English: one assessment (60%).
    // Mean-of-subjects would be (70 + 60) / 2 = 65. Per-assessment mean is (90+50+60)/3 = 66.67.
    const result = calculateStudentTermAverage({
      gradesFromGradebook: [
        { assessment_id: 'a1', subject_id: 'math', subject_name: 'Maths', score: 18, max_marks: 20 }, // 90%
        { assessment_id: 'a2', subject_id: 'math', subject_name: 'Maths', score: 10, max_marks: 20 }, // 50%
        { assessment_id: 'a3', subject_id: 'eng', subject_name: 'English', score: 12, max_marks: 20 }, // 60%
      ],
      homeworkCompletions: [],
      quizAttempts: [],
    });
    expect(result.assessment_count).toBe(3);
    expect(result.overall_average_percentage).toBeCloseTo((90 + 50 + 60) / 3, 5);
    expect(result.overall_average_percentage).not.toBeCloseTo(65, 5);
    const math = result.by_subject.find((s) => s.subject_id === 'math')!;
    expect(math.average_percentage).toBeCloseTo(70, 5);
    expect(math.assessment_count).toBe(2);
  });

  it('dedups an unlinked homework score by homework_id against a grades row\'s source_id, not the completion row\'s own id', () => {
    // The linked grade row's assessment_id/id is unrelated to the homework's
    // own id — dedup must match on source_id === homework_id, not id === id.
    const result = calculateStudentTermAverage({
      gradesFromGradebook: [
        { assessment_id: 'assess-99', subject_id: 'math', subject_name: 'Maths', score: 8, max_marks: 10, source_type: 'HOMEWORK', source_id: 'hw-1' },
      ],
      homeworkCompletions: [
        // Same homework (hw-1), already counted via the grades row above — must NOT be double-counted.
        { homework_id: 'hw-1', subject_id: 'math', subject_name: 'Maths', score: 8, max_score: 10 },
        // A different, never-linked homework — must be counted.
        { homework_id: 'hw-2', subject_id: 'math', subject_name: 'Maths', score: 5, max_score: 10 },
      ],
      quizAttempts: [],
    });
    expect(result.assessment_count).toBe(2); // hw-1 counted once (via grades), hw-2 counted once
    expect(result.overall_average_percentage).toBeCloseTo((80 + 50) / 2, 5);
  });

  it('dedups an unlinked quiz score by quiz_id against a grades row\'s source_id', () => {
    const result = calculateStudentTermAverage({
      gradesFromGradebook: [
        { assessment_id: 'assess-1', subject_id: 'sci', subject_name: 'Science', score: 9, max_marks: 10, source_type: 'QUIZ', source_id: 'quiz-1' },
      ],
      homeworkCompletions: [],
      quizAttempts: [
        { quiz_id: 'quiz-1', subject_id: 'sci', subject_name: 'Science', score: 9, max_score: 10 }, // already linked, skip
        { quiz_id: 'quiz-2', subject_id: 'sci', subject_name: 'Science', score: 4, max_score: 10 }, // unlinked, count
      ],
    });
    expect(result.assessment_count).toBe(2);
  });

  it('skips a grades row with non-positive max_marks (bad data), not NaN/Infinity', () => {
    const result = calculateStudentTermAverage({
      gradesFromGradebook: [
        { assessment_id: 'a1', subject_id: 'math', subject_name: 'Maths', score: 10, max_marks: 20 },
        { assessment_id: 'a2', subject_id: 'math', subject_name: 'Maths', score: 5, max_marks: 0 },
      ],
      homeworkCompletions: [],
      quizAttempts: [],
    });
    expect(result.assessment_count).toBe(1);
    expect(Number.isFinite(result.overall_average_percentage)).toBe(true);
  });

  it('skips unlinked homework/quiz rows with non-positive max_score', () => {
    const result = calculateStudentTermAverage({
      gradesFromGradebook: [],
      homeworkCompletions: [{ homework_id: 'hw-1', subject_id: 'math', subject_name: 'Maths', score: 5, max_score: 0 }],
      quizAttempts: [{ quiz_id: 'q-1', subject_id: 'math', subject_name: 'Maths', score: 5, max_score: 0 }],
    });
    expect(result.assessment_count).toBe(0);
    expect(result.overall_average_percentage).toBeNull();
  });
});

describe('the two report-card renderers now agree (regression for the original bug)', () => {
  it('the "Amina" scenario resolves to exactly one score/grade, not two different ones', () => {
    const scores = [
      { score: 18, maxMarks: 20 },
      { score: 12, maxMarks: 20 },
      { score: 55, maxMarks: 100 },
    ];
    const avg = calculateSubjectAverage(scores)!;
    const grade = assignLetterGrade(avg);

    // Before this fix: Renderer A (weighted total/total, 75/60/50/40
    // boundaries) said 61%/B. Renderer B (unweighted mean, 80/70/60/50
    // boundaries) said 68.3%/C. Both renderers now call this exact function,
    // so there is only one possible answer for either of them to show.
    expect(Math.round(avg)).toBe(68);
    expect(grade).toBe('C');
  });
});
