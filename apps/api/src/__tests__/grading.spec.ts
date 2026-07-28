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

import { calculateSubjectAverage, assignLetterGrade } from '@school-manager/types';

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
