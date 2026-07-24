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

    // Assist mode: an invalid/expired/missing token just means "not in
    // assist mode" — never blocks the request. Downstream write paths that
    // require an active assist context check for it explicitly and re-verify
    // the grant is still ACTIVE against the DB (see AssistScopeGuard).
    const assistHeader = req.headers['x-assist-token'];
    if (typeof assistHeader === 'string' && assistHeader) {
      try {
        const payload = await this.jwt.verifyAsync(assistHeader);
        req.assistContext = AssistModeClaimsSchema.parse(payload);
      } catch {
        // Expired, tampered, or shape-mismatched — silently treated as "no assist context."
      }
    }

    return true;
  }
}
