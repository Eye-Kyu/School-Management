import { z } from 'zod';

export const CreateHomeworkInput = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});
export type CreateHomeworkInput = z.infer<typeof CreateHomeworkInput>;

// score <= the homework's own max_score is dynamic (depends on which
// homework this grades) and is checked in HomeworkService.gradeSubmission(),
// not here — this schema only enforces the static "must be positive" rule.
export const GradeHomeworkInput = z.object({
  score: z.number().positive(),
  graderNote: z.string().max(1000).optional(),
});
export type GradeHomeworkInput = z.infer<typeof GradeHomeworkInput>;
