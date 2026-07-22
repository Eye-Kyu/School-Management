// =============================================================================
// PlatformPermissionGuard - fast-fail check for @RequirePlatformPermission(key)
// =============================================================================
// Must run after AuthGuard + SuperAdminGuard (needs req.user to already be a
// confirmed platform account). Does its own DB round-trip, same pattern as
// every other guard in this codebase (SuperAdminGuard, FeatureGuard) - no
// shared request-scoped cache, kept independent deliberately.
// =============================================================================

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PLATFORM_PERMISSION_KEY } from '../decorators/require-platform-permission.decorator';
import { SupabaseService } from '../../supabase/supabase.service';
import type { AuthedRequest } from '../../auth/auth.guard';

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_PLATFORM_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermission) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();

    const { data: userRow } = await this.supabase.admin
      .from('users')
      .select('platform_permissions')
      .eq('auth_id', req.user.id)
      .maybeSingle();

    const permissions = (userRow?.platform_permissions as string[] | null) ?? [];
    if (!permissions.includes(requiredPermission)) {
      throw new ForbiddenException(`Missing platform permission: ${requiredPermission}`);
    }
    return true;
  }
}
