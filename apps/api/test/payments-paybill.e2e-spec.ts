// =============================================================================
// M-Pesa Paybill reconciliation + receipts (Phase 0, sub-sprint 2)
// =============================================================================
// Exercises the real HTTP surface: Daraja C2B validate/confirm callbacks,
// the reconciliation engine they trigger (fire-and-forget from confirm()),
// the paybill dashboard endpoints, and cross-tenant isolation across all of
// it. Uses the real Supabase project — creates isolated test data in
// beforeAll, fires real HTTP requests via supertest, deletes everything in
// afterAll. MPESA_DARAJA_MODE is unset in this environment (defaults to
// 'sandbox'), so MpesaDarajaService.isRequestFromSafaricom() is permissive
// and callbacks can be posted directly from the test runner's own loopback
// address — matches the AFRICASTALKING_MODE precedent from sub-sprint 1a.
//
// confirm() persists synchronously but fires reconciliation without
// awaiting it (deliberately — the parent-facing signal is Safaricom's own
// confirmation, not our matching outcome), so every test that needs the
// post-reconciliation state polls via waitForReconciliation() rather than
// asserting immediately after the HTTP response.
// =============================================================================

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import ws from 'ws';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const TIMEOUT = 30_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALTIME_OPTIONS = { transport: ws } as any;

