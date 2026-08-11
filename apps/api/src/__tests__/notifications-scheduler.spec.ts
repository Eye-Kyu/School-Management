/**
 * NotificationsScheduler's overlap guard — defense in depth against BUG-4
 * (docs/bug-triage.md). The load-bearing fix is dispatch()'s own atomic
 * per-row claim (see notifications-sms.e2e-spec.ts's concurrency test); this
 * covers the cheaper, complementary guard that stops a slow tick from
 * kicking off a second, fully redundant dispatch() run on top of itself.
 */

import { NotificationsScheduler } from '../notifications/notifications.scheduler';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SupabaseService } from '../supabase/supabase.service';

function makeFakeSupabase(): SupabaseService {
  return {
    admin: {
      from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
    },
  } as unknown as SupabaseService;
}

describe('NotificationsScheduler overlap guard', () => {
  it('skips a tick that fires while the previous one is still running, then resumes once it finishes', async () => {
    let releaseFirstCall: () => void;
    const firstCallGate = new Promise<void>((resolve) => { releaseFirstCall = resolve; });
    const dispatchMock = jest.fn()
      .mockImplementationOnce(() => firstCallGate)
      .mockResolvedValue(undefined);

    const svc = { dispatch: dispatchMock } as unknown as NotificationsService;
    const scheduler = new NotificationsScheduler(svc, makeFakeSupabase());

    // Async functions run synchronously up to their first `await` — by the
    // time this call expression returns a (pending) promise, `running` is
    // already true, so the very next call synchronously sees it.
    const firstTick = scheduler.dispatch();
    const secondTick = scheduler.dispatch();

    await secondTick;
    expect(dispatchMock).toHaveBeenCalledTimes(1); // the second tick never called svc.dispatch() at all

    releaseFirstCall!();
    await firstTick;

    await scheduler.dispatch(); // running is false again — this one proceeds
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });
});
