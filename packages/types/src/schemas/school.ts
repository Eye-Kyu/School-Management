import { z } from 'zod';
import { PhoneNumber } from './common';

// =============================================================================
// School schemas
// =============================================================================
// The school is the tenant. Only the platform admin creates schools;
// school admins update their own school's profile.
// =============================================================================

export const CreateSchoolInput = z.object({
  name: z.string().min(2).max(200),
  // slug is used as subdomain - lowercase letters, digits, hyphens
  slug: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
      message: 'Slug must be lowercase letters, digits, and hyphens',
    }),
  phone: PhoneNumber.optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  timezone: z.string().default('Africa/Nairobi'),
});
export type CreateSchoolInput = z.infer<typeof CreateSchoolInput>;

export const UpdateSchoolInput = CreateSchoolInput.partial().omit({ slug: true });
export type UpdateSchoolInput = z.infer<typeof UpdateSchoolInput>;

export const SchoolStatus = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']);
export type SchoolStatus = z.infer<typeof SchoolStatus>;

export const UpdateSchoolStatusInput = z.object({
  status: SchoolStatus,
  reason: z.string().max(500).optional(),
});
export type UpdateSchoolStatusInput = z.infer<typeof UpdateSchoolStatusInput>;

// =============================================================================
// School onboarding (reduced scope — no package/curriculum steps yet)
// =============================================================================
// "Must have email or phone" is validated in the service layer, not here,
// matching the established convention for creating a person (see
// teachers.service.ts's CreateTeacherInput usage).
export const OnboardSchoolInput = z.object({
  school: CreateSchoolInput,
  admin: z.object({
    fullName: z.string().min(2).max(200),
    email: z.string().email().optional(),
    phone: PhoneNumber.optional(),
  }),
  disabledModuleKeys: z.array(z.string()).default([]),
});
export type OnboardSchoolInput = z.infer<typeof OnboardSchoolInput>;
