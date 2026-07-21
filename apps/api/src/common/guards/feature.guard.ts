// =============================================================================
// FeatureGuard - fast-fail check for @RequireModule(key) routes
// =============================================================================
// Must run after AuthGuard (needs req.user). Not the real security boundary —
// that's module_enabled() folded directly into RLS. This guard just avoids a
// wasted round-trip and gives a clearer error message than a silently-empty
// RLS-filtered response would.
// =============================================================================

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';
import { SupabaseService } from '../../supabase/supabase.service';
import type { AuthedRequest } from '../../auth/auth.guard';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredModule) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();

    const { data: userRow } = await this.supabase.admin
      .from('users')
      .select('school_id')
      .eq('auth_id', req.user.id)
      .maybeSingle();

    // No school (e.g. SUPER_ADMIN) — not this guard's concern.
    if (!userRow?.school_id) return true;

    const { data: enabled } = await this.supabase.admin.rpc('module_enabled', {
      p_school_id: userRow.school_id,
      p_module_key: requiredModule,
    });

    if (enabled === false) {
      throw new ForbiddenException(`The '${requiredModule}' feature is not enabled for your school`);
    }
    return true;
  }
}
