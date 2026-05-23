import { z } from 'zod';
import { Uuid, IsoDate } from './common';

// =============================================================================
// Attendance
// =============================================================================

export const AttendanceStatus = z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

// Teacher marks a whole class at once - one row per student.
export const MarkAttendanceInput = z.object({
  classId: Uuid,
  date: IsoDate,
  records: z
    .array(
      z.object({
        studentId: Uuid,
        status: AttendanceStatus,
        note: z.string().max(500).optional(),
      }),
    )
    .min(1, { message: 'At least one student record is required' }),
});
export type MarkAttendanceInput = z.infer<typeof MarkAttendanceInput>;

// Used to filter the per-student attendance history view.
export const AttendanceQuery = z.object({
  studentId: Uuid.optional(),
  classId: Uuid.optional(),
  startDate: IsoDate.optional(),
  endDate: IsoDate.optional(),
});
export type AttendanceQuery = z.infer<typeof AttendanceQuery>;

// Fetches the student roster for a class on a given date, with existing statuses.
export const AttendanceRosterQuery = z.object({
  classId: Uuid,
  date: IsoDate,
});
export type AttendanceRosterQuery = z.infer<typeof AttendanceRosterQuery>;
