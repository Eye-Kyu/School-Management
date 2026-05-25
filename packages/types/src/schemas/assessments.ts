import { z } from 'zod';
import { Uuid, IsoDate } from './common';

export const CreateAssessmentInput = z.object({
  termId: Uuid,
  classId: Uuid,
  subjectId: Uuid,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  maxMarks: z.number().int().positive().max(1000),
  assessmentDate: IsoDate.optional(),
});
export type CreateAssessmentInput = z.infer<typeof CreateAssessmentInput>;

export const UpsertScoresInput = z.object({
  scores: z.array(z.object({
    studentId: Uuid,
    marksObtained: z.number().min(0).nullable(),
    comments: z.string().max(300).optional(),
  })),
});
export type UpsertScoresInput = z.infer<typeof UpsertScoresInput>;
