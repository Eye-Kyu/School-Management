import { z } from 'zod';
import { Uuid } from './common';

export const LeaderboardQuery = z.object({
  window: z.enum(['week', 'month', 'term', 'all']),
  scope: z.enum(['school', 'grade', 'class']),
  classId: Uuid.optional(),
  gradeLevel: z.coerce.number().int().min(0).max(20).optional(),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuery>;
