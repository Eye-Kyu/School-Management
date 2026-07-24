import { z } from 'zod';
import { PhoneNumber } from './common';

// =============================================================================
// User roles - the four tenant-scoped personas, plus the platform-level
// SUPER_ADMIN (no home school; never accepted as client input on any
// create/update-user endpoint — assignment stays a backend/manual operation).
// =============================================================================
export const UserRole = z.enum(['ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'SUPER_ADMIN']);
export type UserRole = z.infer<typeof UserRole>;

// =============================================================================
// Login inputs
// =============================================================================
export const EmailLoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
});
export type EmailLoginInput = z.infer<typeof EmailLoginInput>;

export const PhoneOtpRequestInput = z.object({
  phone: PhoneNumber,
});
export type PhoneOtpRequestInput = z.infer<typeof PhoneOtpRequestInput>;

export const PhoneOtpVerifyInput = z.object({
  phone: PhoneNumber,
  otp: z.string().regex(/^\d{6}$/, { message: 'OTP must be 6 digits' }),
});
export type PhoneOtpVerifyInput = z.infer<typeof PhoneOtpVerifyInput>;

// =============================================================================
// Password reset
// =============================================================================
export const PasswordResetRequestInput = z.object({
  email: z.string().email(),
});
export type PasswordResetRequestInput = z.infer<typeof PasswordResetRequestInput>;

export const PasswordResetConfirmInput = z
  .object({
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
  });
export type PasswordResetConfirmInput = z.infer<typeof PasswordResetConfirmInput>;

// =============================================================================
// Platform permissions - granular capabilities within the SUPER_ADMIN role.
// Additive on top of UserRole so capabilities can later be split across
// multiple platform-level roles (PLATFORM_SUPPORT, PLATFORM_FINANCE, etc.)
// without a schema change. See docs on the SuperAdmin control plane refactor.
// =============================================================================
export const PlatformPermission = z.enum([
  'VIEW_SCHOOLS',
  'MANAGE_SCHOOLS',
  'VIEW_MODULES',
  'MANAGE_MODULES',
  'VIEW_PACKAGES',
  'MANAGE_PACKAGES',
  'VIEW_CURRICULUM',
  'MANAGE_CURRICULUM',
  'VIEW_PLATFORM_USERS',
  'MANAGE_PLATFORM_USERS',
  'VIEW_BILLING',
  'MANAGE_BILLING',
  'VIEW_PLATFORM_ANALYTICS',
  'VIEW_AUDIT_LOGS',
  'GRANT_PRIVILEGED_ACCESS',
  'VIEW_SYSTEM_HEALTH',
  'MANAGE_PLATFORM_SETTINGS',
  'SEND_PLATFORM_MESSAGES',
]);
export type PlatformPermission = z.infer<typeof PlatformPermission>;

// =============================================================================
// Authenticated user payload (returned by /me)
// =============================================================================
export const AuthenticatedUser = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  fullName: z.string(),
  role: UserRole,
  enabledModules: z.array(z.string()),
  platformPermissions: z.array(PlatformPermission),
});
export type AuthenticatedUser = z.infer<typeof AuthenticatedUser>;
