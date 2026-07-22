import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';
import { SupabaseService } from '../supabase/supabase.service';

const JOB_KEY = 'notifications_dispatch';

@Injectable()
export class NotificationsScheduler {
  constructor(
    private readonly svc: NotificationsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatch() {
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
    }
  }
}
