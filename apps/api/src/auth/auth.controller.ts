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
      .select('id, school_id, email, phone, full_name, role, platform_permissions')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('User profile not found');

    const enabledModules = data.school_id ? await this.getEnabledModules(data.school_id) : [];

    return {
      id: data.id,
      schoolId: data.school_id,
      email: data.email,
      phone: data.phone,
      fullName: data.full_name,
      role: data.role,
      enabledModules,
      platformPermissions: (data.platform_permissions as string[] | null) ?? [],
    };
  }

  /**
   * All module keys currently enabled for a school — single source of truth
   * via the effective_enabled_modules() SQL function (school_modules
   * override > core > package entitlement > default-enabled). Uses the
   * admin client for the RPC call, matching FeatureGuard's existing pattern
   * for calling module_enabled()-family functions.
   */
  private async getEnabledModules(schoolId: string): Promise<string[]> {
    const { data } = await this.supabase.admin.rpc('effective_enabled_modules', { p_school_id: schoolId });
    return ((data as { module_key: string }[] | null) ?? []).map((r) => r.module_key);
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
