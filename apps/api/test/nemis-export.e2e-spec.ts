// =============================================================================
// NEMIS export (Phase 0, sub-sprint 4)
// =============================================================================
// Uses the real Supabase project — creates isolated test data in beforeAll,
// fires real HTTP requests via supertest, deletes everything in afterAll.
// The endpoint takes no school_id param at all (it's implicitly the
// caller's own school via RLS `forUser(token)`), so there's no "crafted ID"
// to probe the way other cross-tenant tests do — the real isolation
// guarantee here is simply that each admin's export only ever contains
// their own school's students, proven directly rather than via an attack
// attempt that doesn't apply to this endpoint's shape.
// =============================================================================

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import ws from 'ws';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const TIMEOUT = 60_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALTIME_OPTIONS = { transport: ws } as any;

describe('Students: NEMIS export (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;

  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const schoolEmptyId = randomUUID();
  const authUserIds: string[] = [];

  let adminAToken: string;
  let adminBToken: string;
  let adminEmptyToken: string;

  async function seedAdmin(schoolId: string, label: string) {
    const email = `${label}-${suffix}@test-nemis.internal`;
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
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
    });
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`Sign-in failed (${label}): ${signInErr.message}`);
    await request(app.getHttpServer())
      .post('/auth/events')
      .set('Authorization', `Bearer ${session.session!.access_token}`)
      .send({ action: 'auth.login' });
    return session.session!.access_token;
  }

  /** A student that never signs in — an unlinked auth_id is enough, matching the payments-paybill e2e spec's own shortcut. */
  function studentRow(schoolId: string, admissionNo: string, fullName: string, isActive = true) {
    const now = new Date().toISOString();
    const userId = randomUUID();
    const studentId = randomUUID();
    return {
      user: { id: userId, school_id: schoolId, auth_id: randomUUID(), role: 'STUDENT', full_name: fullName, is_active: isActive, updated_at: now },
      student: { id: studentId, school_id: schoolId, user_id: userId, admission_no: admissionNo, gender: 'FEMALE', county: 'Nairobi', is_active: isActive, updated_at: now },
    };
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
    await admin.from('schools').insert([
      { id: schoolAId, name: `NEMIS Test School A ${suffix}`, slug: `nemis-test-a-${suffix}`, updated_at: now },
      { id: schoolBId, name: `NEMIS Test School B ${suffix}`, slug: `nemis-test-b-${suffix}`, updated_at: now },
      { id: schoolEmptyId, name: `NEMIS Test School Empty ${suffix}`, slug: `nemis-test-empty-${suffix}`, updated_at: now },
    ]);

    adminAToken = await seedAdmin(schoolAId, 'admin-a');
    adminBToken = await seedAdmin(schoolBId, 'admin-b');
    adminEmptyToken = await seedAdmin(schoolEmptyId, 'admin-empty');

    const rowA1 = studentRow(schoolAId, `NEMISA1-${suffix}`, 'Alice A Wanjiru');
    const rowA2Inactive = studentRow(schoolAId, `NEMISA2-${suffix}`, 'Inactive Student', false);
    const rowB1 = studentRow(schoolBId, `NEMISB1-${suffix}`, 'Bob B Otieno');

    await admin.from('users').insert([rowA1.user, rowA2Inactive.user, rowB1.user]);
    await admin.from('students').insert([rowA1.student, rowA2Inactive.student, rowB1.student]);

    // A guardian for the one active School A student, to prove the guardian join works.
    const guardianUserId = randomUUID();
    await admin.from('users').insert({ id: guardianUserId, school_id: schoolAId, auth_id: randomUUID(), role: 'PARENT', full_name: 'Alice Guardian', phone: '+254700000001', updated_at: now });
    await admin.from('guardians').insert({ id: randomUUID(), user_id: guardianUserId, student_id: rowA1.student.id, relationship: 'Mother', is_primary: true });
  }, TIMEOUT);

  afterAll(async () => {
    await admin.from('guardians').delete().in('student_id',
      (await admin.from('students').select('id').in('school_id', [schoolAId, schoolBId])).data?.map((r) => r.id) ?? [],
    );
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId, schoolEmptyId]);
    await admin.from('students').delete().in('school_id', [schoolAId, schoolBId, schoolEmptyId]);
    await admin.from('users').delete().in('school_id', [schoolAId, schoolBId, schoolEmptyId]);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId, schoolEmptyId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    if (app) await app.close();
  }, TIMEOUT);

  it("exports only School A's own active students — never School B's, never an inactive School A student", async () => {
    const res = await request(app.getHttpServer())
      .get('/students/nemis-export?format=csv')
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.format).toBe('csv');
    const csv = res.body.data as string;
    expect(csv).toContain(`NEMISA1-${suffix}`);
    expect(csv).not.toContain(`NEMISA2-${suffix}`); // inactive — excluded
    expect(csv).not.toContain(`NEMISB1-${suffix}`); // School B — never visible to School A's admin
    expect(csv).toContain('Alice'); // GivenName from the split heuristic
    expect(csv).toContain('Alice Guardian'); // guardian join resolved
    expect(csv).toContain('+254700000001');
  }, TIMEOUT);

  it("School B's admin export never contains School A's students", async () => {
    const res = await request(app.getHttpServer())
      .get('/students/nemis-export?format=csv')
      .set('Authorization', `Bearer ${adminBToken}`);
    expect(res.status).toBe(200);
    const csv = res.body.data as string;
    expect(csv).toContain(`NEMISB1-${suffix}`);
    expect(csv).not.toContain(`NEMISA1-${suffix}`);
    expect(csv).not.toContain(`NEMISA2-${suffix}`);
  }, TIMEOUT);

  it('produces a valid, non-corrupt XLSX file', async () => {
    const res = await request(app.getHttpServer())
      .get('/students/nemis-export?format=xlsx')
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.format).toBe('xlsx');
    const buf = Buffer.from(res.body.data as string, 'base64');
    expect(buf.subarray(0, 2).toString('utf8')).toBe('PK'); // xlsx is a zip archive
  }, TIMEOUT);

  it('an empty school produces a valid header-only CSV, not an error', async () => {
    const res = await request(app.getHttpServer())
      .get('/students/nemis-export?format=csv')
      .set('Authorization', `Bearer ${adminEmptyToken}`);
    expect(res.status).toBe(200);
    const lines = (res.body.data as string).split('\n');
    expect(lines).toHaveLength(1); // header row only
    expect(lines[0]).toContain('AdmissionNo');
  }, TIMEOUT);

  it('rejects an unauthenticated request', async () => {
    const res = await request(app.getHttpServer()).get('/students/nemis-export?format=csv');
    expect(res.status).toBe(401);
  }, TIMEOUT);

  it('exports 500+ students without corruption (both formats)', async () => {
    const bulkSchoolId = randomUUID();
    const now = new Date().toISOString();
    await admin.from('schools').insert({ id: bulkSchoolId, name: `NEMIS Bulk Test ${suffix}`, slug: `nemis-bulk-${suffix}`, updated_at: now });
    const bulkAdminToken = await seedAdmin(bulkSchoolId, 'admin-bulk');

    const rows = Array.from({ length: 520 }, (_, i) => studentRow(bulkSchoolId, `BULK${i}-${suffix}`, `Bulk Student ${i}`));
    // Chunked inserts — a single 520-row payload risks hitting request-size limits.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await admin.from('users').insert(chunk.map((r) => r.user));
      await admin.from('students').insert(chunk.map((r) => r.student));
    }

    try {
      const csvRes = await request(app.getHttpServer())
        .get('/students/nemis-export?format=csv')
        .set('Authorization', `Bearer ${bulkAdminToken}`);
      expect(csvRes.status).toBe(200);
      const csvLines = (csvRes.body.data as string).split('\n');
      expect(csvLines).toHaveLength(521); // header + 520 rows
      expect(csvLines.every((l) => l.split(',').length === csvLines[0]!.split(',').length)).toBe(true); // no corrupted/short rows

      const xlsxRes = await request(app.getHttpServer())
        .get('/students/nemis-export?format=xlsx')
        .set('Authorization', `Bearer ${bulkAdminToken}`);
      expect(xlsxRes.status).toBe(200);
      const buf = Buffer.from(xlsxRes.body.data as string, 'base64');
      expect(buf.subarray(0, 2).toString('utf8')).toBe('PK');
      expect(buf.length).toBeGreaterThan(1000); // a real, non-trivial file, not a truncated stub
    } finally {
      await admin.from('students').delete().eq('school_id', bulkSchoolId);
      await admin.from('users').delete().eq('school_id', bulkSchoolId);
      await admin.from('schools').delete().eq('id', bulkSchoolId);
    }
  }, TIMEOUT);
});
