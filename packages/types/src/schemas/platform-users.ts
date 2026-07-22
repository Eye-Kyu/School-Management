import { z } from 'zod';
import { PhoneNumber } from './common';
import { PlatformPermission } from './auth';

// =============================================================================
// Platform users - cross-tenant user search/management for support ops, plus
// SUPER_ADMIN account administration. Before this, there was no way to create
// a SUPER_ADMIN or edit anyone's platform_permissions except raw service-role
// DB access.
// =============================================================================

export const UpdateUserStatusInput = z.object({
  isActive: z.boolean(),
});
export type UpdateUserStatusInput = z.infer<typeof UpdateUserStatusInput>;

// "Must have email or phone" is validated in the service layer, matching the
// established convention (see OnboardSchoolInput's admin object).
export const CreateSuperAdminInput = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email().optional(),
  phone: PhoneNumber.optional(),
});
export type CreateSuperAdminInput = z.infer<typeof CreateSuperAdminInput>;

export const UpdateSuperAdminPermissionsInput = z.object({
  permissions: z.array(PlatformPermission),
});
export type UpdateSuperAdminPermissionsInput = z.infer<typeof UpdateSuperAdminPermissionsInput>;
