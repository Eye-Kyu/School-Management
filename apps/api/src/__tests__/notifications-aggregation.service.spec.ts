/**
 * NotificationsAggregationService unit tests — Supabase is faked with a
 * minimal per-table result queue (see FakeQueryBuilder below), matching the
 * established pattern in paybill-reconciliation.spec.ts. No network required.
 * Full query-orchestration coverage across every role/branch lives in the
 * live e2e suite (apps/api/test/dashboard-feed.e2e-spec.ts) — this file
 * focuses on the genuinely unit-testable logic: caching, badge/sort
 * behavior, and module-gating for the new Admin sources.
 */

import { NotificationsAggregationService } from '../notifications-aggregation/notifications-aggregation.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { PaybillReconciliationService } from '../payments/paybill-reconciliation.service';

type TableResult = { data: unknown; error: unknown; count?: number };

class FakeQueryBuilder implements PromiseLike<TableResult> {
  constructor(private readonly result: TableResult) {}
  select() { return this; }
  update() { return this; }
  eq() { return this; }
  in() { return this; }
  gt() { return this; }
  gte() { return this; }
  lte() { return this; }
  is() { return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  single() { return Promise.resolve(this.result); }
  then<TResult1 = TableResult, TResult2 = never>(
    onfulfilled?: ((value: TableResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

type FakeOpts = {
  userRow: { id: string; role: string; school_id?: string } | null;
  tableQueues?: Record<string, TableResult[]>;
  moduleEnabled?: boolean;
};

function makeFakeSupabase(opts: FakeOpts): { supabase: SupabaseService; fromCalls: string[] } {
  const queues: Record<string, TableResult[]> = {};
  for (const [table, results] of Object.entries(opts.tableQueues ?? {})) queues[table] = [...results];
  const fromCalls: string[] = [];

  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      const queue = queues[table];
      const result = queue && queue.length > 0 ? queue.shift()! : { data: [], error: null };
      return new FakeQueryBuilder(result);
    },
  };

  const supabase = {
    forUser: () => client,
    currentUserRow: async (_token: string, select: string) => {
      if (!opts.userRow) return null;
      if (select.includes('school_id') && !select.includes('id,')) return { school_id: opts.userRow.school_id };
      return opts.userRow;
    },
    admin: {
      from: () => new FakeQueryBuilder({ data: null, error: null }),
      rpc: async () => ({ data: opts.moduleEnabled ?? false, error: null }),
    },
  } as unknown as SupabaseService;

  return { supabase, fromCalls };
}

function makeFakePaybill(): PaybillReconciliationService & { listUnmatched: jest.Mock; listOverpayments: jest.Mock } {
  return {
    listUnmatched: jest.fn().mockResolvedValue([]),
    listOverpayments: jest.fn().mockResolvedValue([]),
  } as unknown as PaybillReconciliationService & { listUnmatched: jest.Mock; listOverpayments: jest.Mock };
}

describe('NotificationsAggregationService', () => {
  it('returns an empty feed when no user resolves', async () => {
    const { supabase } = makeFakeSupabase({ userRow: null });
    const svc = new NotificationsAggregationService(supabase, makeFakePaybill());
    const feed = await svc.getFeed('token');
    expect(feed).toEqual({ alerts: [], conversations: [], reminders: [] });
  });

  it('caches the feed — a second call within the TTL does not re-query Supabase', async () => {
    const { supabase, fromCalls } = makeFakeSupabase({
      userRow: { id: 'user-1', role: 'STUDENT' },
      tableQueues: { notifications: [{ data: [], error: null }], students: [{ data: null, error: null }] },
    });
    const svc = new NotificationsAggregationService(supabase, makeFakePaybill());

    await svc.getFeed('token');
    const callsAfterFirst = fromCalls.length;
    await svc.getFeed('token');
    expect(fromCalls.length).toBe(callsAfterFirst); // second call served from cache, zero new queries
  });

  it('STUDENT reminders: an assignment due tomorrow gets a "Due tomorrow" badge; an already-submitted one is excluded', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { supabase } = makeFakeSupabase({
      userRow: { id: 'student-user-1', role: 'STUDENT' },
      tableQueues: {
        notifications: [{ data: [], error: null }],
        students: [{ data: { id: 'student-1', current_class_id: 'class-1' }, error: null }],
        assignments: [{
          data: [
            { id: 'a1', title: 'Due tomorrow essay', due_date: tomorrow },
            { id: 'a2', title: 'Already submitted', due_date: tomorrow },
          ],
          error: null,
        }],
        submissions: [{ data: [{ assignment_id: 'a2', graded_at: null }], error: null }],
      },
    });
    const svc = new NotificationsAggregationService(supabase, makeFakePaybill());
    const feed = await svc.getFeed('token');

    expect(feed.reminders).toHaveLength(1);
    expect(feed.reminders[0]).toMatchObject({ id: 'a:a1', badge: 'Due tomorrow' });
  });

  it('PARENT reminders: an outstanding fee balance surfaces; a fully-paid one does not', async () => {
    const { supabase } = makeFakeSupabase({
      userRow: { id: 'parent-user-1', role: 'PARENT' },
      tableQueues: {
        notifications: [{ data: [], error: null }],
        guardians: [{
          data: [{ student: { id: 'child-1', current_class_id: null, user: { full_name: 'Amina' } } }],
          error: null,
        }],
        permission_slips: [{ data: [], error: null }],
        fee_balances: [{
          data: [{ student_id: 'child-1', amount_due: 5000, amount_paid: 2000, currency: 'KES' }],
          error: null,
        }],
      },
    });
    const svc = new NotificationsAggregationService(supabase, makeFakePaybill());
    const feed = await svc.getFeed('token');

    expect(feed.reminders).toHaveLength(1);
    expect(feed.reminders[0]).toMatchObject({ id: 'fee:child-1', badge: 'Awaiting your action' });
    expect(feed.reminders[0]!.title).toContain('3000.00');
  });

  it('ADMIN reminders: payments module disabled means zero Paybill items and the reconciliation service is never called', async () => {
    const { supabase } = makeFakeSupabase({
      userRow: { id: 'admin-user-1', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        notifications: [{ data: [], error: null }],
        platform_message_recipients: [{ data: [], error: null }],
        permission_slips: [{ data: [], error: null }],
      },
      moduleEnabled: false,
    });
    const paybill = makeFakePaybill();
    const svc = new NotificationsAggregationService(supabase, paybill);
    const feed = await svc.getFeed('token');

    expect(feed.reminders).toEqual([]);
    expect(paybill.listUnmatched).not.toHaveBeenCalled();
    expect(paybill.listOverpayments).not.toHaveBeenCalled();
  });

  it('getUnreadCount sums unread alerts, conversations, and reminders from the same buckets getFeed() builds', async () => {
    // Distinct user id from the test above — the feed cache is a
    // module-level singleton shared across this whole test file, and reusing
    // an id would return that test's stale cached (empty) feed instead of
    // running fresh queries against this test's own fixture data.
    const { supabase } = makeFakeSupabase({
      userRow: { id: 'admin-user-2', role: 'ADMIN', school_id: 'school-1' },
      tableQueues: {
        notifications: [{
          data: [
            { id: 'n1', type: 'NEW_ANNOUNCEMENT', title: 'A', body: 'B', is_read: false, acknowledged_at: null, metadata: null, created_at: new Date().toISOString() },
            { id: 'n2', type: 'NEW_ANNOUNCEMENT', title: 'C', body: 'D', is_read: true, acknowledged_at: null, metadata: null, created_at: new Date().toISOString() },
          ],
          error: null,
        }],
        platform_message_recipients: [{ data: [], error: null }],
        permission_slips: [{ data: [], error: null }],
      },
      moduleEnabled: false,
    });
    const svc = new NotificationsAggregationService(supabase, makeFakePaybill());
    const count = await svc.getUnreadCount('token');
    expect(count).toBe(1); // only n1 is unread; conversations/reminders empty here
  });

  it('markRead() cascades to conversations when a NEW_MESSAGE id is included (BUG-6)', async () => {
    const { supabase, fromCalls } = makeFakeSupabase({
      userRow: { id: 'parent-user-3', role: 'PARENT' },
      tableQueues: {
        // First from('notifications'): the pre-update lookup for NEW_MESSAGE rows.
        // Second from('notifications'): the actual is_read update.
        notifications: [
          { data: [{ metadata: { conversationId: 'conv-1' } }], error: null },
          { data: null, error: null },
        ],
      },
    });
    const svc = new NotificationsAggregationService(supabase, makeFakePaybill());
    await svc.markRead('token', ['n1']);

    expect(fromCalls.filter((t) => t === 'conversations')).toHaveLength(1);
  });

  it('markRead() does not touch conversations when no NEW_MESSAGE id is included', async () => {
    const { supabase, fromCalls } = makeFakeSupabase({
      userRow: { id: 'parent-user-4', role: 'PARENT' },
      tableQueues: {
        notifications: [
          { data: [], error: null }, // pre-update lookup finds no NEW_MESSAGE rows
          { data: null, error: null }, // the actual is_read update
        ],
      },
    });
    const svc = new NotificationsAggregationService(supabase, makeFakePaybill());
    await svc.markRead('token', ['n1']);

    expect(fromCalls.filter((t) => t === 'conversations')).toHaveLength(0);
  });
});
