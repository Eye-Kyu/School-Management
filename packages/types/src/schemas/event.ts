import { z } from 'zod';

export const CreateEventInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  allDay: z.boolean().default(false),
  eventType: z.enum(['GENERAL', 'EXAM', 'HOLIDAY', 'PTA', 'SPORTS']).default('GENERAL'),
  audience: z.enum(['SCHOOL_WIDE', 'GRADE', 'CLASS']).default('SCHOOL_WIDE'),
  targetGradeLevel: z.number().int().min(1).max(13).optional(),
  targetClassId: z.string().uuid().optional(),
});
export type CreateEventInput = z.infer<typeof CreateEventInput>;

export const UpdateEventInput = CreateEventInput.partial();
export type UpdateEventInput = z.infer<typeof UpdateEventInput>;
