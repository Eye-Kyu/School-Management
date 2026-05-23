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
});
export type CreateTeacherInput = z.infer<typeof CreateTeacherInput>;

export const CreateStudentInput = BaseUser.extend({
  admissionNo: z.string().min(1).max(50),
  dateOfBirth: IsoDate.optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  classId: Uuid.optional(),
});
export type CreateStudentInput = z.infer<typeof CreateStudentInput>;

export const CreateParentInput = BaseUser.extend({
  // A parent is linked to one or more students at creation time.
  childAdmissionNos: z.array(z.string().min(1)).min(1, {
    message: 'A parent must be linked to at least one student',
  }),
  relationship: z.enum(['MOTHER', 'FATHER', 'GUARDIAN', 'OTHER']).default('GUARDIAN'),
});
export type CreateParentInput = z.infer<typeof CreateParentInput>;

// Used by the admin's "edit user" form. Most fields optional.
export const UpdateUserInput = z.object({
  fullName: z.string().min(2).max(200).optional(),
  email: z.string().email().optional(),
  phone: PhoneNumber.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

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
