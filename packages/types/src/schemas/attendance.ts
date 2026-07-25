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

// A teacher's request to change already-submitted attendance for a (class,
// date) — approval is single-use and authorizes exactly these proposed edits.
export const RequestRemarkInput = z.object({
  classId: Uuid,
  date: IsoDate,
  reason: z.string().min(20, { message: 'Reason must be at least 20 characters' }).max(1000),
  items: z
    .array(
      z.object({
        studentId: Uuid,
        proposedStatus: AttendanceStatus,
        proposedNote: z.string().max(500).optional(),
      }),
    )
    .min(1, { message: 'At least one proposed change is required' }),
});
export type RequestRemarkInput = z.infer<typeof RequestRemarkInput>;

export const ReviewRemarkRequestInput = z.object({
  action: z.enum(['APPROVE', 'DENY']),
  denialReason: z.string().min(1).max(500).optional(),
});
export type ReviewRemarkRequestInput = z.infer<typeof ReviewRemarkRequestInput>;

// A parent's request that a student be excused for a date range — on
// approval, every day in range is auto-marked EXCUSED (see AttendanceService).
export const SubmitAbsenceRequestInput = z.object({
  studentId: Uuid,
  startDate: IsoDate,
  endDate: IsoDate,
  reason: z.string().min(10, { message: 'Reason must be at least 10 characters' }).max(1000),
});
export type SubmitAbsenceRequestInput = z.infer<typeof SubmitAbsenceRequestInput>;

export const ReviewAbsenceRequestInput = z.object({
  action: z.enum(['APPROVE', 'DENY']),
  denialReason: z.string().min(1).max(500).optional(),
});
export type ReviewAbsenceRequestInput = z.infer<typeof ReviewAbsenceRequestInput>;
