// =============================================================================
// Unified dashboard feed (GET /dashboard-feed) — Bucket 1, PR 1
// =============================================================================
// Focuses on what's genuinely new here and needs real Supabase/RLS behavior
// to prove: the new Admin reminder sources (permission-slip gaps, unmatched
// Paybill payments) and their cross-tenant isolation, the Parent fee-balance
// reminder, and the unread-count/mark-read endpoints this replaces
// NotificationsService.unreadCount() with. Per-role query-branch logic
// (STUDENT/PARENT/TEACHER reminder building, badge computation) already has
// unit coverage in notifications-aggregation.service.spec.ts against a
// mocked Supabase client — this file is deliberately not a re-test of that.
// =============================================================================

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import ws from 'ws';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALTIME_OPTIONS = { transport: ws } as any;

describe('Dashboard feed (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;

  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const authUserIds: string[] = [];

  let adminAToken: string;
  let adminBToken: string;
  let parentAToken: string;
  let parentAUserId: string;
  let childId: string;

  async function seedUser(schoolId: string, role: 'ADMIN' | 'PARENT', label: string) {
    const email = `${label}-${suffix}@test-feed.internal`;
    const password = `TestPass${suffix}!`;
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { school_id: schoolId, role },
    });
    if (authErr) throw new Error(`Auth user create failed (${label}): ${authErr.message}`);
    authUserIds.push(authData.user.id);

    const userId = randomUUID();
    await admin.from('users').upsert(
      { id: userId, school_id: schoolId, auth_id: authData.user.id, email, full_name: `Test ${label}`, role, updated_at: new Date().toISOString() },
      { onConflict: 'auth_id' },
    );
    const { data: row } = await admin.from('users').select('id').eq('auth_id', authData.user.id).single();
    const actualUserId = row?.id ?? userId;

    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
    });
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`Sign-in failed (${label}): ${signInErr.message}`);
    await request(app.getHttpServer())
      .post('/auth/events')
      .set('Authorization', `Bearer ${session.session!.access_token}`)
      .send({ action: 'auth.login' });
    return { userId: actualUserId, token: session.session!.access_token };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
    });

    const now = new Date().toISOString();
    await admin.from('schools').insert([
      { id: schoolAId, name: `Feed Test School A ${suffix}`, slug: `feed-test-a-${suffix}`, updated_at: now },
      { id: schoolBId, name: `Feed Test School B ${suffix}`, slug: `feed-test-b-${suffix}`, updated_at: now },
    ]);

    const adminA = await seedUser(schoolAId, 'ADMIN', 'admin-a');
    adminAToken = adminA.token;
    const adminB = await seedUser(schoolBId, 'ADMIN', 'admin-b');
    adminBToken = adminB.token;
    const parentA = await seedUser(schoolAId, 'PARENT', 'parent-a');
    parentAToken = parentA.token;
    parentAUserId = parentA.userId;

    // A child for parent A, no class (SCHOOL_WIDE slip test doesn't need one).
    const childUserId = randomUUID();
    await admin.from('users').insert({
      id: childUserId, school_id: schoolAId, auth_id: randomUUID(), email: `child-${suffix}@test-feed.internal`,
      full_name: 'Test Child', role: 'STUDENT', updated_at: now,
    });
    childId = randomUUID();
    await admin.from('students').insert({
      id: childId, school_id: schoolAId, user_id: childUserId, admission_no: `FEED-${suffix}`, updated_at: now,
    });
    await admin.from('guardians').insert({ id: randomUUID(), user_id: parentAUserId, student_id: childId, relationship: 'PARENT' });
  });

  // getFeed() caches per-user for 60s (matches the production TTL) — every
  // fixture a test expects to see must exist BEFORE that user's first
  // GET /dashboard-feed call anywhere in this file, or a later test's fresh
  // seed data will silently be served the earlier test's stale cached feed
  // instead. Seeding everything here, before any test runs, sidesteps that
  // entirely rather than fighting cache ordering test-by-test.
  let slipId: string;
  let paybillTxnId: string;
  let feeBalanceId: string;

  beforeAll(async () => {
    slipId = randomUUID();
    await admin.from('permission_slips').insert({
      id: slipId, school_id: schoolAId, created_by_id: parentAUserId, title: 'Field trip consent',
      audience: 'SCHOOL_WIDE', one_time_code: `OTC-${suffix}`,
    });

    paybillTxnId = randomUUID();
    await admin.from('payment_paybill_transactions').insert({
      id: paybillTxnId, school_id: schoolAId, mpesa_receipt_number: `RCPT-${suffix}`, transaction_type: 'Pay Bill',
      transaction_time: new Date().toISOString(), amount: 2500, msisdn: '254712345690',
      bill_reference_number: `NO-MATCH-${suffix}`, business_shortcode: '999999', reconciliation_status: 'UNMATCHED',
      raw_callback: {},
    });

    feeBalanceId = randomUUID();
    await admin.from('fee_balances').insert({
      id: feeBalanceId, school_id: schoolAId, student_id: childId, amount_due: 8000, amount_paid: 3000,
      currency: 'KES', updated_at: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    await admin.from('payment_paybill_transactions').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('permission_slip_responses').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('permission_slips').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('fee_balances').delete().eq('student_id', childId);
    await admin.from('guardians').delete().eq('student_id', childId);
    await admin.from('students').delete().eq('id', childId);
    await admin.from('notifications').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('users').delete().in('auth_id', authUserIds);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    if (app) await app.close();
  });

  it('Admin sees permission-slip-gap and unmatched-Paybill reminders for their own school, never for another school', async () => {
    // This is deliberately the first GET /dashboard-feed call for either
    // admin token in the whole file — both fixtures were seeded in
    // beforeAll, before any earlier test could have cached a stale feed for
    // either user (getFeed() caches per-user for 60s, matching production).
    const resA = await request(app.getHttpServer()).get('/dashboard-feed').set('Authorization', `Bearer ${adminAToken}`).expect(200);
    const slipReminder = resA.body.reminders.find((r: { id: string }) => r.id === `slip-gap:${slipId}`);
    expect(slipReminder).toBeDefined();
    expect(slipReminder.subtitle).toMatch(/haven't responded/);
    const paybillReminder = resA.body.reminders.find((r: { id: string }) => r.id === `paybill-unmatched:${paybillTxnId}`);
    expect(paybillReminder).toBeDefined();
    expect(paybillReminder.badge).toBe('Awaiting your action');

    const resB = await request(app.getHttpServer()).get('/dashboard-feed').set('Authorization', `Bearer ${adminBToken}`).expect(200);
    expect(resB.body.reminders.find((r: { id: string }) => r.id === `slip-gap:${slipId}`)).toBeUndefined();
    expect(resB.body.reminders.find((r: { id: string }) => r.id === `paybill-unmatched:${paybillTxnId}`)).toBeUndefined();
  });

  it('Parent sees an outstanding fee-balance reminder for their own child', async () => {
    // Also the first call for parentAToken — fee balance was seeded in beforeAll.
    const res = await request(app.getHttpServer()).get('/dashboard-feed').set('Authorization', `Bearer ${parentAToken}`).expect(200);
    const feeReminder = res.body.reminders.find((r: { id: string }) => r.id === `fee:${childId}`);
    expect(feeReminder).toBeDefined();
    expect(feeReminder.title).toContain('5000.00');
  });

  it('unread-count matches the unread/outstanding total across the full feed', async () => {
    // Internal-consistency check, not a freshness check — both endpoints
    // independently call getFeed() so they agree regardless of cache state.
    const feedRes = await request(app.getHttpServer()).get('/dashboard-feed').set('Authorization', `Bearer ${adminAToken}`).expect(200);
    const expected = feedRes.body.alerts.filter((a: { isRead: boolean }) => !a.isRead).length
      + feedRes.body.conversations.length + feedRes.body.reminders.length;

    const countRes = await request(app.getHttpServer()).get('/dashboard-feed/unread-count').set('Authorization', `Bearer ${adminAToken}`).expect(200);
    expect(countRes.body.count).toBe(expected);
  });

  it('PATCH /dashboard-feed/read marks a notification read and the change is reflected on the next fetch (cache invalidated)', async () => {
    // A dedicated, never-before-fetched user — parentAToken's feed was
    // already cached by the fee-balance test above, so reusing it here would
    // hide a real cache-invalidation bug behind a false pass (the "before"
    // read could come back stale for an unrelated reason and still look
    // like it worked, or a genuinely broken invalidation could go
    // undetected if the "after" read also happened to hit a stale cache
    // that predates this test's own insert). A fresh user's first-ever
    // fetch has no such ambiguity.
    const freshParent = await seedUser(schoolAId, 'PARENT', 'parent-markread');
    const notifId = randomUUID();
    await admin.from('notifications').insert({
      id: notifId, school_id: schoolAId, recipient_id: freshParent.userId, type: 'NEW_ANNOUNCEMENT',
      title: 'Test notice', body: 'Body', is_read: false, email_sent_at: new Date().toISOString(), sms_status: 'ABANDONED',
    });

    const before = await request(app.getHttpServer()).get('/dashboard-feed').set('Authorization', `Bearer ${freshParent.token}`).expect(200);
    expect(before.body.alerts.find((a: { id: string }) => a.id === notifId)?.isRead).toBe(false);

    await request(app.getHttpServer())
      .patch('/dashboard-feed/read')
      .set('Authorization', `Bearer ${freshParent.token}`)
      .send({ ids: [notifId] })
      .expect(200);

    const after = await request(app.getHttpServer()).get('/dashboard-feed').set('Authorization', `Bearer ${freshParent.token}`).expect(200);
    expect(after.body.alerts.find((a: { id: string }) => a.id === notifId)?.isRead).toBe(true);
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/dashboard-feed').expect(401);
  });
});
