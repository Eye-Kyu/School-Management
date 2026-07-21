// =============================================================================
// SuperAdminGuard - restricts a route to the SUPER_ADMIN role only
// =============================================================================
// Must run after AuthGuard (needs req.user). Distinct from FeatureGuard — this
// checks WHO the caller is, not WHAT their school has enabled.
// =============================================================================

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import type { AuthedRequest } from '../../auth/auth.guard';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();

    const { data: userRow } = await this.supabase.admin
      .from('users')
      .select('role')
      .eq('auth_id', req.user.id)
      .maybeSingle();

    if (userRow?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
