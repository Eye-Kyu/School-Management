import { z } from 'zod';
import { Uuid, PhoneNumber, IsoDate } from './common';
import { UserRole } from './auth';

// =============================================================================
// User creation - admins create teachers, students, parents
// =============================================================================
// One user can have one role. A parent who is also a teacher would need
// two accounts in v0.1 (kept simple deliberately).
// =============================================================================

const BaseUser = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email().optional(),
  phone: PhoneNumber.optional(),
});

export const CreateTeacherInput = BaseUser.extend({
  staffNo: z.string().min(1).max(50),
  department: z.string().max(100).optional(),
  departmentId: Uuid.optional(),
});
export type CreateTeacherInput = z.infer<typeof CreateTeacherInput>;

// NEMIS/KEMIS export fields (Phase 0 sub-sprint 4) — all optional, since none
// of this data has ever been collected before and most existing students
// won't have it until an admin backfills it. See
// docs/audits/nemis-format-verified.md for sourcing (verified: false — no
// official field-by-field spec is publicly discoverable).
const NemisFields = z.object({
  birthCertificateNo: z.string().max(50).optional(),
  upiNumber: z.string().max(20).optional(),
  nationality: z.string().max(100).optional(),
  county: z.string().max(100).optional(),
  subCounty: z.string().max(100).optional(),
  specialNeedsNotes: z.string().max(500).optional(),
});

export const CreateStudentInput = BaseUser.extend({
  admissionNo: z.string().min(1).max(50),
  dateOfBirth: IsoDate.optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  classId: Uuid.optional(),
}).merge(NemisFields);
export type CreateStudentInput = z.infer<typeof CreateStudentInput>;

export const CreateParentInput = BaseUser.extend({
  // A parent is linked to one or more students at creation time.
  childAdmissionNos: z.array(z.string().min(1)).min(1, {
    message: 'A parent must be linked to at least one student',
  }),
  relationship: z.enum(['MOTHER', 'FATHER', 'GUARDIAN', 'OTHER']).default('GUARDIAN'),
});
export type CreateParentInput = z.infer<typeof CreateParentInput>;

// Admin bulk-promotes all active students from one class to another (or graduates them).
export const PromoteStudentsInput = z.object({
  fromClassId: Uuid,
  toClassId: Uuid.optional(),
});
export type PromoteStudentsInput = z.infer<typeof PromoteStudentsInput>;

// Used by users updating their own profile (name + phone only).
export const UpdateProfileInput = z.object({
  fullName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

// Used by the admin's "edit user" form (students only, in practice — see
// UpdateTeacherInput below for the teacher equivalent). Most fields optional.
export const UpdateUserInput = z.object({
  fullName: z.string().min(2).max(200).optional(),
  email: z.string().email().optional(),
  phone: PhoneNumber.optional(),
  isActive: z.boolean().optional(),
}).merge(NemisFields);
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

// Used by admin when updating a teacher (includes teacher-row fields like department).
export const UpdateTeacherInput = z.object({
  fullName: z.string().min(2).max(200).optional(),
  email: z.string().email().optional(),
  phone: PhoneNumber.optional(),
  isActive: z.boolean().optional(),
  department: z.string().max(100).optional(),
  departmentId: Uuid.nullable().optional(),
});
export type UpdateTeacherInput = z.infer<typeof UpdateTeacherInput>;

// Notification preferences update — one row per notification type. smsEnabled
// is optional so existing callers that only ever sent emailEnabled keep working.
export const UpdateNotificationPreferencesInput = z.object({
  prefs: z.array(z.object({
    type: z.string().min(1),
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean().optional(),
  })),
});
export type UpdateNotificationPreferencesInput = z.infer<typeof UpdateNotificationPreferencesInput>;

// CSV bulk-import - one row at a time, server validates each.
export const StudentCsvRow = z.object({
  admissionNo: z.string().min(1),
  fullName: z.string().min(2),
  className: z.string().min(1),
  dateOfBirth: IsoDate.optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  guardianFullName: z.string().optional(),
  guardianPhone: PhoneNumber.optional(),
  guardianEmail: z.string().email().optional(),
});
export type StudentCsvRow = z.infer<typeof StudentCsvRow>;

// Re-export so users of this package don't have to import from auth.
export { UserRole };
