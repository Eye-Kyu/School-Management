/**
 * Regression tests for the V1 fixes from the 2026-11 security audit
 * (docs/audits/security-audit-2026-11-tracker.md). Pure unit tests: config,
 * JWT and Supabase are faked; no network or database.
 *
 * Follows the established FakeQueryBuilder copy-paste pattern used by the
 * other service specs (see CLAUDE.md §7) rather than extracting a shared helper.
 */

import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import { MpesaDarajaService } from '../payments/mpesa-daraja.service';
import { getNotificationHmacSecret } from '../common/notification-secret';
import { AuthGuard } from '../auth/auth.guard';
import { PaymentsService } from '../payments/payments.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { NotificationsService } from '../notifications/notifications.service';

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

type TableResult = { data: unknown; error: unknown };

class FakeQueryBuilder implements PromiseLike<TableResult> {
  constructor(private readonly result: TableResult, private readonly onWrite?: (op: string, payload: unknown) => void) {}
  select() { return this; }
  eq() { return this; }
  neq() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  update(payload: unknown) { this.onWrite?.('update', payload); return this; }
  insert(payload: unknown) { this.onWrite?.('insert', payload); return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  single() { return Promise.resolve(this.result); }
  then<R1 = TableResult, R2 = never>(
    onFulfilled?: ((v: TableResult) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

// ── SA-04: Daraja IP check fails closed ─────────────────────────────────────
describe('MpesaDarajaService.isRequestFromSafaricom (SA-04)', () => {
  const daraja = (env: Record<string, string | undefined>) =>
    new MpesaDarajaService({} as SupabaseService, fakeConfig(env), {} as never);

  it('enforces the allowlist when MPESA_DARAJA_MODE is unset', () => {
    expect(daraja({ MPESA_ALLOWED_IPS: '196.201.214.0/24' }).isRequestFromSafaricom('1.2.3.4')).toBe(false);
    expect(daraja({ MPESA_ALLOWED_IPS: '196.201.214.0/24' }).isRequestFromSafaricom('196.201.214.10')).toBe(true);
  });

  it('enforces the allowlist for misspelled modes', () => {
    expect(daraja({ MPESA_DARAJA_MODE: 'prod' }).isRequestFromSafaricom('1.2.3.4')).toBe(false);
  });

  it('only an explicit sandbox skips the check outside production', () => {
    expect(daraja({ MPESA_DARAJA_MODE: 'sandbox' }).isRequestFromSafaricom('1.2.3.4')).toBe(true);
  });

  it('ignores sandbox when NODE_ENV=production', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(daraja({ MPESA_DARAJA_MODE: 'sandbox', NODE_ENV: 'production' }).isRequestFromSafaricom('1.2.3.4')).toBe(false);
    spy.mockRestore();
  });

  it('rejects everything when the allowlist is empty', () => {
    expect(daraja({ MPESA_DARAJA_MODE: 'production' }).isRequestFromSafaricom('196.201.214.10')).toBe(false);
  });
});

// ── SA-05: no guessable HMAC fallback ───────────────────────────────────────
describe('getNotificationHmacSecret (SA-05)', () => {
  it('returns null when unset, blank, or the old public fallback', () => {
    expect(getNotificationHmacSecret(fakeConfig({}))).toBeNull();
    expect(getNotificationHmacSecret(fakeConfig({ NOTIFICATION_HMAC_SECRET: '  ' }))).toBeNull();
    expect(getNotificationHmacSecret(fakeConfig({ NOTIFICATION_HMAC_SECRET: 'default-secret' }))).toBeNull();
  });
  it('returns a configured secret', () => {
    expect(getNotificationHmacSecret(fakeConfig({ NOTIFICATION_HMAC_SECRET: 'a'.repeat(64) }))).toBe('a'.repeat(64));
  });
});

// ── SA-01: assist token bound to the presenting super-admin ─────────────────
describe('AuthGuard assist-token binding (SA-01)', () => {
  const claims = {
    superAdminUserId: '11111111-1111-4111-8111-111111111111',
    targetSchoolId: '22222222-2222-4222-8222-222222222222',
    accessGrantId: '33333333-3333-4333-8333-333333333333',
    grantedScopes: ['ACADEMIC_DATA'],
  };

  function run(callerRow: Record<string, unknown> | null) {
    const supabase = {
      admin: {
        auth: { getUser: async () => ({ data: { user: { id: 'auth-uid' } }, error: null }) },
        from: () => new FakeQueryBuilder({ data: callerRow, error: null }),
      },
    } as unknown as SupabaseService;
    const jwt = { verifyAsync: async () => claims } as unknown as JwtService;
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer user-jwt', 'x-assist-token': 'assist-jwt' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    return new AuthGuard(supabase, jwt).canActivate(ctx).then(() => req);
  }

  it('attaches the assist context when the caller is the minting super-admin', async () => {
    const req = await run({ id: claims.superAdminUserId, role: 'SUPER_ADMIN', is_active: true, deleted_at: null });
    expect(req.assistContext).toEqual(claims);
  });

  it('ignores the token when presented by a different user', async () => {
    const req = await run({ id: '44444444-4444-4444-8444-444444444444', role: 'TEACHER', is_active: true, deleted_at: null });
    expect(req.assistContext).toBeUndefined();
  });

  it('ignores the token for a demoted super-admin or a caller with no users row', async () => {
    expect((await run({ id: claims.superAdminUserId, role: 'ADMIN', is_active: true, deleted_at: null })).assistContext).toBeUndefined();
    expect((await run(null)).assistContext).toBeUndefined();
  });

  // SA-37 / SA-34: account and school lifecycle are enforced at the guard.
  it('rejects a deactivated or soft-deleted account outright', async () => {
    await expect(run({ id: claims.superAdminUserId, role: 'SUPER_ADMIN', is_active: false, deleted_at: null })).rejects.toThrow('deactivated');
    await expect(run({ id: 'u', role: 'TEACHER', is_active: true, deleted_at: '2026-11-01' })).rejects.toThrow('deactivated');
  });

  it('rejects school users when their school is not ACTIVE, but not super-admins', async () => {
    for (const status of ['SUSPENDED', 'INACTIVE', 'ARCHIVED']) {
      await expect(run({ id: 'u', role: 'TEACHER', is_active: true, deleted_at: null, school: { status } })).rejects.toThrow('not active');
    }
    const ok = await run({ id: 'u', role: 'TEACHER', is_active: true, deleted_at: null, school: { status: 'ACTIVE' } });
    expect(ok.user).toBeDefined();
  });
});

// ── SA-07 / SA-06: Paystack webhook and reconciliation ─────────────────────
describe('PaymentsService Paystack fixes (SA-06, SA-07)', () => {
  const notifications = { queue: jest.fn(async () => undefined) } as unknown as NotificationsService;

  it('rejects every webhook when PAYSTACK_SECRET_KEY is unset (SA-07)', async () => {
    const from = jest.fn();
    const svc = new PaymentsService({ admin: { from } } as unknown as SupabaseService, fakeConfig({}), notifications);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const crypto = await import('crypto');
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'sm_x', status: 'success', amount: 100 } });
    const forgedSig = crypto.createHmac('sha512', '').update(body).digest('hex'); // signature over an empty key
    await svc.handleWebhook(forgedSig, body);
    expect(from).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  function reconcileHarness(txn: Record<string, unknown>, transitioned: unknown[]) {
    const writes: { table: string; op: string; payload: unknown }[] = [];
    let paymentTxnCalls = 0;
    const from = jest.fn((table: string): FakeQueryBuilder => {
      if (table === 'payment_transactions') {
        // first call: select txn; second call: update ... select transitioned rows
        paymentTxnCalls += 1;
        const isFirst = paymentTxnCalls === 1;
        return new FakeQueryBuilder(
          isFirst ? { data: txn, error: null } : { data: transitioned, error: null },
          (op, payload) => writes.push({ table, op, payload }),
        );
      }
      if (table === 'fee_balances') {
        return new FakeQueryBuilder({ data: { amount_paid: 0 }, error: null }, (op, payload) => writes.push({ table, op, payload }));
      }
      return new FakeQueryBuilder({ data: null, error: null }, (op, payload) => writes.push({ table, op, payload }));
    });
    const svc = new PaymentsService({ admin: { from } } as unknown as SupabaseService, fakeConfig({ PAYSTACK_SECRET_KEY: 'sk_test' }), notifications);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(svc as any, 'queuePaymentReceiptNotifications').mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(svc as any, 'dispatchWebhookEvent').mockResolvedValue(undefined);
    return { svc, writes };
  }

  const txn = { id: 't1', school_id: 's1', student_id: 'st1', parent_user_id: 'p1', fee_balance_id: 'fb1', amount: 1000, currency: 'KES', status: 'PENDING' };

  it('credits only when Paystack confirms the stored amount and currency (SA-06)', async () => {
    const { svc, writes } = reconcileHarness(txn, [{ id: 't1' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (svc as any).reconcilePayment('sm_ref', { status: 'success', amount: 100000, currency: 'KES' });
    expect(writes.some((w) => w.table === 'fee_balances' && w.op === 'update')).toBe(true);
  });

  it('marks FAILED and does not credit on an amount mismatch (SA-06)', async () => {
    const { svc, writes } = reconcileHarness(txn, [{ id: 't1' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (svc as any).reconcilePayment('sm_ref', { status: 'success', amount: 100, currency: 'KES' });
    const statusWrite = writes.find((w) => w.table === 'payment_transactions' && w.op === 'update');
    expect((statusWrite?.payload as { status: string }).status).toBe('FAILED');
    expect(writes.some((w) => w.table === 'fee_balances')).toBe(false);
  });

  it('marks FAILED on a currency mismatch (SA-06)', async () => {
    const { svc, writes } = reconcileHarness(txn, [{ id: 't1' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (svc as any).reconcilePayment('sm_ref', { status: 'success', amount: 100000, currency: 'USD' });
    expect(writes.some((w) => w.table === 'fee_balances')).toBe(false);
  });

  it('does not credit twice when another call already moved the row (atomic transition)', async () => {
    const { svc, writes } = reconcileHarness(txn, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (svc as any).reconcilePayment('sm_ref', { status: 'success', amount: 100000, currency: 'KES' });
    expect(writes.some((w) => w.table === 'fee_balances')).toBe(false);
  });
});
