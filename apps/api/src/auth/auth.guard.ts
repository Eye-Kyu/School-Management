// =============================================================================
// AuthGuard - verifies the bearer token on every protected request
// =============================================================================
// Attaches `req.user` (the Supabase auth user) and `req.accessToken` (the raw
// JWT) so downstream handlers can build user-scoped Supabase clients.
//
// Usage:
//   @UseGuards(AuthGuard)
//   @Get('something')
//   handler(@Req() req) { ... }
// =============================================================================

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';
import { AssistModeClaims as AssistModeClaimsSchema, type AssistModeClaims } from '../common/assist-mode';

export interface AuthedRequest extends Request {
  user: {
    id: string;
    email?: string;
    phone?: string;
  };
  accessToken: string;
  /** Present only when a valid, unexpired assist-mode token was supplied. */
  assistContext?: AssistModeClaims;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'];

    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Empty bearer token');
    }

    const { data, error } = await this.supabase.admin.auth.getUser(token);
    if (error || !data?.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    req.user = {
      id: data.user.id,
      email: data.user.email ?? undefined,
      phone: data.user.phone ?? undefined,
    };
    req.accessToken = token;

    // SA-37 / SA-34 (security audit 2026-11): a deactivated or deleted
    // account, or any non-SUPER_ADMIN account whose school is not ACTIVE, is
    // refused here. Many API paths read through the service-role client, which
    // bypasses RLS, so the RLS helpers alone (migration 100) don't cover them.
    // A caller with no users row yet (mid-provisioning) is let through as
    // before; services resolve and reject them individually.
    const { data: caller } = await this.supabase.admin
      .from('users')
      .select('id, role, is_active, deleted_at, school:schools(status)')
      .eq('auth_id', data.user.id)
      .maybeSingle();
    if (caller) {
      if (caller.deleted_at || caller.is_active === false) {
        throw new ForbiddenException('This account has been deactivated');
      }
      const school = (Array.isArray(caller.school) ? caller.school[0] : caller.school) as { status?: string } | null;
      if (caller.role !== 'SUPER_ADMIN' && school && school.status !== 'ACTIVE') {
        throw new ForbiddenException('This school is not active');
      }
    }

    // Assist mode: an invalid/expired/missing token just means "not in
    // assist mode" — never blocks the request. Downstream write paths that
    // require an active assist context check for it explicitly and re-verify
    // the grant is still ACTIVE against the DB (see AssistScopeGuard).
    const assistHeader = req.headers['x-assist-token'];
    if (typeof assistHeader === 'string' && assistHeader) {
      try {
        const payload = await this.jwt.verifyAsync(assistHeader);
        const claims = AssistModeClaimsSchema.parse(payload);
        // SA-01: an assist token is a bearer credential minted for ONE
        // super-admin. Only honour it when the authenticated caller IS that
        // super-admin (and is still an active, non-deleted SUPER_ADMIN), so a
        // leaked token cannot be replayed under any other account.
        if (
          caller
          && caller.id === claims.superAdminUserId
          && caller.role === 'SUPER_ADMIN'
          && caller.is_active !== false
          && !caller.deleted_at
        ) {
          req.assistContext = claims;
        }
      } catch {
        // Expired, tampered, or shape-mismatched — silently treated as "no assist context."
      }
    }

    return true;
  }
}
