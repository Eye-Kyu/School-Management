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
import type { Request } from 'express';
import { SupabaseService } from '../supabase/supabase.service';

export interface AuthedRequest extends Request {
  user: {
    id: string;
    email?: string;
    phone?: string;
  };
  accessToken: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabase: SupabaseService) {}

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
    return true;
  }
}
