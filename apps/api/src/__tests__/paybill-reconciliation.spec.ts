/**
 * PaybillReconciliationService.reconcile() unit tests — the matching
 * algorithm (admission-number primary match, fuzzy name+amount fallback,
 * exact/ambiguous/overpayment/partial/tolerance handling). Supabase is
 * faked with a minimal per-table result queue (see FakeQueryBuilder below)
 * rather than hitting a real database — no network required.
 */

import { PaybillReconciliationService } from '../payments/paybill-reconciliation.service';
import type { SupabaseService } from '../supabase/supabase.service';
import type { PaymentsService } from '../payments/payments.service';

type TableResult = { data: unknown; error: unknown };
type Write = { table: string; op: 'update' | 'insert'; payload: Record<string, unknown> };

// A Supabase query-builder chain (`.from().select().eq()...`) is thenable —
// awaiting it resolves `{ data, error }`. This fake supports every chain
// method PaybillReconciliationService calls and always resolves to a canned
// result, ignoring the actual filter arguments (each test supplies exactly
// the fixture the code path under test needs).
class FakeQueryBuilder implements PromiseLike<TableResult> {
  constructor(
    private readonly result: TableResult,
    private readonly onWrite: (op: Write['op'], payload: Record<string, unknown>) => void,
  ) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  ilike() { return this; }
  not() { return this; }
  order() { return this; }
  update(payload: Record<string, unknown>) { this.onWrite('update', payload); return this; }
  insert(payload: Record<string, unknown>) { this.onWrite('insert', payload); return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  single() { return Promise.resolve(this.result); }
  then<TResult1 = TableResult, TResult2 = never>(
    onfulfilled?: ((value: TableResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/**
 * `tableQueues` supplies one result per call to `.from(table)`, in call
 * order — e.g. `students` is queried once as a list (admission lookup) and
 * again as a single row (fuzzy-match suggestion detail), so tests that
 * exercise both give a two-element queue. Only the `admin` client is faked —
 * `reconcile()` and its private helpers never touch `forUser()`.
 */
function makeFakeSupabase(tableQueues: Record<string, TableResult[]>, writes: Write[]): SupabaseService {
  const queues: Record<string, TableResult[]> = {};
  for (const [table, results] of Object.entries(tableQueues)) queues[table] = [...results];

  return {
    admin: {
      from: (table: string) => {
        const queue = queues[table];
        const result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
        return new FakeQueryBuilder(result, (op, payload) => writes.push({ table, op, payload }));
      },
    },
  } as unknown as SupabaseService;
}

type FakePayments = PaymentsService & { creditFeeBalance: jest.Mock; queuePaymentReceiptNotifications: jest.Mock };

function makeFakePayments(): FakePayments {
  return {
    creditFeeBalance: jest.fn().mockResolvedValue(undefined),
    queuePaymentReceiptNotifications: jest.fn().mockResolvedValue(undefined),
  } as unknown as FakePayments;
}

function baseTxn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    school_id: 'school-1',
    amount: 5000,
    bill_reference_number: 'ADM001',
    msisdn: '254712345678',
    reconciliation_status: 'PENDING',
    ...overrides,
  };
}

function findWrite(writes: Write[], table: string, op: Write['op']) {
  return writes.find((w) => w.table === table && w.op === op);
}

describe('PaybillReconciliationService.reconcile', () => {
  it('matches exactly one admission number and credits the fee balance with no note (clean, within tolerance)', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn(), error: null }],
      students: [{ data: [{ id: 'student-1', admission_no: 'ADM001', user: { full_name: 'Jane Doe' } }], error: null }],
      fee_balances: [{ data: [{ id: 'fb-1', amount_due: 5000, amount_paid: 0 }], error: null }],
      guardians: [{ data: [{ user_id: 'guardian-1' }], error: null }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    expect(payments.creditFeeBalance).toHaveBeenCalledWith('fb-1', 5000);

    const update = findWrite(writes, 'payment_paybill_transactions', 'update')!;
    expect(update.payload.reconciliation_status).toBe('MATCHED');
    expect(update.payload.matched_student_id).toBe('student-1');
    expect(update.payload.matched_fee_balance_id).toBe('fb-1');
    expect(update.payload.reconciliation_notes).toBeNull();

    expect(payments.queuePaymentReceiptNotifications).toHaveBeenCalledTimes(1);
    expect(payments.queuePaymentReceiptNotifications).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: 'guardian-1',
      paymentId: 'txn-1',
      paymentType: 'paybill',
      studentId: 'student-1',
      amount: 5000,
    }));
  });

  it('normalizes admission numbers (trims whitespace, ignores case) before matching', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn({ bill_reference_number: ' adm001 ' }), error: null }],
      students: [{ data: [{ id: 'student-1', admission_no: 'ADM001', user: { full_name: 'Jane Doe' } }], error: null }],
      fee_balances: [{ data: [{ id: 'fb-1', amount_due: 5000, amount_paid: 0 }], error: null }],
      guardians: [{ data: [], error: null }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    const update = findWrite(writes, 'payment_paybill_transactions', 'update')!;
    expect(update.payload.reconciliation_status).toBe('MATCHED');
    expect(update.payload.matched_student_id).toBe('student-1');
  });

  it('marks UNMATCHED when no admission number or fuzzy candidate matches', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn({ bill_reference_number: 'ADM999' }), error: null }],
      students: [{ data: [{ id: 'student-1', admission_no: 'ADM001', user: { full_name: 'Jane Doe' } }], error: null }],
      guardians: [{ data: [], error: null }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    expect(payments.creditFeeBalance).not.toHaveBeenCalled();
    const update = findWrite(writes, 'payment_paybill_transactions', 'update')!;
    expect(update.payload.reconciliation_status).toBe('UNMATCHED');
    expect(update.payload.reconciliation_notes).toBe('No admission-number or fuzzy match found');

    const audit = findWrite(writes, 'audit_logs', 'insert')!;
    expect((audit.payload.metadata as Record<string, unknown>).newStatus).toBe('UNMATCHED');
  });

  it('marks UNMATCHED as ambiguous when more than one student matches the same admission number', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn(), error: null }],
      students: [{
        data: [
          { id: 'student-1', admission_no: 'ADM001', user: { full_name: 'Jane Doe' } },
          { id: 'student-2', admission_no: 'adm001', user: { full_name: 'Jane Impersonator' } },
        ],
        error: null,
      }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    expect(payments.creditFeeBalance).not.toHaveBeenCalled();
    const update = findWrite(writes, 'payment_paybill_transactions', 'update')!;
    expect(update.payload.reconciliation_status).toBe('UNMATCHED');
    expect(update.payload.reconciliation_notes).toBe('Ambiguous: more than one student matched this reference');
  });

  it('flags an overpayment when the amount exceeds outstanding balance beyond the KES 1 tolerance', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn({ amount: 5500 }), error: null }],
      students: [{ data: [{ id: 'student-1', admission_no: 'ADM001', user: { full_name: 'Jane Doe' } }], error: null }],
      fee_balances: [{ data: [{ id: 'fb-1', amount_due: 5000, amount_paid: 0 }], error: null }],
      guardians: [{ data: [], error: null }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    expect(payments.creditFeeBalance).toHaveBeenCalledWith('fb-1', 5500);
    const update = findWrite(writes, 'payment_paybill_transactions', 'update')!;
    expect(update.payload.reconciliation_status).toBe('MATCHED');
    expect(update.payload.reconciliation_notes).toContain('Overpayment:');
  });

  it('flags a partial payment when the amount is short of outstanding balance beyond the KES 1 tolerance', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn({ amount: 3000 }), error: null }],
      students: [{ data: [{ id: 'student-1', admission_no: 'ADM001', user: { full_name: 'Jane Doe' } }], error: null }],
      fee_balances: [{ data: [{ id: 'fb-1', amount_due: 5000, amount_paid: 0 }], error: null }],
      guardians: [{ data: [], error: null }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    const update = findWrite(writes, 'payment_paybill_transactions', 'update')!;
    expect(update.payload.reconciliation_status).toBe('MATCHED');
    expect(update.payload.reconciliation_notes).toContain('Partial payment:');
  });

  it('treats a KES 1 overage as within tolerance (clean match, no note) — boundary is exclusive', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn({ amount: 5001 }), error: null }],
      students: [{ data: [{ id: 'student-1', admission_no: 'ADM001', user: { full_name: 'Jane Doe' } }], error: null }],
      fee_balances: [{ data: [{ id: 'fb-1', amount_due: 5000, amount_paid: 0 }], error: null }],
      guardians: [{ data: [], error: null }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    const update = findWrite(writes, 'payment_paybill_transactions', 'update')!;
    expect(update.payload.reconciliation_notes).toBeNull();
  });

  it('treats a KES 1 shortfall as within tolerance (clean match, no note) — boundary is exclusive', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn({ amount: 4999 }), error: null }],
      students: [{ data: [{ id: 'student-1', admission_no: 'ADM001', user: { full_name: 'Jane Doe' } }], error: null }],
      fee_balances: [{ data: [{ id: 'fb-1', amount_due: 5000, amount_paid: 0 }], error: null }],
      guardians: [{ data: [], error: null }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    const update = findWrite(writes, 'payment_paybill_transactions', 'update')!;
    expect(update.payload.reconciliation_notes).toBeNull();
  });

  it('suggests a fuzzy phone+amount match without auto-applying it (suggest-only)', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn({ bill_reference_number: 'UNKNOWNREF' }), error: null }],
      students: [
        { data: [{ id: 'student-other', admission_no: 'ZZZ999', user: { full_name: 'Someone Else' } }], error: null },
        { data: { admission_no: 'ADM002', user: { full_name: 'Bob Guardian Student' } }, error: null },
      ],
      guardians: [{ data: [{ student_id: 'student-2', user: { phone: '0712345678' } }], error: null }],
      fee_balances: [{ data: [{ amount_due: 5000, amount_paid: 0 }], error: null }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    expect(payments.creditFeeBalance).not.toHaveBeenCalled();

    const update = findWrite(writes, 'payment_paybill_transactions', 'update')!;
    expect(update.payload.reconciliation_status).toBeUndefined(); // status untouched — still PENDING
    expect(update.payload.reconciliation_notes).toContain('Suggested match: Bob Guardian Student (admission ADM002)');
  });

  it('is idempotent — never re-reconciles a transaction that is no longer PENDING', async () => {
    const writes: Write[] = [];
    const payments = makeFakePayments();
    const supabase = makeFakeSupabase({
      payment_paybill_transactions: [{ data: baseTxn({ reconciliation_status: 'MATCHED' }), error: null }],
    }, writes);

    const service = new PaybillReconciliationService(supabase, payments);
    await service.reconcile('txn-1');

    expect(writes).toHaveLength(0);
    expect(payments.creditFeeBalance).not.toHaveBeenCalled();
    expect(payments.queuePaymentReceiptNotifications).not.toHaveBeenCalled();
  });
});
