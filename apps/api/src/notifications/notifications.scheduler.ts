import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';
import { SupabaseService } from '../supabase/supabase.service';

const JOB_KEY = 'notifications_dispatch';

@Injectable()
export class NotificationsScheduler {
  // Defense in depth against BUG-4 (docs/bug-triage.md) — the real,
  // load-bearing fix is dispatch()'s own atomic per-row claim (see its
  // header comment), but there's no reason to let a tick that overruns 60s
  // start a second, fully redundant dispatch() run on top of itself.
  private running = false;

  constructor(
    private readonly svc: NotificationsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatch() {
    if (this.running) {
      console.warn('[NotificationsScheduler] Previous dispatch tick still running — skipping this tick.');
      return;
    }
    this.running = true;
    const now = new Date().toISOString();
    try {
      await this.svc.dispatch();
      await this.supabase.admin
        .from('system_job_runs')
        .upsert({ job_key: JOB_KEY, last_run_at: now, last_success_at: now, last_error: null, updated_at: now }, { onConflict: 'job_key' });
    } catch (err) {
      await this.supabase.admin
        .from('system_job_runs')
        .upsert({ job_key: JOB_KEY, last_run_at: now, last_error: err instanceof Error ? err.message : String(err), updated_at: now }, { onConflict: 'job_key' });
    } finally {
      this.running = false;
    }
  }
}
