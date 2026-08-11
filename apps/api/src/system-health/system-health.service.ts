import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

const STALE_AFTER_MS = 5 * 60 * 1000; // 5x the dispatch cron's own 1-minute cadence

@Injectable()
export class SystemHealthService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Read-only — these are deployment env vars, not database rows. Changing
   * them means changing the deploy config, not saving a form here. The one
   * secret (webhook HMAC) is reported as a boolean, never its value.
   * Moved verbatim from the now-deleted platform-settings module (Bucket 1,
   * PR 1 — Platform Settings merged into System Health's Configuration tab).
   */
  getConfiguration() {
    return {
      notificationSenderEmail: this.config.get<string>('BREVO_SENDER_EMAIL') ?? 'noreply@schoolmanager.app',
      notificationSenderName: this.config.get<string>('BREVO_SENDER_NAME') ?? 'School Manager',
      appUrl: this.config.get<string>('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000',
      webhookSecretConfigured: !!this.config.get<string>('NOTIFICATION_HMAC_SECRET'),
    };
  }

  private getApiStatus() {
    return {
      status: 'OK' as const,
      version: process.env.npm_package_version ?? '0.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  private async getDatabaseStatus() {
    const start = Date.now();
    try {
      const { error } = await this.supabase.admin.from('schools').select('id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return { status: 'OK' as const, latencyMs: Date.now() - start };
    } catch {
      return { status: 'DOWN' as const, latencyMs: Date.now() - start };
    }
  }

  private async getAuthHealth() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [logins24h, failures24h, logins7d, failures7d] = await Promise.all([
      this.supabase.admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('action', 'auth.login').gte('created_at', since24h),
      this.supabase.admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('action', 'auth.login_failed').gte('created_at', since24h),
      this.supabase.admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('action', 'auth.login').gte('created_at', since7d),
      this.supabase.admin.from('audit_logs').select('id', { count: 'exact', head: true }).eq('action', 'auth.login_failed').gte('created_at', since7d),
    ]);

    return {
      last24h: { logins: logins24h.count ?? 0, failures: failures24h.count ?? 0 },
      last7d: { logins: logins7d.count ?? 0, failures: failures7d.count ?? 0 },
    };
  }

  private async getNotificationsHealth() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ count: pending }, { count: sentLast24h }, { count: failedLast24h }, { data: oldestPending }, { data: jobRun }] = await Promise.all([
      this.supabase.admin.from('notifications').select('id', { count: 'exact', head: true }).is('email_sent_at', null),
      this.supabase.admin.from('notifications').select('id', { count: 'exact', head: true }).not('email_sent_at', 'is', null).gte('email_sent_at', since24h),
      this.supabase.admin.from('notifications').select('id', { count: 'exact', head: true }).is('email_sent_at', null).not('error_message', 'is', null).gte('created_at', since24h),
      this.supabase.admin.from('notifications').select('created_at').is('email_sent_at', null).order('created_at', { ascending: true }).limit(1),
      this.supabase.admin.from('system_job_runs').select('last_run_at').eq('job_key', 'notifications_dispatch').maybeSingle(),
    ]);

    const oldest = oldestPending?.[0]?.created_at as string | undefined;
    const oldestPendingAgeMinutes = oldest ? Math.round((Date.now() - new Date(oldest).getTime()) / 60000) : null;

    const lastRunAt = jobRun?.last_run_at as string | null | undefined;
    let lastDispatchStatus: 'OK' | 'STALE' | 'UNKNOWN' = 'UNKNOWN';
    if (lastRunAt) {
      lastDispatchStatus = Date.now() - new Date(lastRunAt).getTime() > STALE_AFTER_MS ? 'STALE' : 'OK';
    }

    return {
      pending: pending ?? 0,
      sentLast24h: sentLast24h ?? 0,
      failedLast24h: failedLast24h ?? 0,
      oldestPendingAgeMinutes,
      lastDispatchRunAt: lastRunAt ?? null,
      lastDispatchStatus,
    };
  }

  private async getPaymentsHealth() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      { count: paidToday },
      { count: paidThisWeek },
      { count: pendingCount },
      { count: failedLast24h },
      { data: collectedRows },
      { count: webhookSuccess24h },
      { count: webhookFailed24h },
    ] = await Promise.all([
      this.supabase.admin.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('status', 'SUCCESS').gte('created_at', startOfToday.toISOString()),
      this.supabase.admin.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('status', 'SUCCESS').gte('created_at', since7d),
      this.supabase.admin.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      this.supabase.admin.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('status', 'FAILED').gte('created_at', since24h),
      this.supabase.admin.from('payment_transactions').select('amount').eq('status', 'SUCCESS').gte('created_at', since7d),
      this.supabase.admin.from('webhook_deliveries').select('id', { count: 'exact', head: true }).not('delivered_at', 'is', null).gte('created_at', since24h),
      this.supabase.admin.from('webhook_deliveries').select('id', { count: 'exact', head: true }).is('delivered_at', null).gte('created_at', since24h),
    ]);

    const totalCollectedThisWeek = (collectedRows ?? []).reduce((sum, r) => sum + Number(r.amount), 0);

    return {
      paidToday: paidToday ?? 0,
      paidThisWeek: paidThisWeek ?? 0,
      pendingCount: pendingCount ?? 0,
      failedLast24h: failedLast24h ?? 0,
      totalCollectedThisWeek,
      webhookDeliveries: { successLast24h: webhookSuccess24h ?? 0, failedLast24h: webhookFailed24h ?? 0 },
    };
  }

  async getOverview() {
    const [api, database, auth, notifications, payments] = await Promise.all([
      Promise.resolve(this.getApiStatus()),
      this.getDatabaseStatus(),
      this.getAuthHealth(),
      this.getNotificationsHealth(),
      this.getPaymentsHealth(),
    ]);
    return { api, database, auth, notifications, payments };
  }
}
