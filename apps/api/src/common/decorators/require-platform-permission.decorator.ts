// =============================================================================
// @RequirePlatformPermission(key) - gate a /super-admin route behind a
// granular platform permission
// =============================================================================
// Usage:
//   @UseGuards(AuthGuard, SuperAdminGuard, PlatformPermissionGuard)
//   @RequirePlatformPermission('MANAGE_MODULES')
//   @Patch('schools/:id/modules/:key')
//   handler() { ... }
//
// Distinct from SuperAdminGuard: that checks WHO the caller is (a platform
// account at all); this checks WHAT they're specifically permitted to do.
// Every existing SUPER_ADMIN account has every permission (see
// supabase/migrations/20260722000028_platform_permissions.sql), so this is
// additive - it changes nothing for today's accounts, but lets future
// platform roles (PLATFORM_SUPPORT, PLATFORM_FINANCE, etc.) hold a subset.
// =============================================================================

import { SetMetadata } from '@nestjs/common';
import type { PlatformPermission } from '@school-manager/types';

export const REQUIRE_PLATFORM_PERMISSION_KEY = 'requirePlatformPermission';

export const RequirePlatformPermission = (key: PlatformPermission) =>
  SetMetadata(REQUIRE_PLATFORM_PERMISSION_KEY, key);
