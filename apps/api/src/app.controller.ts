// =============================================================================
// Health check endpoint - unauthenticated, used by uptime monitors
// =============================================================================
// Previously hardcoded 'ok' with no real check — a status page watching a
// permanently-OK endpoint provides false assurance (Phase 0 audit finding).
// Deliberately minimal and public-safe: reuses SystemHealthService's own
// cheap DB-ping technique, not its full overview (auth/payment counts are
// business-sensitive and belong behind the authenticated SuperAdmin
// endpoint only). One tier, one honest answer — no /health/deep variant.
// =============================================================================

import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from './supabase/supabase.service';

const NOTIFICATIONS_STALE_AFTER_MS = 5 * 60 * 1000; // matches SystemHealthService's own threshold

@Controller()
export class AppController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('health')
  async health() {
    const dbOk = await this.pingDatabase();
    if (!dbOk) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        checks: { db: 'error' },
      });
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks: {
        db: 'ok',
        notifications_stale: await this.isNotificationsDispatchStale(),
      },
    };
  }

  private async pingDatabase(): Promise<boolean> {
    try {
      const { error } = await this.supabase.admin.from('schools').select('id', { count: 'exact', head: true });
      return !error;
    } catch {
      return false;
    }
  }

  private async isNotificationsDispatchStale(): Promise<boolean> {
    const { data: jobRun } = await this.supabase.admin
      .from('system_job_runs')
      .select('last_run_at')
      .eq('job_key', 'notifications_dispatch')
      .maybeSingle();

    const lastRunAt = jobRun?.last_run_at as string | null | undefined;
    if (!lastRunAt) return false; // never run yet (e.g. a brand-new deploy) isn't "stale", it's "unknown" — don't false-alarm
    return Date.now() - new Date(lastRunAt).getTime() > NOTIFICATIONS_STALE_AFTER_MS;
  }
}
