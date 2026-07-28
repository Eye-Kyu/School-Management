/**
 * GET /health — previously hardcoded 'ok' with no real check. Now pings the
 * database (reusing SystemHealthService's own technique) and reports
 * notifications-dispatch staleness. Supabase is faked, no network required.
 */

import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from '../app.controller';
import type { SupabaseService } from '../supabase/supabase.service';

function makeFakeSupabase(opts: { dbError?: boolean; lastRunAt?: string | null }): SupabaseService {
  return {
    admin: {
      from: (table: string) => {
        if (table === 'schools') {
          return { select: () => Promise.resolve({ error: opts.dbError ? { message: 'connection refused' } : null }) };
        }
        if (table === 'system_job_runs') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: opts.lastRunAt !== undefined ? { last_run_at: opts.lastRunAt } : null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table in fake: ${table}`);
      },
    },
  } as unknown as SupabaseService;
}

describe('AppController.health', () => {
  it('returns 200 status ok with a recently-run dispatcher', async () => {
    const controller = new AppController(makeFakeSupabase({ dbError: false, lastRunAt: new Date().toISOString() }));
    const result = await controller.health();
    expect(result.status).toBe('ok');
    expect(result.checks.db).toBe('ok');
    expect(result.checks.notifications_stale).toBe(false);
    expect(result.timestamp).toBeTruthy();
  });

  it('throws a 503 ServiceUnavailableException when the database is unreachable', async () => {
    const controller = new AppController(makeFakeSupabase({ dbError: true }));
    await expect(controller.health()).rejects.toThrow(ServiceUnavailableException);
    try {
      await controller.health();
      fail('expected health() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getStatus()).toBe(503);
      const response = (err as ServiceUnavailableException).getResponse() as Record<string, unknown>;
      expect(response.status).toBe('degraded');
      expect((response.checks as Record<string, unknown>).db).toBe('error');
    }
  });

  it('reports notifications_stale: true (still HTTP 200) when the dispatcher has not run in over 5 minutes', async () => {
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const controller = new AppController(makeFakeSupabase({ dbError: false, lastRunAt: staleTimestamp }));
    const result = await controller.health();
    expect(result.status).toBe('ok');
    expect(result.checks.notifications_stale).toBe(true);
  });

  it('does not flag staleness when the dispatcher has simply never run yet (unknown, not stale)', async () => {
    const controller = new AppController(makeFakeSupabase({ dbError: false, lastRunAt: null }));
    const result = await controller.health();
    expect(result.checks.notifications_stale).toBe(false);
  });
});
