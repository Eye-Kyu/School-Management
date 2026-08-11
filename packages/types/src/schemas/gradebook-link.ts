import { z } from 'zod';
import { Uuid } from './common';

// Shared by both homework and quiz "count toward term grade" linking
// endpoints (Bucket 1, PR 2b) — same fields either way: the assessment this
// homework/quiz should project its score onto.
export const LinkToGradebookInput = z.object({
  name: z.string().min(1).max(100),
  subjectId: Uuid,
  classId: Uuid,
  termId: Uuid,
  maxMarks: z.number().int().positive().max(1000),
  // Set on a re-submission after the caller has seen a preview response
  // (retroactive rollup and/or a max-marks-change recompute) and confirmed
  // it. Omitted/false on the first attempt.
  confirmed: z.boolean().optional(),
});
export type LinkToGradebookInput = z.infer<typeof LinkToGradebookInput>;
