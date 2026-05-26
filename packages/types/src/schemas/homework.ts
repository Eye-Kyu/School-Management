import { z } from 'zod';

export const CreateHomeworkInput = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});
export type CreateHomeworkInput = z.infer<typeof CreateHomeworkInput>;
