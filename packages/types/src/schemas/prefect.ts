import { z } from 'zod';
import { Uuid } from './common';

// =============================================================================
// Prefects — Class Prefects, School Prefects, admin-toggleable powers,
// and prefect-submitted behavior incident reports.
// =============================================================================

export const PrefectPowerCode = z.enum([
  'view_class_behavior_leaderboard',
  'compose_message_to_class_teacher',
  'report_behavior_incident',
  'view_class_attendance_summary',
  'view_class_timetable_detailed',
  'view_school_behavior_leaderboard_full',
  'compose_message_to_admin',
  'report_behavior_incident_school_wide',
]);
export type PrefectPowerCode = z.infer<typeof PrefectPowerCode>;

export const AssignClassPrefectInput = z.object({
  classId: Uuid,
  studentId: Uuid,
  termId: Uuid.nullable(),
});
export type AssignClassPrefectInput = z.infer<typeof AssignClassPrefectInput>;

export const RevokePrefectInput = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type RevokePrefectInput = z.infer<typeof RevokePrefectInput>;

export const AssignSchoolPrefectInput = z.object({
  studentId: Uuid,
  roleTitle: z.string().min(1).max(100),
  termId: Uuid.nullable(),
});
export type AssignSchoolPrefectInput = z.infer<typeof AssignSchoolPrefectInput>;

export const SetPrefectPowerInput = z.object({
  powerCode: PrefectPowerCode,
  enabled: z.boolean(),
});
export type SetPrefectPowerInput = z.infer<typeof SetPrefectPowerInput>;

// Reuses behaviour_points.reason_category's existing enum values.
export const BehaviorIncidentCategory = z.enum(['academic', 'attendance', 'citizenship', 'leadership', 'other']);
export type BehaviorIncidentCategory = z.infer<typeof BehaviorIncidentCategory>;

export const SubmitBehaviorIncidentInput = z.object({
  studentId: Uuid,
  category: BehaviorIncidentCategory,
  description: z.string().min(20, { message: 'Description must be at least 20 characters' }).max(2000),
});
export type SubmitBehaviorIncidentInput = z.infer<typeof SubmitBehaviorIncidentInput>;

export const ReviewBehaviorIncidentInput = z.object({
  action: z.enum(['DISMISS', 'MARK_REVIEWED']),
  classTeacherNotes: z.string().max(1000).optional(),
  // Present only when the Class Teacher chooses to convert the report into a
  // behaviour_points entry — never automatic.
  convertToPoints: z
    .object({
      category: z.enum(['POSITIVE', 'NEGATIVE']),
      points: z.number().int().min(1).max(10),
      reason: z.string().min(1).max(500),
    })
    .optional(),
});
export type ReviewBehaviorIncidentInput = z.infer<typeof ReviewBehaviorIncidentInput>;

// One-way — delivered as a notification to the recipient, never a
// conversations/messages thread. See migration comments on the `conversations`
// table trigger for why students never become messaging participants.
export const SendPrefectMessageInput = z.object({
  body: z.string().min(1).max(1000),
});
export type SendPrefectMessageInput = z.infer<typeof SendPrefectMessageInput>;
