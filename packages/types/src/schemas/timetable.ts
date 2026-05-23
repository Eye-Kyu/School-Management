import { z } from 'zod';
import { Uuid, TimeOfDay } from './common';

// =============================================================================
// Timetable
// =============================================================================

export const DayOfWeek = z.enum([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);
export type DayOfWeek = z.infer<typeof DayOfWeek>;

export const CreateTimetableSlotInput = z
  .object({
    classId: Uuid,
    subjectId: Uuid,
    teacherId: Uuid,
    dayOfWeek: DayOfWeek,
    startTime: TimeOfDay,
    endTime: TimeOfDay,
    room: z.string().max(50).optional(),
  })
  .refine((d) => d.startTime < d.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  });
export type CreateTimetableSlotInput = z.infer<typeof CreateTimetableSlotInput>;

export const UpdateTimetableSlotInput = CreateTimetableSlotInput.innerType().partial();
export type UpdateTimetableSlotInput = z.infer<typeof UpdateTimetableSlotInput>;
