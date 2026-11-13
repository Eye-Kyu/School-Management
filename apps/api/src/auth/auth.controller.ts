import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
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

  // Unauthenticated by design (the caller just failed to sign in), so the
  // report is unverifiable. SA-40: it is recorded as an unattributed,
  // client-reported event (no user_id/school_id/entity_id), so a forged
  // request can no longer plant a login failure on a real user's or school's
  // audit trail; it only feeds the platform-wide count in system-health.
  // The email must look like one, and each IP is capped per minute.
  @Post('failed-login')
  async logFailedLogin(@Body() body: { email?: unknown }, @Req() req: { ip?: string }) {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: true };
    if (!allowFailedLoginReport(req.ip ?? 'unknown')) return { ok: true };

    await this.supabase.admin.from('audit_logs').insert({
      id: randomUUID(),
      school_id: null,
      user_id: null,
      action: 'auth.login_failed',
      entity_type: 'user',
      entity_id: null,
      metadata: { email, client_reported: true },
    });

    return { ok: true };
  }
}

// Fixed-window, per-process limiter for the unauthenticated failed-login
// report (SA-40). Generous for a person retyping a password, tight enough
// to stop scripted flooding of the audit table from one address.
const FAILED_LOGIN_WINDOW_MS = 60_000;
const FAILED_LOGIN_MAX_PER_WINDOW = 10;
const failedLoginHits = new Map<string, { windowStart: number; count: number }>();
export function allowFailedLoginReport(ip: string, now = Date.now()): boolean {
  const entry = failedLoginHits.get(ip);
  if (!entry || now - entry.windowStart >= FAILED_LOGIN_WINDOW_MS) {
    if (failedLoginHits.size > 10_000) failedLoginHits.clear();
    failedLoginHits.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= FAILED_LOGIN_MAX_PER_WINDOW;
}