describe('Payments: M-Pesa Paybill reconciliation (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;

  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  // Safaricom shortcodes are numeric strings — keep these test values well
  // away from anything a real school might register.
  const shortcodeA = `9${suffix.toString().slice(-6)}`;
  const shortcodeB = `8${suffix.toString().slice(-6)}`;
  const authUserIds: string[] = [];

  let adminAToken: string;
  let adminBToken: string;
  let adminAUserId: string;

  let studentHappyId: string;
  let studentDupeId: string;
  let studentA100Id: string;
  let studentB100Id: string;
  let studentBOtherId: string;

  async function seedAdmin(schoolId: string, label: string) {
    const email = `${label}-${suffix}@test-paybill.internal`;
    const password = `TestPass${suffix}!`;
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { school_id: schoolId, role: 'ADMIN' },
    });
    if (authErr) throw new Error(`Auth admin create failed (${label}): ${authErr.message}`);
    authUserIds.push(authData.user.id);

    const userId = randomUUID();
    await admin.from('users').upsert(
      { id: userId, school_id: schoolId, auth_id: authData.user.id, email, full_name: `Test ${label}`, role: 'ADMIN', updated_at: new Date().toISOString() },
      { onConflict: 'auth_id' },
    );
    const { data: row } = await admin.from('users').select('id').eq('auth_id', authData.user.id).single();

    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
    });
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`Sign-in failed (${label}): ${signInErr.message}`);
    return { userId: row?.id ?? userId, token: session.session!.access_token };
  }

  /**
   * A student that never signs in — an unlinked `auth_id` (random, never a
   * real Supabase auth user) is enough, same shortcut cross-tenant.e2e-spec.ts
   * uses for students that don't need their own token in a given test.
   */
  async function seedStudent(schoolId: string, label: string, admissionNo: string, amountDue: number) {
    const now = new Date().toISOString();
    const studentUserId = randomUUID();
    const studentId = randomUUID();
    await admin.from('users').insert({ id: studentUserId, school_id: schoolId, auth_id: randomUUID(), role: 'STUDENT', full_name: `Test Student ${label}`, updated_at: now });
    await admin.from('students').insert({ id: studentId, school_id: schoolId, user_id: studentUserId, admission_no: admissionNo, updated_at: now });
    await admin.from('fee_balances').insert({ id: randomUUID(), school_id: schoolId, student_id: studentId, amount_due: amountDue, updated_at: now });
    return { studentId, studentUserId };
  }

  function darajaPayload(overrides: Record<string, unknown> = {}) {
    return {
      TransactionType: 'Pay Bill',
      TransID: `T${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
      TransTime: '20260727120000',
      TransAmount: '5000',
      BusinessShortCode: shortcodeA,
      BillRefNumber: `PBHAPPY-${suffix}`,
      MSISDN: '254712345678',
      FirstName: 'Jane',
      LastName: 'Doe',
      ...overrides,
    };
  }

  async function waitForReconciliation(receiptNumber: string, timeoutMs = 8000): Promise<Record<string, any>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { data } = await admin.from('payment_paybill_transactions').select('*').eq('mpesa_receipt_number', receiptNumber).maybeSingle();
      if (data && data.reconciliation_status !== 'PENDING') return data;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out waiting for reconciliation of receipt ${receiptNumber}`);
  }

  /**
   * matchToStudent() writes reconciliation_status *before* it queues the two
   * receipt notifications (audit log insert, guardian lookup, then the
   * notification inserts all happen afterward in the same unawaited-by-the-
   * controller async chain) — so a test that only polls the status column
   * can race ahead of the notification writes. Poll for the notifications
   * themselves too rather than assuming they're already there.
   */
  async function waitForNotifications(recipientId: string, paymentId: string, timeoutMs = 8000): Promise<Array<{ type: string }>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { data } = await admin.from('notifications').select('type').eq('recipient_id', recipientId).contains('metadata', { paymentId });
      if (data && data.length >= 2) return data;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out waiting for notifications for payment ${paymentId}`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
    });

    const now = new Date().toISOString();
    const { error: schoolErr } = await admin.from('schools').insert([
      { id: schoolAId, name: `Paybill Test School A ${suffix}`, slug: `paybill-test-a-${suffix}`, paybill_shortcode: shortcodeA, updated_at: now },
      { id: schoolBId, name: `Paybill Test School B ${suffix}`, slug: `paybill-test-b-${suffix}`, paybill_shortcode: shortcodeB, updated_at: now },
    ]);
    if (schoolErr) throw new Error(`School seed failed: ${schoolErr.message}`);

    const adminA = await seedAdmin(schoolAId, 'admin-a');
    const adminB = await seedAdmin(schoolBId, 'admin-b');
    adminAToken = adminA.token;
    adminBToken = adminB.token;
    adminAUserId = adminA.userId;

    const happy = await seedStudent(schoolAId, 'happy', `PBHAPPY-${suffix}`, 5000);
    studentHappyId = happy.studentId;

    // A distinct student for the duplicate-callback test — it needs its own
    // untouched outstanding balance so a *second*, later test run against
    // the happy-path student (who the first test already pays off in full)
    // still reconciles to MATCHED rather than legitimately UNMATCHED
    // ("no outstanding balance to credit").
    const dupe = await seedStudent(schoolAId, 'dupe', `PBDUPE-${suffix}`, 5000);
    studentDupeId = dupe.studentId;

    // Same admission reference registered at both schools — the collision
    // test proves attribution happens via BusinessShortCode first, never a
    // raw cross-school admission-number lookup.
    const collA = await seedStudent(schoolAId, 'coll-a', `PBCOLL-${suffix}`, 4000);
    const collB = await seedStudent(schoolBId, 'coll-b', `PBCOLL-${suffix}`, 7000);
    studentA100Id = collA.studentId;
    studentB100Id = collB.studentId;

    const bOther = await seedStudent(schoolBId, 'b-other', `PBOTHER-${suffix}`, 3000);
    studentBOtherId = bOther.studentId;

    // A "guardian" for each of the two MATCHED-path students, reusing admin
    // A's own user id purely so the notification-queued assertions have a
    // real, queryable recipient — it doesn't need to be a distinct parent
    // account.
    await admin.from('guardians').insert([
      { id: randomUUID(), user_id: adminAUserId, student_id: studentHappyId, relationship: 'Parent', is_primary: true },
      { id: randomUUID(), user_id: adminAUserId, student_id: studentDupeId, relationship: 'Parent', is_primary: true },
    ]);
  }, TIMEOUT);

  afterAll(async () => {
    await admin.from('notifications').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('guardians').delete().in('student_id', [studentHappyId, studentDupeId]);
    await admin.from('payment_paybill_transactions').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('fee_balances').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('students').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('users').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    if (app) await app.close();
  }, TIMEOUT);

  it('persists a Paybill confirmation, reconciles it via BusinessShortCode + admission number, credits the fee balance, and queues both receipt notifications', async () => {
    const receiptNumber = `HAPPY${suffix}`;
    const payload = darajaPayload({ TransID: receiptNumber, TransAmount: '5000' });

    const validateRes = await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/validate').send(payload);
    expect(validateRes.status).toBe(200);
    expect(validateRes.body.ResultCode).toBe(0);

    const confirmRes = await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/confirm').send(payload);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.ResultCode).toBe(0);

    const txn = await waitForReconciliation(receiptNumber);
    expect(txn.reconciliation_status).toBe('MATCHED');
    expect(txn.matched_student_id).toBe(studentHappyId);
    expect(txn.school_id).toBe(schoolAId);

    const { data: balance } = await admin.from('fee_balances').select('amount_paid').eq('student_id', studentHappyId).single();
    expect(Number(balance?.amount_paid)).toBe(5000);

    const notifs = await waitForNotifications(adminAUserId, txn.id);
    expect(notifs.map((n) => n.type).sort()).toEqual(['PAYMENT_RECEIVED', 'RECEIPT_AVAILABLE']);

    const { data: audit } = await admin.from('audit_logs').select('metadata')
      .eq('entity_id', txn.id).eq('action', 'payment_paybill.reconciliation_transition').maybeSingle();
    expect(audit?.metadata).toMatchObject({ newStatus: 'MATCHED', studentId: studentHappyId });
  }, TIMEOUT);

  it('is idempotent on a duplicate confirmation callback — only one row persisted, notifications queued exactly once', async () => {
    const receiptNumber = `DUPE${suffix}`;
    const payload = darajaPayload({ TransID: receiptNumber, BillRefNumber: `PBDUPE-${suffix}`, TransAmount: '1000' });

    await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/confirm').send(payload).expect(200);
    const txn = await waitForReconciliation(receiptNumber);
    await waitForNotifications(adminAUserId, txn.id); // let the first reconciliation fully finish queueing before the duplicate lands

    const second = await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/confirm').send(payload);
    expect(second.status).toBe(200);
    expect(second.body.ResultCode).toBe(0);

    const { data: rows } = await admin.from('payment_paybill_transactions').select('id').eq('mpesa_receipt_number', receiptNumber);
    expect(rows).toHaveLength(1);

    const { data: notifs } = await admin.from('notifications').select('id').eq('recipient_id', adminAUserId).contains('metadata', { paymentId: txn.id });
    expect(notifs).toHaveLength(2); // PAYMENT_RECEIVED + RECEIPT_AVAILABLE, not doubled
  }, TIMEOUT);

  it('rejects an unrecognized Paybill shortcode at validation, before any persistence', async () => {
    const receiptNumber = `UNREG${suffix}`;
    const payload = darajaPayload({ BusinessShortCode: '000000', TransID: receiptNumber });

    const res = await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/validate').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.ResultCode).toBe('C2B00015');

    const { data: rows } = await admin.from('payment_paybill_transactions').select('id').eq('mpesa_receipt_number', receiptNumber);
    expect(rows ?? []).toHaveLength(0);
  }, TIMEOUT);

  it('rejects a malformed confirmation body (missing TransID) without persisting or crashing', async () => {
    const payload = darajaPayload();
    delete (payload as Record<string, unknown>).TransID;

    const res = await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/confirm').send(payload);
    expect(res.status).toBe(200); // always 200 — a non-200 makes Safaricom retry the same payment
    expect(res.body.ResultCode).not.toBe(0);
  }, TIMEOUT);

  it('attributes an identical admission-number reference to the correct school via BusinessShortCode, never cross-school', async () => {
    const receiptA = `COLLA${suffix}`;
    const receiptB = `COLLB${suffix}`;

    await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/confirm')
      .send(darajaPayload({ TransID: receiptA, BusinessShortCode: shortcodeA, BillRefNumber: `PBCOLL-${suffix}`, TransAmount: '4000' }))
      .expect(200);
    await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/confirm')
      .send(darajaPayload({ TransID: receiptB, BusinessShortCode: shortcodeB, BillRefNumber: `PBCOLL-${suffix}`, TransAmount: '7000' }))
      .expect(200);

    const txnA = await waitForReconciliation(receiptA);
    const txnB = await waitForReconciliation(receiptB);

    expect(txnA.reconciliation_status).toBe('MATCHED');
    expect(txnA.matched_student_id).toBe(studentA100Id);
    expect(txnB.reconciliation_status).toBe('MATCHED');
    expect(txnB.matched_student_id).toBe(studentB100Id);
  }, TIMEOUT);

  it("never surfaces School B's unmatched Paybill transactions in School A's admin queue", async () => {
    const receiptB = `UNMB${suffix}`;
    await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/confirm')
      .send(darajaPayload({ TransID: receiptB, BusinessShortCode: shortcodeB, BillRefNumber: 'NO-SUCH-REF', TransAmount: '999' }))
      .expect(200);
    await waitForReconciliation(receiptB);

    const res = await request(app.getHttpServer())
      .get('/payments/paybill/unmatched')
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(res.status).toBe(200);
    const receiptNumbers = (res.body as Array<{ mpesa_receipt_number: string }>).map((r) => r.mpesa_receipt_number);
    expect(receiptNumbers).not.toContain(receiptB);
  }, TIMEOUT);

  it('never lets a School A admin match a School A transaction to a School B student', async () => {
    const receiptNumber = `BLOCK${suffix}`;
    await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/confirm')
      .send(darajaPayload({ TransID: receiptNumber, BusinessShortCode: shortcodeA, BillRefNumber: 'NO-SUCH-REF-EITHER', TransAmount: '999' }))
      .expect(200);
    const txn = await waitForReconciliation(receiptNumber);
    expect(txn.reconciliation_status).toBe('UNMATCHED');

    const res = await request(app.getHttpServer())
      .post(`/payments/paybill/${txn.id}/match`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ studentId: studentBOtherId });
    expect(res.status).toBe(404);

    const { data: unchanged } = await admin.from('payment_paybill_transactions').select('reconciliation_status').eq('id', txn.id).single();
    expect(unchanged?.reconciliation_status).toBe('UNMATCHED');
  }, TIMEOUT);

  it('blocks cross-school access to a Paybill receipt even with a valid admin session and the exact payment id', async () => {
    const receiptNumber = `RCPT${suffix}`;
    await request(app.getHttpServer()).post('/payments/webhook/mpesa/paybill/confirm')
      .send(darajaPayload({ TransID: receiptNumber, BusinessShortCode: shortcodeA, BillRefNumber: `PBHAPPY-${suffix}`, TransAmount: '500' }))
      .expect(200);
    const txn = await waitForReconciliation(receiptNumber);

    const ownRes = await request(app.getHttpServer())
      .get(`/payments/receipts/${txn.id}?type=paybill`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(ownRes.status).toBe(200);
    expect(ownRes.headers['content-type']).toContain('application/pdf');

    const crossRes = await request(app.getHttpServer())
      .get(`/payments/receipts/${txn.id}?type=paybill`)
      .set('Authorization', `Bearer ${adminBToken}`);
    expect(crossRes.status).toBe(403);
  }, TIMEOUT);
});
