import { z } from 'zod';
import { Uuid, IsoDate } from './common';

// =============================================================================
// Classes, subjects, terms
// =============================================================================

export const CreateClassInput = z.object({
  name: z.string().min(1).max(100),       // 'Grade 5 Blue'
  gradeLevel: z.coerce.number().int().min(0).max(20),
  stream: z.string().max(50).optional(),  // 'Blue', 'North', 'A'
});
export type CreateClassInput = z.infer<typeof CreateClassInput>;

export const UpdateClassInput = CreateClassInput.partial();
export type UpdateClassInput = z.infer<typeof UpdateClassInput>;

export const CreateSubjectInput = z.object({
  name: z.string().min(1).max(100),
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9_]+$/, {
      message: 'Subject code must be uppercase letters, digits, underscores',
    }),
});
export type CreateSubjectInput = z.infer<typeof CreateSubjectInput>;

export const AssignSubjectInput = z.object({
  classId: Uuid,
  subjectId: Uuid,
  teacherId: Uuid,
});
export type AssignSubjectInput = z.infer<typeof AssignSubjectInput>;

export const CreateTermInput = z
  .object({
    name: z.string().min(1).max(100),       // 'Term 1 2026'
    startDate: IsoDate,
    endDate: IsoDate,
    isCurrent: z.boolean().default(false),
  })
  .refine((d) => d.startDate < d.endDate, {
    message: 'startDate must be before endDate',
    path: ['endDate'],
  });
export type CreateTermInput = z.infer<typeof CreateTermInput>;
