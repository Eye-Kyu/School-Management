import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../supabase/supabase.service';
import { ASSIST_SCOPE_KEY } from '../decorators/require-assist-scope.decorator';
import type { AuthedRequest } from '../../auth/auth.guard';
import type { PrivilegedAccessScope } from '@school-manager/types';

/**
 * Only acts when req.assistContext is present (set by AuthGuard from a
 * verified assist-mode token) — a normal request without one passes through
 * unaffected. When assist mode IS active, this re-checks the grant against
 * the DB on every single mutating request (never trusts the JWT's claims
 * alone for a write) — mid-session revocation or expiry is caught here even
 * though the token itself hasn't expired yet.
 */
@Injectable()
export class AssistScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.assistContext) return true;

    const { data: grant } = await this.supabase.admin
      .from('privileged_access_grants')
      .select('id, status, expires_at, scopes, target_school_id')
      .eq('id', req.assistContext.accessGrantId)
      .maybeSingle();

    if (!grant || grant.status !== 'ACTIVE' || new Date(grant.expires_at).getTime() <= Date.now()) {
      throw new ForbiddenException('Your assist-mode session has ended. Please re-enter assist mode.');
    }

    const requiredScope = this.reflector.get<PrivilegedAccessScope | undefined>(ASSIST_SCOPE_KEY, context.getHandler());
    if (requiredScope && !(grant.scopes as string[]).includes(requiredScope)) {
      throw new ForbiddenException(`This action requires the '${requiredScope}' scope, which your assist-mode grant does not include.`);
    }

    // Keep req.assistContext's school id trustworthy for the service layer —
    // re-derived from the DB row just verified above, not the (already
    // signature-verified, but belt-and-suspenders) JWT claim.
    req.assistContext.targetSchoolId = grant.target_school_id;
    return true;
  }
}
