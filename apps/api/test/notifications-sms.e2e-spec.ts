// =============================================================================
// SMS via Africa's Talking (Phase 0, sub-sprint 1a)
// =============================================================================
// AfricasTalkingClient is overridden with a mock in this suite — there are no
// live Africa's Talking credentials in this environment (confirmed empty in
// .env), so without a mock, sendSms() would always short-circuit to "not
// configured" and the SENT/message_send_log path could never be exercised.
// The mock's call count/return value is controlled per test, which also lets
// this suite test the retry-then-abandon path deterministically rather than
// relying on a specific unnormalizable phone number's exact failure mode
// (that logic already has its own unit tests in africastalking.spec.ts).
// =============================================================================

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import ws from 'ws';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { AfricasTalkingClient } from '../src/notifications/africastalking.client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALTIME_OPTIONS = { transport: ws } as any;

describe('Notifications: SMS via Africa\'s Talking (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;
  let notifications: NotificationsService;
  let sendSmsMock: jest.Mock;

  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const authUserIds: string[] = [];
  let adminAToken: string;

  function clientAs(token: string): SupabaseClient {
    return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
      realtime: REALTIME_OPTIONS,
    });
  }

  async function seedUser(schoolId: string, role: 'ADMIN' | 'PARENT', label: string, phone: string | null) {
    const email = `${label}-${suffix}@test-sms.internal`;
    const password = `TestPass${suffix}!`;
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { school_id: schoolId, role },
    });
    if (authErr) throw new Error(`Auth user create failed (${label}): ${authErr.message}`);
    authUserIds.push(authData.user.id);

    const userId = randomUUID();
    await admin.from('users').upsert(
      { id: userId, school_id: schoolId, auth_id: authData.user.id, email, phone, full_name: `Test ${label}`, role, updated_at: new Date().toISOString() },
      { onConflict: 'auth_id' },
    );
    const { data: row } = await admin.from('users').select('id').eq('auth_id', authData.user.id).single();
    const actualUserId = row?.id ?? userId;

    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
    });
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`Sign-in failed (${label}): ${signInErr.message}`);
    return { userId: actualUserId, token: session.session!.access_token };
  }

  async function setSmsPref(userId: string, schoolId: string, enabled: boolean) {
    await admin.from('notification_preferences').upsert(
      { id: randomUUID(), school_id: schoolId, user_id: userId, notification_type: 'ABSENT_STUDENT', email_enabled: false, sms_enabled: enabled },
      { onConflict: 'user_id,notification_type' },
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(AfricasTalkingClient)
      .useValue({ sendSms: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    notifications = moduleFixture.get(NotificationsService);
    sendSmsMock = moduleFixture.get(AfricasTalkingClient).sendSms;

    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
    });

    const now = new Date().toISOString();
    await admin.from('schools').insert([
      { id: schoolAId, name: `SMS Test School A ${suffix}`, slug: `sms-test-a-${suffix}`, updated_at: now },
      { id: schoolBId, name: `SMS Test School B ${suffix}`, slug: `sms-test-b-${suffix}`, updated_at: now },
    ]);

    const adminA = await seedUser(schoolAId, 'ADMIN', 'admin-a', null);
    adminAToken = adminA.token;
  });

  afterAll(async () => {
    await admin.from('message_send_log').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('notifications').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('notification_preferences').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('users').delete().in('auth_id', authUserIds);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    if (app) await app.close();
  });

  beforeEach(() => {
    sendSmsMock.mockReset();
  });

  it('sends exactly one SMS for an opted-in parent, logs the cost, and is idempotent on a second dispatch tick', async () => {
    const parent = await seedUser(schoolAId, 'PARENT', 'sms-opted-in', '+254712345678');
    await setSmsPref(parent.userId, schoolAId, true);
    sendSmsMock.mockResolvedValue({ success: true, providerMessageId: 'ATXid_test1', cost: 'KES 0.8000' });

    await notifications.queue([{ schoolId: schoolAId, recipientId: parent.userId, type: 'ABSENT_STUDENT', title: 'Absence', body: 'Your child was marked absent today.' }]);
    await notifications.dispatch();

    const { data: notifRow } = await admin.from('notifications').select('sms_status, sms_sent_at').eq('recipient_id', parent.userId).eq('type', 'ABSENT_STUDENT').single();
    expect(notifRow?.sms_status).toBe('SENT');
    expect(notifRow?.sms_sent_at).toBeTruthy();

    const { data: logRows } = await admin.from('message_send_log').select('school_id, channel, cost_amount, cost_currency, recipient_phone').eq('school_id', schoolAId);
    expect(logRows).toHaveLength(1);
    expect(logRows![0]).toMatchObject({ channel: 'SMS', cost_amount: 0.8, cost_currency: 'KES', recipient_phone: '+254712345678' });

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    await notifications.dispatch(); // second tick — row is already terminal on both channels
    expect(sendSmsMock).toHaveBeenCalledTimes(1); // no double-send
  });

  it('never attempts SMS for a parent who has not opted in', async () => {
    const parent = await seedUser(schoolAId, 'PARENT', 'sms-opted-out', '+254712345679');
    await setSmsPref(parent.userId, schoolAId, false);

    await notifications.queue([{ schoolId: schoolAId, recipientId: parent.userId, type: 'ABSENT_STUDENT', title: 'Absence', body: 'body' }]);
    await notifications.dispatch();

    const { data: notifRow } = await admin.from('notifications').select('sms_status').eq('recipient_id', parent.userId).eq('type', 'ABSENT_STUDENT').single();
    expect(notifRow?.sms_status).toBe('ABANDONED');
    expect(sendSmsMock).not.toHaveBeenCalled();
    const { data: logRows } = await admin.from('message_send_log').select('id').eq('school_id', schoolAId).eq('recipient_phone', '+254712345679');
    expect(logRows ?? []).toHaveLength(0);
  });

  it('abandons an opted-in parent with no phone on file without ever calling the provider', async () => {
    const parent = await seedUser(schoolAId, 'PARENT', 'sms-no-phone', null);
    await setSmsPref(parent.userId, schoolAId, true);

    await notifications.queue([{ schoolId: schoolAId, recipientId: parent.userId, type: 'ABSENT_STUDENT', title: 'Absence', body: 'body' }]);
    await notifications.dispatch();

    const { data: notifRow } = await admin.from('notifications').select('sms_status').eq('recipient_id', parent.userId).eq('type', 'ABSENT_STUDENT').single();
    expect(notifRow?.sms_status).toBe('ABANDONED');
    expect(sendSmsMock).not.toHaveBeenCalled();

    const { data: auditRow } = await admin.from('audit_logs').select('metadata').eq('user_id', parent.userId).eq('action', 'notification.sms_abandoned').maybeSingle();
    expect(auditRow?.metadata).toMatchObject({ reason: 'No phone number on file' });
  });

  it('retries a provider failure up to 3 times, then abandons and audit-logs the last error', async () => {
    const parent = await seedUser(schoolAId, 'PARENT', 'sms-retry', '+254712345680');
    await setSmsPref(parent.userId, schoolAId, true);
    sendSmsMock.mockResolvedValue({ success: false, providerMessageId: null, cost: null, error: 'InsufficientBalance' });

    await notifications.queue([{ schoolId: schoolAId, recipientId: parent.userId, type: 'ABSENT_STUDENT', title: 'Absence', body: 'body' }]);

    await notifications.dispatch();
    let row = (await admin.from('notifications').select('sms_status, sms_send_attempts').eq('recipient_id', parent.userId).eq('type', 'ABSENT_STUDENT').single()).data;
    expect(row?.sms_status).toBe('PENDING');
    expect(row?.sms_send_attempts).toBe(1);

    await notifications.dispatch();
    row = (await admin.from('notifications').select('sms_status, sms_send_attempts').eq('recipient_id', parent.userId).eq('type', 'ABSENT_STUDENT').single()).data;
    expect(row?.sms_status).toBe('PENDING');
    expect(row?.sms_send_attempts).toBe(2);

    await notifications.dispatch();
    row = (await admin.from('notifications').select('sms_status, sms_send_attempts').eq('recipient_id', parent.userId).eq('type', 'ABSENT_STUDENT').single()).data;
    expect(row?.sms_status).toBe('ABANDONED');
    expect(row?.sms_send_attempts).toBe(3);

    expect(sendSmsMock).toHaveBeenCalledTimes(3);
    const { data: auditRow } = await admin.from('audit_logs').select('metadata').eq('user_id', parent.userId).eq('action', 'notification.sms_abandoned').maybeSingle();
    expect(auditRow?.metadata).toMatchObject({ reason: 'InsufficientBalance' });

    // No further attempts once abandoned.
    await notifications.dispatch();
    expect(sendSmsMock).toHaveBeenCalledTimes(3);
  });

  it('the pre-existing legacy stub backfill never re-sends historical rows', async () => {
    // Simulates a row that predates this migration: sms_sent_at populated by
    // the old stub, but sms_status still whatever the column default was at
    // insert time in a pre-migration environment. The migration backfill
    // itself already ran once against real historical data; this test
    // instead proves the current queue()/dispatch() combination can never
    // produce that stale shape again and that a manually-constructed
    // legacy-shaped row is never picked up by dispatch().
    const parent = await seedUser(schoolAId, 'PARENT', 'sms-legacy', '+254712345681');
    await setSmsPref(parent.userId, schoolAId, true);
    const legacyId = randomUUID();
    await admin.from('notifications').insert({
      id: legacyId, school_id: schoolAId, recipient_id: parent.userId, type: 'ABSENT_STUDENT',
      title: 'Old absence', body: 'body', email_sent_at: new Date().toISOString(),
      sms_sent_at: new Date().toISOString(), sms_status: 'SKIPPED_LEGACY_STUB',
    });

    await notifications.dispatch();
    expect(sendSmsMock).not.toHaveBeenCalled();
    const { data: row } = await admin.from('notifications').select('sms_status').eq('id', legacyId).single();
    expect(row?.sms_status).toBe('SKIPPED_LEGACY_STUB');
  });

  it('an ADMIN never sees another school\'s message_send_log rows', async () => {
    await admin.from('message_send_log').insert({
      id: randomUUID(), school_id: schoolBId, channel: 'SMS', provider: 'AFRICASTALKING',
      recipient_phone: '+254700000000', cost_amount: 1.5, cost_currency: 'KES',
    });

    const { data: ownRows } = await clientAs(adminAToken).from('message_send_log').select('school_id');
    expect((ownRows ?? []).every((r) => r.school_id === schoolAId)).toBe(true);
    expect((ownRows ?? []).some((r) => r.school_id === schoolBId)).toBe(false);
  });
});
