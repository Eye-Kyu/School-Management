import { z } from 'zod';
import { Uuid } from './common';

// =============================================================================
// Announcements - text-only in v0.1, distribution via email/SMS/WhatsApp in v0.2
// =============================================================================

export const AnnouncementAudience = z.enum(['SCHOOL_WIDE', 'TEACHERS', 'PARENTS', 'GRADE', 'CLASS']);
export type AnnouncementAudience = z.infer<typeof AnnouncementAudience>;

export const CreateAnnouncementInput = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(10_000),
    audience: AnnouncementAudience,
    // Required only when audience matches
    targetGradeLevel: z.coerce.number().int().min(0).max(20).optional(),
    targetClassId: Uuid.optional(),
  })
  .refine(
    (d) => d.audience !== 'GRADE' || d.targetGradeLevel !== undefined,
    { message: 'targetGradeLevel is required when audience is GRADE', path: ['targetGradeLevel'] },
  )
  .refine(
    (d) => d.audience !== 'CLASS' || d.targetClassId !== undefined,
    { message: 'targetClassId is required when audience is CLASS', path: ['targetClassId'] },
  );
export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementInput>;
