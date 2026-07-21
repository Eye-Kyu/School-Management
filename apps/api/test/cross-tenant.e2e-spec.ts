// =============================================================================
// Cross-tenant isolation test
// Verifies that RLS prevents School A's users from seeing School B's data
// through any API route, even when they know a resource's UUID.
//
// Uses the real Supabase project — creates isolated test data in beforeAll,
// fires real HTTP requests, deletes everything in afterAll.
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
// Node.js < 22 has no native WebSocket global, which @supabase/realtime-js
// requires at construction time — see SupabaseService for the full rationale.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALTIME_OPTIONS = { transport: ws } as any;

describe('Cross-tenant isolation (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;

  // Test school IDs
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const suffix = Date.now();

  // Auth user IDs — collected for cleanup
  const authUserIds: string[] = [];

  // Public resource IDs seeded in each school
  let classAId: string;
  let classBId: string;
  let studentAId: string;
  let studentBId: string;
  let announcementAId: string;
  let announcementBId: string;
  let attendanceAId: string;
  let attendanceBId: string;
  let feeAId: string;
  let feeBId: string;
  let teacherATeacherId: string;
  let teacherBTeacherId: string;
  let conversationAId: string;
  let conversationBId: string;
  let documentAId: string;
  let documentBId: string;
  let quizAId: string;
  let quizBId: string;

  // JWT access tokens for each school's admin
  let tokenA: string;
  let tokenB: string;
  // Non-staff token, used for the report-card-email role check
  let tokenStudentA: string;
  // Platform-level token, used for module-toggle tests
  let tokenSuperAdmin: string;
  // Teacher tokens, used for RLS-only module-toggle tests (quizzes has no NestJS route)
  let tokenTeacherA: string;
  let tokenTeacherB: string;

  /** A Supabase client that sends the given JWT — for testing RLS directly, bypassing Nest entirely. */
  function clientAs(token: string): SupabaseClient {
    return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
      realtime: REALTIME_OPTIONS,
    });
  }

  beforeAll(async () => {
    // 1. Bootstrap NestJS app (loads .env via ConfigModule.forRoot)
    // PrismaService is mocked — none of the tested routes use Prisma, and the
    // pooler DATABASE_URL is incompatible with Prisma's connection mode in tests.
    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
        .compile();
      app = moduleFixture.createNestApplication();
      await app.init();
    } catch (err) {
      // Surface the REAL cause loudly — without this, a compile/init failure
      // here just leaves `app`/`admin` undefined, and afterAll's cleanup
      // throws a second, more confusing "Cannot read properties of
      // undefined" error that buries whatever actually went wrong.
      // eslint-disable-next-line no-console
      console.error('[cross-tenant e2e] FATAL: app bootstrap failed:', err);
      throw err;
    }

    // 2. Service-role client for seeding and cleanup (bypasses RLS)
    admin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS },
    );

    // 3. Create two test schools
    const now = new Date().toISOString();
    const { error: schoolErr } = await admin.from('schools').insert([
      { id: schoolAId, name: `Test School Alpha ${suffix}`, slug: `test-alpha-${suffix}`, updated_at: now },
      { id: schoolBId, name: `Test School Beta ${suffix}`,  slug: `test-beta-${suffix}`,  updated_at: now },
    ]);
    if (schoolErr) throw new Error(`School insert failed: ${schoolErr.message}`);

    // 4. Helper: create an auth user + public users row, return { authId, userId, token }
    async function seedUser(schoolId: string | null, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'SUPER_ADMIN', label: string) {
      const email = `${label}-${suffix}@test-isolation.internal`;
      const password = `TestPass${suffix}!`;

      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { school_id: schoolId, role },
      });
      if (authErr) throw new Error(`Auth user create failed (${label}): ${authErr.message}`);
      const authId = authData.user.id;
      authUserIds.push(authId);

      const userId = randomUUID();
      const { error: userErr } = await admin.from('users').upsert({
        id: userId, school_id: schoolId, auth_id: authId,
        email, full_name: `Test ${label}`, role,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'auth_id' });
      if (userErr) throw new Error(`users row failed (${label}): ${userErr.message}`);

      // Get the actual userId (trigger may have created it first)
      const { data: row } = await admin.from('users').select('id').eq('auth_id', authId).single();
      const actualUserId = row?.id ?? userId;

      // Sign in to get access token
      const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
        realtime: REALTIME_OPTIONS,
      });
      const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
      if (signInErr) throw new Error(`Sign-in failed (${label}): ${signInErr.message}`);

      return { authId, userId: actualUserId, token: session.session!.access_token };
    }

    // 5. Seed admin users for each school
    const adminA = await seedUser(schoolAId, 'ADMIN', 'admin-a');
    const adminB = await seedUser(schoolBId, 'ADMIN', 'admin-b');
    tokenA = adminA.token;
    tokenB = adminB.token;

    // 6. Seed a class in each school
    classAId = randomUUID();
    classBId = randomUUID();
    const { error: classErr } = await admin.from('classes').insert([
      { id: classAId, school_id: schoolAId, name: 'Class Alpha', grade_level: 1, updated_at: now },
      { id: classBId, school_id: schoolBId, name: 'Class Beta',  grade_level: 1, updated_at: now },
    ]);
    if (classErr) throw new Error(`Class insert failed: ${classErr.message}`);

    // 7. Seed a student in each school
    const studentUserA = await seedUser(schoolAId, 'STUDENT', 'student-a');
    const studentUserB = await seedUser(schoolBId, 'STUDENT', 'student-b');
    tokenStudentA = studentUserA.token;

    studentAId = randomUUID();
    studentBId = randomUUID();
    const { error: studErr } = await admin.from('students').insert([
      { id: studentAId, school_id: schoolAId, user_id: studentUserA.userId, current_class_id: classAId, admission_no: `ALPHA-${suffix}`, updated_at: now },
      { id: studentBId, school_id: schoolBId, user_id: studentUserB.userId, current_class_id: classBId, admission_no: `BETA-${suffix}`,  updated_at: now },
    ]);
    if (studErr) throw new Error(`Student insert failed: ${studErr.message}`);

    // 8. Seed teacher users + teachers rows (needed for attendance marked_by_id)
    const teacherUserA = await seedUser(schoolAId, 'TEACHER', 'teacher-a');
    const teacherUserB = await seedUser(schoolBId, 'TEACHER', 'teacher-b');
    tokenTeacherA = teacherUserA.token;
    tokenTeacherB = teacherUserB.token;

    teacherATeacherId = randomUUID();
    teacherBTeacherId = randomUUID();
    const { error: teachErr } = await admin.from('teachers').insert([
      { id: teacherATeacherId, school_id: schoolAId, user_id: teacherUserA.userId, staff_no: `TA-${suffix}`, updated_at: now },
      { id: teacherBTeacherId, school_id: schoolBId, user_id: teacherUserB.userId, staff_no: `TB-${suffix}`, updated_at: now },
    ]);
    if (teachErr) throw new Error(`Teacher insert failed: ${teachErr.message}`);

    // 9. Seed one announcement per school
    announcementAId = randomUUID();
    announcementBId = randomUUID();
    const { error: annErr } = await admin.from('announcements').insert([
      { id: announcementAId, school_id: schoolAId, author_id: adminA.userId, title: 'Alpha Announcement', body: 'Test', audience: 'SCHOOL_WIDE', updated_at: now },
      { id: announcementBId, school_id: schoolBId, author_id: adminB.userId, title: 'Beta Announcement',  body: 'Test', audience: 'SCHOOL_WIDE', updated_at: now },
    ]);
    if (annErr) throw new Error(`Announcement insert failed: ${annErr.message}`);

    // 10. Seed one attendance record per school
    attendanceAId = randomUUID();
    attendanceBId = randomUUID();
    const today = now.slice(0, 10);
    const { error: attErr } = await admin.from('attendance_records').insert([
      { id: attendanceAId, school_id: schoolAId, student_id: studentAId, class_id: classAId, date: today, status: 'PRESENT', marked_by_id: teacherATeacherId, updated_at: now },
      { id: attendanceBId, school_id: schoolBId, student_id: studentBId, class_id: classBId, date: today, status: 'PRESENT', marked_by_id: teacherBTeacherId, updated_at: now },
    ]);
    if (attErr) throw new Error(`Attendance insert failed: ${attErr.message}`);

    // 11. Seed one fee balance per school
    feeAId = randomUUID();
    feeBId = randomUUID();
    const { error: feeErr } = await admin.from('fee_balances').insert([
      { id: feeAId, school_id: schoolAId, student_id: studentAId, amount_due: 5000, updated_at: now },
      { id: feeBId, school_id: schoolBId, student_id: studentBId, amount_due: 6000, updated_at: now },
    ]);
    if (feeErr) throw new Error(`Fee balance insert failed: ${feeErr.message}`);

    // 12. Seed a parent user + one conversation per school
    const parentUserA = await seedUser(schoolAId, 'PARENT', 'parent-a');
    const parentUserB = await seedUser(schoolBId, 'PARENT', 'parent-b');

    conversationAId = randomUUID();
    conversationBId = randomUUID();
    const { error: convErr } = await admin.from('conversations').insert([
      { id: conversationAId, school_id: schoolAId, parent_user_id: parentUserA.userId, teacher_user_id: teacherUserA.userId, student_id: studentAId },
      { id: conversationBId, school_id: schoolBId, parent_user_id: parentUserB.userId, teacher_user_id: teacherUserB.userId, student_id: studentBId },
    ]);
    if (convErr) throw new Error(`Conversation insert failed: ${convErr.message}`);

    // 13. Seed one document per school (for /ai/process-document)
    documentAId = randomUUID();
    documentBId = randomUUID();
    const { error: docErr } = await admin.from('documents').insert([
      { id: documentAId, school_id: schoolAId, uploaded_by_id: adminA.userId, title: 'Alpha Doc', file_url: 'https://example.com/a.pdf', file_name: 'a.pdf' },
      { id: documentBId, school_id: schoolBId, uploaded_by_id: adminB.userId, title: 'Beta Doc',  file_url: 'https://example.com/b.pdf', file_name: 'b.pdf' },
    ]);
    if (docErr) throw new Error(`Document insert failed: ${docErr.message}`);

    // 14. Seed a platform-level SUPER_ADMIN (no school)
    const superAdmin = await seedUser(null, 'SUPER_ADMIN', 'super-admin');
    tokenSuperAdmin = superAdmin.token;

    // 15. Seed one quiz per school (for module-toggle RLS tests — quizzes has no NestJS route)
    quizAId = randomUUID();
    quizBId = randomUUID();
    const { error: quizErr } = await admin.from('quizzes').insert([
      { id: quizAId, school_id: schoolAId, class_id: classAId, created_by_id: teacherUserA.userId, title: 'Alpha Quiz', is_published: true },
      { id: quizBId, school_id: schoolBId, class_id: classBId, created_by_id: teacherUserB.userId, title: 'Beta Quiz', is_published: true },
    ]);
    if (quizErr) throw new Error(`Quiz insert failed: ${quizErr.message}`);
  }, TIMEOUT);

  afterAll(async () => {
    // If beforeAll failed before assigning admin/app, there's nothing to
    // clean up — bail quietly instead of throwing a second, misleading
    // "Cannot read properties of undefined" error on top of the real one.
    if (!admin) return;

    // Clean up in FK-safe order using service-role client
    // (school_modules rows cascade-delete with their school, no separate cleanup needed)
    await admin.from('users').delete().is('school_id', null).eq('role', 'SUPER_ADMIN').ilike('email', `%-${suffix}@test-isolation.internal`);
    await admin.from('messages').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('conversations').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('documents').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('quizzes').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('attendance_records').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('fee_balances').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('announcements').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('students').delete().in('school_id', [schoolAId, schoolBId]);
    // teachers has no school_id column — delete via user_id
    const { data: testUsers } = await admin.from('users').select('id').in('school_id', [schoolAId, schoolBId]);
    const testUserIds = (testUsers ?? []).map((u: { id: string }) => u.id);
    if (testUserIds.length) await admin.from('teachers').delete().in('user_id', testUserIds);
    await admin.from('classes').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('users').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    await app.close();
  }, TIMEOUT);

  // ---------------------------------------------------------------------------
  // Students
  // ---------------------------------------------------------------------------

  it('School A admin cannot see School B students', async () => {
    const res = await request(app.getHttpServer())
      .get('/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
    expect(ids).not.toContain(studentBId);
  });

  it('School B admin cannot see School A students', async () => {
    const res = await request(app.getHttpServer())
      .get('/students')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
    expect(ids).not.toContain(studentAId);
  });

  // ---------------------------------------------------------------------------
  // Classes
  // ---------------------------------------------------------------------------

  it('School A admin cannot see School B classes', async () => {
    const res = await request(app.getHttpServer())
      .get('/classes')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(classBId);
  });

  it('School B admin cannot see School A classes', async () => {
    const res = await request(app.getHttpServer())
      .get('/classes')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(classAId);
  });

  // ---------------------------------------------------------------------------
  // Each school only sees its own data
  // ---------------------------------------------------------------------------

  it('School A admin can see their own student', async () => {
    const res = await request(app.getHttpServer())
      .get('/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toContain(studentAId);
  });

  it('School B admin can see their own student', async () => {
    const res = await request(app.getHttpServer())
      .get('/students')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toContain(studentBId);
  });

  // ---------------------------------------------------------------------------
  // Announcements
  // ---------------------------------------------------------------------------

  it('School A admin cannot see School B announcements', async () => {
    const res = await request(app.getHttpServer())
      .get('/announcements')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(announcementBId);
  });

  it('School B admin cannot see School A announcements', async () => {
    const res = await request(app.getHttpServer())
      .get('/announcements')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(announcementAId);
  });

  // ---------------------------------------------------------------------------
  // Attendance
  // ---------------------------------------------------------------------------

  it('School A admin cannot see School B attendance records', async () => {
    const res = await request(app.getHttpServer())
      .get('/attendance')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(attendanceBId);
  });

  it('School B admin cannot see School A attendance records', async () => {
    const res = await request(app.getHttpServer())
      .get('/attendance')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(attendanceAId);
  });

  // ---------------------------------------------------------------------------
  // Fee balances
  // ---------------------------------------------------------------------------

  it('School A admin cannot see School B fee balances', async () => {
    const res = await request(app.getHttpServer())
      .get('/fees')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((f) => f.id);
    expect(ids).not.toContain(feeBId);
  });

  it('School B admin cannot see School A fee balances', async () => {
    const res = await request(app.getHttpServer())
      .get('/fees')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((f) => f.id);
    expect(ids).not.toContain(feeAId);
  });

  // ---------------------------------------------------------------------------
  // Payments — cross-school feeBalanceId must not resolve
  // ---------------------------------------------------------------------------

  it('School A admin cannot initialize a payment against School B fee balance', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/initialize')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ feeBalanceId: feeBId, amount: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not found/i);
  });

  // ---------------------------------------------------------------------------
  // Messaging — cross-school conversationId must not resolve
  // ---------------------------------------------------------------------------

  it('School A admin cannot mark School B conversation as read', async () => {
    await request(app.getHttpServer())
      .patch(`/messaging/conversations/${conversationBId}/read`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  // ---------------------------------------------------------------------------
  // AI report-card comment — cross-school studentId must not resolve
  // ---------------------------------------------------------------------------

  it('School A admin cannot draft a report-card comment for a School B student', async () => {
    await request(app.getHttpServer())
      .post('/ai/report-card-comment')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ studentId: studentBId, termId: randomUUID() })
      .expect(404);
  });

  // ---------------------------------------------------------------------------
  // AI document processing — cross-school documentId must not resolve
  // ---------------------------------------------------------------------------

  it('School A admin cannot trigger processing of a School B document', async () => {
    await request(app.getHttpServer())
      .post('/ai/process-document')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ documentId: documentBId })
      .expect(404);
  });

  // ---------------------------------------------------------------------------
  // Notifications — report-card email: cross-school ownership + role check
  // ---------------------------------------------------------------------------

  it('School A admin cannot email a report card for a School B student', async () => {
    await request(app.getHttpServer())
      .post('/notifications/report-card-email')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ studentId: studentBId, termId: randomUUID(), reportCardUrl: 'https://example.com/rc.pdf' })
      .expect(404);
  });

  it('A non-staff user cannot trigger a report-card email at all', async () => {
    await request(app.getHttpServer())
      .post('/notifications/report-card-email')
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ studentId: studentAId, termId: randomUUID(), reportCardUrl: 'https://example.com/rc.pdf' })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Module toggles — SUPER_ADMIN access, enable/disable/re-enable, dependencies
  // ---------------------------------------------------------------------------

  it('SUPER_ADMIN can list all schools', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/schools')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toContain(schoolAId);
    expect(ids).toContain(schoolBId);
  });

  it('A regular ADMIN cannot access super-admin routes', async () => {
    await request(app.getHttpServer())
      .get('/super-admin/schools')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
  });

  it('School A teacher can see their quiz before it is disabled', async () => {
    const { data } = await clientAs(tokenTeacherA).from('quizzes').select('id').eq('id', quizAId);
    expect((data ?? []).map((q) => q.id)).toContain(quizAId);
  });

  it('SUPER_ADMIN disables quizzes for School A only', async () => {
    await request(app.getHttpServer())
      .patch(`/super-admin/schools/${schoolAId}/modules/quizzes`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ enabled: false })
      .expect(200);
  });

  it('School A teacher loses access to quizzes after disabling', async () => {
    const { data } = await clientAs(tokenTeacherA).from('quizzes').select('id').eq('id', quizAId);
    expect(data ?? []).toHaveLength(0);
  });

  it('School B teacher is unaffected by School A disabling quizzes', async () => {
    const { data } = await clientAs(tokenTeacherB).from('quizzes').select('id').eq('id', quizBId);
    expect((data ?? []).map((q) => q.id)).toContain(quizBId);
  });

  it('SUPER_ADMIN re-enables quizzes for School A', async () => {
    await request(app.getHttpServer())
      .patch(`/super-admin/schools/${schoolAId}/modules/quizzes`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ enabled: true })
      .expect(200);
  });

  it('School A teacher regains access with the original quiz data intact', async () => {
    const { data } = await clientAs(tokenTeacherA).from('quizzes').select('id, title').eq('id', quizAId);
    expect(data?.[0]?.title).toBe('Alpha Quiz');
  });

  it('Enabling a module with an unmet dependency is rejected', async () => {
    // ai_features depends on document_library
    await request(app.getHttpServer())
      .patch(`/super-admin/schools/${schoolAId}/modules/document_library`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ enabled: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/super-admin/schools/${schoolAId}/modules/ai_features`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ enabled: true })
      .expect(400);
    expect(res.body.message).toMatch(/document_library/);

    // Restore for cleanliness
    await request(app.getHttpServer())
      .patch(`/super-admin/schools/${schoolAId}/modules/document_library`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ enabled: true })
      .expect(200);
  });

  it('Disabling a core module is rejected', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/super-admin/schools/${schoolAId}/modules/attendance`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ enabled: false })
      .expect(400);
    expect(res.body.message).toMatch(/core|cannot be disabled/i);
  });

  it('A regular ADMIN cannot toggle modules via a direct Supabase call (RLS write-blocked)', async () => {
    const { data } = await clientAs(tokenA)
      .from('school_modules')
      .update({ enabled: false })
      .eq('school_id', schoolAId)
      .eq('module_key', 'quizzes')
      .select();
    // RLS silently filters the row out of the UPDATE — zero rows affected, not an error.
    expect(data ?? []).toHaveLength(0);
  });
});
