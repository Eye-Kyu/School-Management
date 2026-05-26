import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthGuard } from './auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseService } from '../supabase/supabase.service';
import { NotFoundException } from '@nestjs/common';

const ALLOWED_ACTIONS = ['auth.login', 'auth.logout', 'auth.password_reset'] as const;
type AuthAction = (typeof ALLOWED_ACTIONS)[number];

@Controller('auth')
export class AuthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async me(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
  ) {
    const client = this.supabase.forUser(token);

    const { data, error } = await client
      .from('users')
      .select('id, school_id, email, phone, full_name, role')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('User profile not found');

    return {
      id: data.id,
      schoolId: data.school_id,
      email: data.email,
      phone: data.phone,
      fullName: data.full_name,
      role: data.role,
    };
  }

  @Post('events')
  @UseGuards(AuthGuard)
  async logEvent(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body() body: { action: AuthAction; metadata?: Record<string, unknown> },
  ) {
    if (!ALLOWED_ACTIONS.includes(body.action)) return { ok: true };

    const client = this.supabase.forUser(token);
    const { data: userRow } = await client
      .from('users')
      .select('id, school_id')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (!userRow) return { ok: true };

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: userRow.school_id,
      user_id: userRow.id,
      action: body.action,
      entity_type: 'user',
      entity_id: userRow.id,
      metadata: body.metadata ?? {},
    });

    return { ok: true };
  }

  @Post('failed-login')
  async logFailedLogin(@Body() body: { email?: string }) {
    if (!body.email) return { ok: true };

    const { data: userRow } = await this.supabase.admin
      .from('users')
      .select('id, school_id')
      .eq('email', body.email)
      .maybeSingle();

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: userRow?.school_id ?? null,
      user_id: userRow?.id ?? null,
      action: 'auth.login_failed',
      entity_type: 'user',
      entity_id: userRow?.id ?? null,
      metadata: { email: body.email },
    });

    return { ok: true };
  }
}
