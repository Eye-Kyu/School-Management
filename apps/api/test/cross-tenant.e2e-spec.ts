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
  // Set by the Phase 2 school-management "create" test; cleaned up in afterAll.
  let createdSchoolId: string | undefined;
  // Set by the Phase 3 onboarding tests; cleaned up in afterAll.
  let onboardedSchoolId: string | undefined;
  let onboardedAdminAuthId: string | undefined;
  // Set by the Phase 5 package tests; cleaned up in afterAll.
  let createdPackageId: string | undefined;
  // Set by the Phase 6 entitlement-engine tests; cleaned up in afterAll.
  let entitlementSchoolId: string | undefined;
  // Set by the Phase 8 curriculum tests; cleaned up in afterAll.
  let createdCurriculumId: string | undefined;
  // Set by the Phase 12 billing tests — no separate afterAll cleanup needed,
  // platform_invoices.school_id cascades away when schoolAId is deleted below.
  let createdInvoiceId: string | undefined;

  // JWT access tokens for each school's admin
  let tokenA: string;
  let tokenB: string;
  // Non-staff token, used for the report-card-email role check
  let tokenStudentA: string;
  // Platform-level token, used for module-toggle tests
  let tokenSuperAdmin: string;
  // The above token's `users.id` — needed to seed privileged_access_grants
  // rows directly (e.g. an already-expired grant) for the Phase 10 tests.
  let superAdminUserId: string;
  // Platform-level (SUPER_ADMIN role) token with zero platform_permissions,
  // used to prove PlatformPermissionGuard is a real, independent check.
  let tokenReducedSuperAdmin: string;
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
    superAdminUserId = superAdmin.userId;

    // 14b. Seed a SUPER_ADMIN-role account with zero platform_permissions,
    // to prove PlatformPermissionGuard is a real, independent check on top
    // of SuperAdminGuard's role check, not just a rename of it.
    const reducedSuperAdmin = await seedUser(null, 'SUPER_ADMIN', 'reduced-super-admin');
    await admin.from('users').update({ platform_permissions: [] }).eq('auth_id', reducedSuperAdmin.authId);
    tokenReducedSuperAdmin = reducedSuperAdmin.token;

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
    // Phase 2 school-management tests create their own extra school
    if (createdSchoolId) await admin.from('schools').delete().eq('id', createdSchoolId);
    // Phase 3 onboarding tests create a school + admin auth user outside seedUser()
    if (onboardedSchoolId) await admin.from('schools').delete().eq('id', onboardedSchoolId);
    if (onboardedAdminAuthId) await admin.auth.admin.deleteUser(onboardedAdminAuthId).catch(() => {});
    // Phase 5 package tests create their own extra package (package_modules cascades)
    if (createdPackageId) await admin.from('packages').delete().eq('id', createdPackageId);
    // Phase 6 entitlement-engine tests create their own extra school
    if (entitlementSchoolId) await admin.from('schools').delete().eq('id', entitlementSchoolId);
    // Phase 8 curriculum tests create their own extra curriculum (curriculum_subjects cascades)
    if (createdCurriculumId) await admin.from('curricula').delete().eq('id', createdCurriculumId);
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

  it('A SUPER_ADMIN with no platform_permissions is rejected by PlatformPermissionGuard', async () => {
    await request(app.getHttpServer())
      .get('/super-admin/schools')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .expect(403);
  });

  it('A SUPER_ADMIN with no platform_permissions is rejected on the dashboard route too', async () => {
    await request(app.getHttpServer())
      .get('/super-admin/dashboard')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .expect(403);
  });

  it('SUPER_ADMIN dashboard stats reflect real counts', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/dashboard')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    expect(res.body.totalSchools).toBeGreaterThanOrEqual(2);
    expect(res.body.usersByRole).toHaveProperty('ADMIN');
    expect(res.body.usersByRole).toHaveProperty('TEACHER');
    expect(res.body.usersByRole).toHaveProperty('STUDENT');
    expect(res.body.usersByRole).toHaveProperty('PARENT');
  });

  // ---------------------------------------------------------------------------
  // School management — create/update/status transitions (Phase 2)
  // ---------------------------------------------------------------------------

  it('SUPER_ADMIN can create a school', async () => {
    const res = await request(app.getHttpServer())
      .post('/super-admin/schools')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ name: `Test Created School ${suffix}`, slug: `test-created-${suffix}` })
      .expect(201);

    expect(res.body.status).toBe('ACTIVE');
    createdSchoolId = res.body.id;

    const list = await request(app.getHttpServer())
      .get('/super-admin/schools')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect((list.body as Array<{ id: string }>).map((s) => s.id)).toContain(createdSchoolId);
  });

  it('Creating a school with a duplicate slug fails with a clear 400', async () => {
    await request(app.getHttpServer())
      .post('/super-admin/schools')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ name: 'Duplicate slug attempt', slug: `test-created-${suffix}` })
      .expect(400);
  });

  it('SUPER_ADMIN can update a school profile', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/super-admin/schools/${createdSchoolId}`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ phone: '+254700000001' })
      .expect(200);
    expect(res.body.id).toBe(createdSchoolId);
  });

  it('SUPER_ADMIN can transition a school status, and it is audit logged', async () => {
    await request(app.getHttpServer())
      .patch(`/super-admin/schools/${createdSchoolId}/status`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ status: 'SUSPENDED', reason: 'e2e test' })
      .expect(200);

    const get = await request(app.getHttpServer())
      .get(`/super-admin/schools/${createdSchoolId}`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(get.body.status).toBe('SUSPENDED');

    const { data: logs } = await admin
      .from('audit_logs')
      .select('action, metadata')
      .eq('entity_id', createdSchoolId)
      .eq('action', 'school.status_change');
    expect(logs?.length).toBeGreaterThanOrEqual(1);
    expect(logs?.[0]?.metadata).toMatchObject({ from: 'ACTIVE', to: 'SUSPENDED' });
  });

  it('A regular ADMIN cannot create, update, or change status of a school', async () => {
    await request(app.getHttpServer())
      .post('/super-admin/schools')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Should fail', slug: `should-fail-${suffix}` })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/super-admin/schools/${createdSchoolId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Should fail' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/super-admin/schools/${createdSchoolId}/status`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'ARCHIVED' })
      .expect(403);
  });

  it('A SUPER_ADMIN with no platform_permissions cannot create, update, or change status of a school', async () => {
    await request(app.getHttpServer())
      .post('/super-admin/schools')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ name: 'Should fail', slug: `should-fail-2-${suffix}` })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/super-admin/schools/${createdSchoolId}`)
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ name: 'Should fail' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/super-admin/schools/${createdSchoolId}/status`)
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ status: 'ARCHIVED' })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // School onboarding — one-call create school + first admin (Phase 3)
  // ---------------------------------------------------------------------------

  it('SUPER_ADMIN can onboard a school with a working admin login in one call', async () => {
    const adminEmail = `onboarded-admin-${suffix}@test-isolation.internal`;
    const res = await request(app.getHttpServer())
      .post('/super-admin/schools/onboard')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({
        school: { name: `Onboarded School ${suffix}`, slug: `onboarded-${suffix}` },
        admin: { fullName: 'Onboarded Admin', email: adminEmail },
        disabledModuleKeys: ['quizzes'],
      })
      .expect(201);

    expect(res.body.school.status).toBe('ACTIVE');
    expect(res.body.admin.temporaryPassword).toEqual(expect.any(String));
    onboardedSchoolId = res.body.school.id;

    const { data: authUser } = await admin.from('users').select('auth_id').eq('email', adminEmail).single();
    onboardedAdminAuthId = authUser?.auth_id;

    // The new admin can actually log in and act as ADMIN for their school.
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
    });
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({
      email: adminEmail,
      password: res.body.admin.temporaryPassword,
    });
    expect(signInErr).toBeNull();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${session!.session!.access_token}`)
      .expect(200);
    expect(me.body.role).toBe('ADMIN');
    expect(me.body.schoolId).toBe(onboardedSchoolId);

    // The disabledModuleKeys override took effect immediately.
    const modules = await request(app.getHttpServer())
      .get(`/super-admin/schools/${onboardedSchoolId}/modules`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const quizModule = (modules.body as Array<{ key: string; enabled: boolean }>).find((m) => m.key === 'quizzes');
    expect(quizModule?.enabled).toBe(false);
  });

  it('Onboarding with a duplicate slug fails and leaves no orphaned auth user', async () => {
    const adminEmail = `orphan-check-${suffix}@test-isolation.internal`;
    await request(app.getHttpServer())
      .post('/super-admin/schools/onboard')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({
        school: { name: 'Duplicate slug onboarding', slug: `onboarded-${suffix}` }, // same slug as above
        admin: { fullName: 'Should Not Exist', email: adminEmail },
        disabledModuleKeys: [],
      })
      .expect(400);

    const { data: orphan } = await admin.from('users').select('id').eq('email', adminEmail).maybeSingle();
    expect(orphan).toBeNull();
  });

  it('The bare module catalogue endpoint works without a school context', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/modules')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect((res.body as Array<{ key: string }>).map((m) => m.key)).toContain('quizzes');
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot onboard schools', async () => {
    await request(app.getHttpServer())
      .post('/super-admin/schools/onboard')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ school: { name: 'Should fail', slug: `onboard-fail-${suffix}` }, admin: { fullName: 'X', email: 'x@test-isolation.internal' } })
      .expect(403);
    await request(app.getHttpServer())
      .post('/super-admin/schools/onboard')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ school: { name: 'Should fail', slug: `onboard-fail-2-${suffix}` }, admin: { fullName: 'X', email: 'x@test-isolation.internal' } })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // School overview — real per-school stats, not fabricated (Phase 4)
  // ---------------------------------------------------------------------------

  it('School A overview reflects the real seeded users, scoped to School A only', async () => {
    const res = await request(app.getHttpServer())
      .get(`/super-admin/schools/${schoolAId}/overview`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    expect(res.body.users.total).toBe(4); // adminA, teacherUserA, studentUserA, parentUserA
    expect(res.body.users.byRole).toMatchObject({ ADMIN: 1, TEACHER: 1, STUDENT: 1, PARENT: 1 });
    expect(res.body.academic.classCount).toBeGreaterThanOrEqual(1);
    expect(res.body.engagement).toHaveProperty('dau');
    expect(res.body.engagement).toHaveProperty('wau');
    expect(res.body.engagement).toHaveProperty('mau');
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot view a school overview', async () => {
    await request(app.getHttpServer())
      .get(`/super-admin/schools/${schoolAId}/overview`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/super-admin/schools/${schoolAId}/overview`)
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Packages & school subscriptions (Phase 5) — data-only, no enforcement yet
  // ---------------------------------------------------------------------------

  it('The 3 seeded starter packages are listed with their module entitlements', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/packages')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    const names = (res.body as Array<{ name: string; modules: unknown[] }>).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Essential', 'Professional', 'Enterprise']));
    const enterprise = (res.body as Array<{ name: string; modules: { moduleKey: string }[] }>).find((p) => p.name === 'Enterprise');
    expect(enterprise?.modules.map((m) => m.moduleKey)).toEqual(expect.arrayContaining(['ai_features', 'payments']));
  });

  it('SUPER_ADMIN can create a package and set its module entitlements', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/super-admin/packages')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ name: `Test Package ${suffix}`, price: 1000, billingCycle: 'MONTHLY' })
      .expect(201);
    createdPackageId = createRes.body.id;

    await request(app.getHttpServer())
      .put(`/super-admin/packages/${createdPackageId}/modules`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ modules: [{ moduleKey: 'homework', entitlement: 'INCLUDED' }, { moduleKey: 'quizzes', entitlement: 'OPTIONAL_ADD_ON' }] })
      .expect(200);

    const get = await request(app.getHttpServer())
      .get(`/super-admin/packages/${createdPackageId}`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(get.body.modules).toEqual(expect.arrayContaining([
      { moduleKey: 'homework', entitlement: 'INCLUDED' },
      { moduleKey: 'quizzes', entitlement: 'OPTIONAL_ADD_ON' },
    ]));
  });

  it('Assigning School A a package, then switching, leaves only one ACTIVE subscription', async () => {
    const { data: packages } = await admin.from('packages').select('id, name').order('display_order');
    const essential = packages!.find((p) => p.name === 'Essential')!;
    const professional = packages!.find((p) => p.name === 'Professional')!;

    await request(app.getHttpServer())
      .post(`/super-admin/schools/${schoolAId}/subscription`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ packageId: essential.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/super-admin/schools/${schoolAId}/subscription`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ packageId: professional.id })
      .expect(201);

    const { data: activeRows } = await admin
      .from('school_subscriptions')
      .select('package_id, status')
      .eq('school_id', schoolAId)
      .eq('status', 'ACTIVE');
    expect(activeRows?.length).toBe(1);
    expect(activeRows?.[0]?.package_id).toBe(professional.id);

    const current = await request(app.getHttpServer())
      .get(`/super-admin/schools/${schoolAId}/subscription`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(current.body.package.name).toBe('Professional');

    const { data: logs } = await admin
      .from('audit_logs')
      .select('action')
      .eq('school_id', schoolAId)
      .eq('action', 'school.subscription_change');
    expect(logs?.length).toBeGreaterThanOrEqual(2);
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot manage packages or subscriptions', async () => {
    await request(app.getHttpServer())
      .post('/super-admin/packages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Should fail', price: 100 })
      .expect(403);
    await request(app.getHttpServer())
      .post('/super-admin/packages')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ name: 'Should fail', price: 100 })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/super-admin/schools/${schoolAId}/subscription`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ packageId: createdPackageId })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/super-admin/schools/${schoolAId}/subscription`)
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ packageId: createdPackageId })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Entitlement engine — packages + overrides = effective modules (Phase 6)
  // ---------------------------------------------------------------------------

  it('A school with no subscription still defaults every module to enabled (regression)', async () => {
    const { data: school, error } = await admin
      .from('schools')
      .insert({ id: randomUUID(), name: `Entitlement Test School ${suffix}`, slug: `entitlement-test-${suffix}`, updated_at: new Date().toISOString() })
      .select('id')
      .single();
    expect(error).toBeNull();
    entitlementSchoolId = school!.id;

    const { data: enabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'ai_features' });
    expect(enabled).toBe(true);
  });

  it('Assigning a restrictive package disables modules the package does not include', async () => {
    const { data: essential } = await admin.from('packages').select('id').eq('name', 'Essential').single();

    await request(app.getHttpServer())
      .post(`/super-admin/schools/${entitlementSchoolId}/subscription`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ packageId: essential!.id })
      .expect(201);

    const { data: aiEnabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'ai_features' });
    expect(aiEnabled).toBe(false); // Essential does not include ai_features, no override

    const { data: homeworkEnabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'homework' });
    expect(homeworkEnabled).toBe(true); // Essential DOES include homework

    // The FeatureGuard-guarded NestJS route reflects the same restriction —
    // no code change needed there, it inherits module_enabled() automatically.
    const modules = await request(app.getHttpServer())
      .get(`/super-admin/schools/${entitlementSchoolId}/modules`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const aiRow = (modules.body as Array<{ key: string; enabled: boolean; entitlementSource: string }>).find((m) => m.key === 'ai_features');
    expect(aiRow?.enabled).toBe(false);
    expect(aiRow?.entitlementSource).toBe('PACKAGE_UNAVAILABLE');
  });

  it('A core module stays enabled regardless of package', async () => {
    const { data: enabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'attendance' });
    expect(enabled).toBe(true);
  });

  it('An explicit override wins over package state in both directions', async () => {
    const now = new Date().toISOString();

    // ai_features declares a hard dependency on document_library, enforced by
    // a BEFORE INSERT/UPDATE trigger on school_modules (school_modules_check)
    // that runs even for this direct admin-client write — not just the
    // application-layer check in toggleModule(). Essential (this school's
    // package) doesn't include document_library, so it must be satisfied with
    // its own temporary override first, or the trigger rejects the insert
    // below outright. Removed at the end of this test so later tests (the
    // upgrade-preview assertions) still see document_library resolved from
    // the package, not a lingering override.
    const { error: depErr, data: depOverride } = await admin.from('school_modules')
      .insert({ id: randomUUID(), school_id: entitlementSchoolId, module_key: 'document_library', enabled: true, updated_at: now })
      .select('id')
      .single();
    expect(depErr).toBeNull();

    const { error: aiErr } = await admin.from('school_modules').insert({ id: randomUUID(), school_id: entitlementSchoolId, module_key: 'ai_features', enabled: true, updated_at: now });
    expect(aiErr).toBeNull();
    const { data: aiEnabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'ai_features' });
    expect(aiEnabled).toBe(true); // override beats "package doesn't include it"

    const { error: hwErr } = await admin.from('school_modules').insert({ id: randomUUID(), school_id: entitlementSchoolId, module_key: 'homework', enabled: false, updated_at: now });
    expect(hwErr).toBeNull();
    const { data: hwEnabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'homework' });
    expect(hwEnabled).toBe(false); // override beats "package includes it"

    await admin.from('school_modules').delete().eq('id', depOverride!.id);
  });

  it("GET /auth/me's enabledModules reflects real package + override state, not just school_modules", async () => {
    const email = `entitlement-admin-${suffix}@test-isolation.internal`;
    const password = `TestPass${suffix}!`;
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { school_id: entitlementSchoolId, role: 'ADMIN' },
    });
    expect(authErr).toBeNull();
    authUserIds.push(authData!.user.id);

    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
    });
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    expect(signInErr).toBeNull();

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${session!.session!.access_token}`)
      .expect(200);

    expect(me.body.enabledModules).toContain('ai_features'); // overridden enabled, package says no
    expect(me.body.enabledModules).not.toContain('homework'); // overridden disabled, package says yes
    expect(me.body.enabledModules).toContain('attendance'); // core, always on
  });

  // ---------------------------------------------------------------------------
  // Package upgrade/downgrade preview (Phase 7) — reuses entitlementSchoolId,
  // which at this point has an ACTIVE Essential subscription plus two
  // overrides from the Phase 6 tests (ai_features enabled, homework disabled).
  // ---------------------------------------------------------------------------

  it('Preview correctly identifies an upgrade: gained modules, no losses, overrides unaffected', async () => {
    const { data: professional } = await admin.from('packages').select('id').eq('name', 'Professional').single();

    const res = await request(app.getHttpServer())
      .get(`/super-admin/schools/${entitlementSchoolId}/subscription/preview`)
      .query({ packageId: professional!.id })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    expect(res.body.changeType).toBe('UPGRADE');
    const gainedKeys = (res.body.modulesGained as Array<{ key: string }>).map((m) => m.key);
    expect(gainedKeys).toEqual(expect.arrayContaining(['document_library', 'assessments', 'quizzes', 'permission_slips', 'safety_tipline', 'behaviour_tracking']));
    expect(res.body.modulesLost).toEqual([]);
    // Overridden modules never appear as gained/lost — their state doesn't change with the package.
    expect(gainedKeys).not.toContain('ai_features');
    expect(gainedKeys).not.toContain('homework');
  });

  it('Actually switching to the upgrade preserves existing overrides and applies the new package', async () => {
    const { data: professional } = await admin.from('packages').select('id').eq('name', 'Professional').single();

    await request(app.getHttpServer())
      .post(`/super-admin/schools/${entitlementSchoolId}/subscription`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ packageId: professional!.id })
      .expect(201);

    const { data: docLibEnabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'document_library' });
    expect(docLibEnabled).toBe(true);
    const { data: aiStillEnabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'ai_features' });
    expect(aiStillEnabled).toBe(true); // override survives the switch
    const { data: homeworkStillDisabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'homework' });
    expect(homeworkStillDisabled).toBe(false); // override survives the switch
  });

  it('Preview correctly identifies a downgrade: modules that would become unavailable', async () => {
    const { data: essential } = await admin.from('packages').select('id').eq('name', 'Essential').single();

    const res = await request(app.getHttpServer())
      .get(`/super-admin/schools/${entitlementSchoolId}/subscription/preview`)
      .query({ packageId: essential!.id })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    expect(res.body.changeType).toBe('DOWNGRADE');
    const lostKeys = (res.body.modulesLost as Array<{ key: string }>).map((m) => m.key);
    expect(lostKeys).toEqual(expect.arrayContaining(['document_library', 'assessments', 'quizzes', 'permission_slips', 'safety_tipline', 'behaviour_tracking']));
  });

  it('Downgrading with preserveModuleKeys keeps only the chosen module enabled via override', async () => {
    const { data: essential } = await admin.from('packages').select('id').eq('name', 'Essential').single();

    await request(app.getHttpServer())
      .post(`/super-admin/schools/${entitlementSchoolId}/subscription`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ packageId: essential!.id, preserveModuleKeys: ['quizzes'] })
      .expect(201);

    const { data: quizzesEnabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'quizzes' });
    expect(quizzesEnabled).toBe(true); // preserved via override

    const { data: assessmentsEnabled } = await admin.rpc('module_enabled', { p_school_id: entitlementSchoolId, p_module_key: 'assessments' });
    expect(assessmentsEnabled).toBe(false); // not preserved, downgraded away
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot preview or change subscriptions', async () => {
    const { data: essential } = await admin.from('packages').select('id').eq('name', 'Essential').single();

    await request(app.getHttpServer())
      .get(`/super-admin/schools/${entitlementSchoolId}/subscription/preview`)
      .query({ packageId: essential!.id })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/super-admin/schools/${entitlementSchoolId}/subscription/preview`)
      .query({ packageId: essential!.id })
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/super-admin/schools/${entitlementSchoolId}/subscription`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ packageId: essential!.id })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Curriculum catalog — informational reference layer only (Phase 8)
  // ---------------------------------------------------------------------------

  it('SUPER_ADMIN can create a curriculum and set its grade-level subjects', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/super-admin/curricula')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ name: `Test Curriculum ${suffix}`, description: 'e2e test curriculum' })
      .expect(201);
    createdCurriculumId = createRes.body.id;

    await request(app.getHttpServer())
      .put(`/super-admin/curricula/${createdCurriculumId}/subjects`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ subjects: [{ gradeLevel: 4, name: 'Mathematics' }, { gradeLevel: 4, name: 'English' }] })
      .expect(200);

    const get = await request(app.getHttpServer())
      .get(`/super-admin/curricula/${createdCurriculumId}`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect((get.body.subjects as Array<{ grade_level: number; name: string }>)).toEqual(expect.arrayContaining([
      { grade_level: 4, name: 'Mathematics', id: expect.any(String), code: null, display_order: 0 },
      { grade_level: 4, name: 'English', id: expect.any(String), code: null, display_order: 0 },
    ]));

    const list = await request(app.getHttpServer())
      .get('/super-admin/curricula')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const listed = (list.body as Array<{ id: string; subjectCount: number }>).find((c) => c.id === createdCurriculumId);
    expect(listed?.subjectCount).toBe(2);
  });

  it('Assigning a curriculum to a school never touches that school\'s own subjects/classes/terms', async () => {
    const { data: subjectsBefore } = await admin.from('subjects').select('id').eq('school_id', schoolAId);
    const { data: classesBefore } = await admin.from('classes').select('id').eq('school_id', schoolAId);
    const { data: termsBefore } = await admin.from('terms').select('id').eq('school_id', schoolAId);

    await request(app.getHttpServer())
      .post(`/super-admin/schools/${schoolAId}/curriculum`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ curriculumId: createdCurriculumId })
      .expect(201);

    const get = await request(app.getHttpServer())
      .get(`/super-admin/schools/${schoolAId}/curriculum`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(get.body.id).toBe(createdCurriculumId);

    const { data: subjectsAfter } = await admin.from('subjects').select('id').eq('school_id', schoolAId);
    const { data: classesAfter } = await admin.from('classes').select('id').eq('school_id', schoolAId);
    const { data: termsAfter } = await admin.from('terms').select('id').eq('school_id', schoolAId);
    expect(subjectsAfter?.map((s) => s.id).sort()).toEqual(subjectsBefore?.map((s) => s.id).sort());
    expect(classesAfter?.map((c) => c.id).sort()).toEqual(classesBefore?.map((c) => c.id).sort());
    expect(termsAfter?.map((t) => t.id).sort()).toEqual(termsBefore?.map((t) => t.id).sort());

    // Clearing works too.
    await request(app.getHttpServer())
      .post(`/super-admin/schools/${schoolAId}/curriculum`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ curriculumId: null })
      .expect(201);
    const cleared = await request(app.getHttpServer())
      .get(`/super-admin/schools/${schoolAId}/curriculum`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    // superagent's JSON parser doesn't retain raw text (`.text` is always ''
    // for application/json), and normalizes a literal `null` body to `{}` on
    // `.body` (a long-standing `obj || {}` quirk) — `{}` is what a real `null`
    // response looks like through supertest, not evidence of a populated object.
    expect(cleared.body).toEqual({});
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot manage curricula or school curriculum tags', async () => {
    await request(app.getHttpServer())
      .post('/super-admin/curricula')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Should fail' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/super-admin/curricula')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ name: 'Should fail' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/super-admin/schools/${schoolAId}/curriculum`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ curriculumId: createdCurriculumId })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Platform intelligence — real data only (Phase 9)
  // ---------------------------------------------------------------------------

  it('Growth analytics reflects the real schools/users created during this test run', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/analytics/growth')
      .query({ days: 30 })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    expect(res.body.totalNewSchools).toBeGreaterThanOrEqual(2); // at least School A + B
    expect(res.body.totalNewUsers).toBeGreaterThanOrEqual(4);
    expect(Array.isArray(res.body.schoolsByDay)).toBe(true);
  });

  it('Module adoption reflects real entitlement state across schools', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/analytics/modules')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    const rows = res.body as Array<{ key: string; enabledCount: number; totalSchools: number; percentage: number }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.percentage).toBeGreaterThanOrEqual(0);
      expect(row.percentage).toBeLessThanOrEqual(100);
    }
    // quizzes is currently enabled (via override) for entitlementSchoolId, and
    // defaults to enabled for every no-subscription school (School A/B, onboarded).
    const quizzes = rows.find((r) => r.key === 'quizzes');
    expect(quizzes?.enabledCount).toBeGreaterThanOrEqual(1);
  });

  it('Package analytics shows real schools-per-package distribution and recent change activity', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/analytics/packages')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    const names = (res.body.packages as Array<{ name: string }>).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Essential', 'Professional', 'Enterprise']));
    // Several subscription changes happened earlier in this test run (Phase 5/7).
    expect(res.body.subscriptionChangesLast30Days).toBeGreaterThanOrEqual(1);
  });

  it('School health marks a non-ACTIVE-status school as INACTIVE with a real reason', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/analytics/school-health')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    const rows = res.body as Array<{ id: string; status: string; reasons: string[] }>;
    // createdSchoolId was left SUSPENDED at the end of the Phase 2 tests.
    const suspendedSchool = rows.find((r) => r.id === createdSchoolId);
    expect(suspendedSchool?.status).toBe('INACTIVE');
    expect(suspendedSchool?.reasons.join(' ')).toMatch(/SUSPENDED/);
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot view platform analytics', async () => {
    for (const path of ['/super-admin/analytics/growth', '/super-admin/analytics/modules', '/super-admin/analytics/packages', '/super-admin/analytics/school-health']) {
      await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenA}`).expect(403);
      await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokenReducedSuperAdmin}`).expect(403);
    }
  });

  // ---------------------------------------------------------------------------
  // Privileged tenant access (Phase 10) — explicit, scoped, time-limited
  // grants. Enforcement is entirely in PlatformPrivilegedAccessService (an
  // admin-client check per call), not RLS — these tests exercise that gate
  // directly, and confirm it still respects the School A/B tenant boundary.
  // ---------------------------------------------------------------------------

  it('A SUPER_ADMIN with GRANT_PRIVILEGED_ACCESS can request a grant, read the granted school\'s aggregates and students, and every read is logged', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/super-admin/privileged-access/grants')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ schoolId: schoolAId, reason: 'Investigating a support ticket', scopes: ['SCHOOL_AGGREGATES', 'STUDENT_RECORDS'], durationMinutes: 60 })
      .expect(201);
    const grantId = createRes.body.id as string;
    expect(createRes.body.status).toBe('ACTIVE');
    expect(createRes.body.targetSchoolId).toBe(schoolAId);

    const activeRes = await request(app.getHttpServer())
      .get('/super-admin/privileged-access/grants/active')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(activeRes.body?.id).toBe(grantId);

    const aggRes = await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/aggregates`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(aggRes.body.users.total).toBeGreaterThanOrEqual(1);

    const studentsRes = await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/students`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const studentIds = (studentsRes.body as Array<{ id: string }>).map((s) => s.id);
    expect(studentIds).toContain(studentAId);
    expect(studentIds).not.toContain(studentBId);

    // Every successful scoped read wrote an append-only log row.
    const { data: logs } = await admin.from('privileged_access_logs').select('scope').eq('grant_id', grantId);
    expect((logs ?? []).map((l) => l.scope).sort()).toEqual(['SCHOOL_AGGREGATES', 'STUDENT_RECORDS']);

    // Tenant boundary: this grant is scoped to School A only — School B stays walled off.
    await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolBId}/aggregates`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(403);

    // Ending the session makes further reads fail immediately.
    await request(app.getHttpServer())
      .post(`/super-admin/privileged-access/grants/${grantId}/end`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/aggregates`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(403);
    const activeAfterEnd = await request(app.getHttpServer())
      .get('/super-admin/privileged-access/grants/active')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    // Same supertest `null`-body-becomes-`{}` quirk as the curriculum test above.
    expect(activeAfterEnd.body).toEqual({});
  });

  it('A grant with all 7 scopes can read academic data, attendance, financials, documents, and conversations — the last with no message body ever exposed', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/super-admin/privileged-access/grants')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({
        schoolId: schoolAId,
        reason: 'Full-scope support investigation',
        scopes: ['SCHOOL_AGGREGATES', 'STUDENT_RECORDS', 'ACADEMIC_DATA', 'ATTENDANCE', 'FINANCIAL_DATA', 'COMMUNICATION', 'DOCUMENTS'],
        durationMinutes: 60,
      })
      .expect(201);
    const grantId = createRes.body.id as string;

    // ACADEMIC_DATA — no assessments were seeded for School A, so this just
    // proves the endpoint is reachable and scoped correctly (an empty array
    // is a valid, honest result — not something to fabricate around).
    const academic = await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/academic-data`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(Array.isArray(academic.body)).toBe(true);

    const attendanceRes = await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/attendance`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect((attendanceRes.body as Array<{ id: string }>).map((r) => r.id)).toContain(attendanceAId);

    const financials = await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/financials`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect((financials.body as Array<{ id: string }>).map((r) => r.id)).toContain(feeAId);

    const documents = await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/documents`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect((documents.body as Array<{ id: string }>).map((r) => r.id)).toContain(documentAId);

    const conversations = await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/conversations`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const conversationRows = conversations.body as Array<Record<string, unknown>>;
    expect(conversationRows.map((r) => r.id)).toContain(conversationAId);
    // Privacy check: message body text must never appear anywhere in the payload.
    const serialized = JSON.stringify(conversationRows);
    expect(serialized).not.toContain('last_message_body');
    expect(serialized.includes('"body"')).toBe(false);

    await request(app.getHttpServer())
      .post(`/super-admin/privileged-access/grants/${grantId}/end`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(201);
  });

  it('A grant rejects reads for scopes outside its declared set', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/super-admin/privileged-access/grants')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ schoolId: schoolAId, reason: 'Aggregates only', scopes: ['SCHOOL_AGGREGATES'], durationMinutes: 60 })
      .expect(201);
    const grantId = createRes.body.id as string;

    await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/aggregates`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/students`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/super-admin/privileged-access/grants/${grantId}/end`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(201);
  });

  it('An expired grant is rejected even though its stored status is still ACTIVE', async () => {
    const grantId = randomUUID();
    const past = new Date(Date.now() - 60_000).toISOString();
    const { error: insertErr } = await admin.from('privileged_access_grants').insert({
      id: grantId,
      super_admin_user_id: superAdminUserId,
      target_school_id: schoolAId,
      reason: 'Expired test grant',
      access_level: 'READ_ONLY',
      scopes: ['SCHOOL_AGGREGATES'],
      status: 'ACTIVE',
      expires_at: past,
      updated_at: past,
    });
    expect(insertErr).toBeNull();

    await request(app.getHttpServer())
      .get(`/super-admin/privileged-access/schools/${schoolAId}/aggregates`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(403);

    // Rejection lazily flips the stored status too, for display purposes.
    const { data: row } = await admin.from('privileged_access_grants').select('status').eq('id', grantId).single();
    expect(row?.status).toBe('EXPIRED');
  });

  it('Grant history (Audit & Security) includes grants created during this run, and is only visible with VIEW_AUDIT_LOGS', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/privileged-access/grants')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const schoolIds = (res.body as Array<{ targetSchoolId: string }>).map((g) => g.targetSchoolId);
    expect(schoolIds).toContain(schoolAId);

    await request(app.getHttpServer())
      .get('/super-admin/privileged-access/grants')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .expect(403);
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot request privileged access', async () => {
    await request(app.getHttpServer())
      .post('/super-admin/privileged-access/grants')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ schoolId: schoolAId, reason: 'Should fail', scopes: ['SCHOOL_AGGREGATES'], durationMinutes: 30 })
      .expect(403);
    await request(app.getHttpServer())
      .post('/super-admin/privileged-access/grants')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ schoolId: schoolAId, reason: 'Should fail', scopes: ['SCHOOL_AGGREGATES'], durationMinutes: 30 })
      .expect(403);
  });

  it('School A admin still cannot see School B students — the general tenant boundary is unchanged by this phase', async () => {
    const res = await request(app.getHttpServer())
      .get('/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
    expect(ids).not.toContain(studentBId);
  });

  // ---------------------------------------------------------------------------
  // Full audit log viewer (Phase 11) — a searchable, filterable, paginated
  // read over the audit_logs rows every earlier phase in this test run has
  // already generated (school.create, module.enable, privileged_access.grant,
  // etc.) — real data, not seeded fakes.
  // ---------------------------------------------------------------------------

  it('Filtering by action returns the real school.create row for createdSchoolId', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/audit-logs')
      .query({ action: 'school.create', entityId: createdSchoolId })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const rows = res.body.rows as Array<{ action: string; entity_id: string }>;
    expect(rows.every((r) => r.action === 'school.create' && r.entity_id === createdSchoolId)).toBe(true);
  });

  it('A `to` date before this test run started excludes rows created during it', async () => {
    const beforeRunStarted = new Date(suffix - 1000).toISOString();
    const res = await request(app.getHttpServer())
      .get('/super-admin/audit-logs')
      .query({ entityId: createdSchoolId, to: beforeRunStarted })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(res.body.total).toBe(0);
    expect(res.body.rows).toEqual([]);
  });

  it('The schoolId filter only returns rows for that school', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/audit-logs')
      .query({ schoolId: schoolAId, pageSize: 200 })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const rows = res.body.rows as Array<{ school_id: string | null }>;
    expect(rows.every((r) => r.school_id === schoolAId)).toBe(true);
  });

  it('Free-text search matches by school name and by action text', async () => {
    const bySchoolName = await request(app.getHttpServer())
      .get('/super-admin/audit-logs')
      .query({ q: `Test School Alpha ${suffix}`, pageSize: 200 })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const schoolIds = (bySchoolName.body.rows as Array<{ school_id: string | null }>).map((r) => r.school_id);
    expect(schoolIds).toContain(schoolAId);

    const byAction = await request(app.getHttpServer())
      .get('/super-admin/audit-logs')
      .query({ q: 'curriculum_change' })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(byAction.body.total).toBeGreaterThanOrEqual(1);
    expect((byAction.body.rows as Array<{ action: string }>).every((r) => r.action === 'school.curriculum_change')).toBe(true);
  });

  it('Pagination returns disjoint pages and a consistent total', async () => {
    const page1 = await request(app.getHttpServer())
      .get('/super-admin/audit-logs')
      .query({ pageSize: 5, page: 1 })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const page2 = await request(app.getHttpServer())
      .get('/super-admin/audit-logs')
      .query({ pageSize: 5, page: 2 })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    expect(page1.body.total).toBe(page2.body.total);
    expect(page1.body.total).toBeGreaterThan(5); // this run alone logs far more than 5 actions
    const idsPage1 = (page1.body.rows as Array<{ id: string }>).map((r) => r.id);
    const idsPage2 = (page2.body.rows as Array<{ id: string }>).map((r) => r.id);
    expect(idsPage1.some((id) => idsPage2.includes(id))).toBe(false);
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot view the audit log', async () => {
    await request(app.getHttpServer()).get('/super-admin/audit-logs').set('Authorization', `Bearer ${tokenA}`).expect(403);
    await request(app.getHttpServer()).get('/super-admin/audit-logs').set('Authorization', `Bearer ${tokenReducedSuperAdmin}`).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Billing (Phase 12) — a manual invoice ledger against school subscriptions.
  // schoolAId has had an ACTIVE Professional subscription since the Phase 5/7
  // package tests, above; schoolBId has never had one.
  // ---------------------------------------------------------------------------

  it('Generating an invoice snapshots the current package price/currency/cycle', async () => {
    const { data: sub } = await admin
      .from('school_subscriptions')
      .select('package:packages(price, currency, billing_cycle)')
      .eq('school_id', schoolAId)
      .eq('status', 'ACTIVE')
      .single();
    const pkg = sub!.package as unknown as { price: number; currency: string; billing_cycle: string };

    const periodStart = new Date().toISOString().slice(0, 10);
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const res = await request(app.getHttpServer())
      .post(`/super-admin/billing/schools/${schoolAId}/invoices`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ periodStart, periodEnd, dueDate })
      .expect(201);

    createdInvoiceId = res.body.id;
    expect(Number(res.body.amount)).toBe(Number(pkg.price));
    expect(res.body.currency).toBe(pkg.currency);
    expect(res.body.billing_cycle).toBe(pkg.billing_cycle);
    expect(res.body.status).toBe('PENDING');
  });

  it('Generating an invoice for a school with no active subscription is rejected', async () => {
    const periodStart = new Date().toISOString().slice(0, 10);
    await request(app.getHttpServer())
      .post(`/super-admin/billing/schools/${schoolBId}/invoices`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ periodStart, periodEnd: periodStart, dueDate: periodStart })
      .expect(400);
  });

  it('Marking an invoice PAID sets paid_at and makes it immutable', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/super-admin/billing/invoices/${createdInvoiceId}`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ status: 'PAID' })
      .expect(200);
    expect(res.body.status).toBe('PAID');
    expect(res.body.paid_at).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/super-admin/billing/invoices/${createdInvoiceId}`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ status: 'CANCELLED' })
      .expect(400);
  });

  it('A PENDING invoice past its due date shows as OVERDUE after the sweep', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: sub } = await admin
      .from('school_subscriptions')
      .select('id, package:packages(id, name, price, currency, billing_cycle)')
      .eq('school_id', schoolAId)
      .eq('status', 'ACTIVE')
      .single();
    const pkg = sub!.package as unknown as { id: string; name: string; price: number; currency: string; billing_cycle: string };

    const overdueInvoiceId = randomUUID();
    const { error } = await admin.from('platform_invoices').insert({
      id: overdueInvoiceId,
      school_id: schoolAId,
      subscription_id: sub!.id,
      package_id: pkg.id,
      package_name: pkg.name,
      amount: pkg.price,
      currency: pkg.currency,
      billing_cycle: pkg.billing_cycle,
      period_start: past,
      period_end: past,
      due_date: past,
      status: 'PENDING',
      updated_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    const list = await request(app.getHttpServer())
      .get(`/super-admin/billing/schools/${schoolAId}/invoices`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const row = (list.body as Array<{ id: string; status: string }>).find((r) => r.id === overdueInvoiceId);
    expect(row?.status).toBe('OVERDUE');

    const overview = await request(app.getHttpServer())
      .get('/super-admin/billing/overview')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect((overview.body.overdueInvoices as Array<{ id: string }>).some((inv) => inv.id === overdueInvoiceId)).toBe(true);
    expect(overview.body.outstandingByCurrency[pkg.currency]).toBeGreaterThanOrEqual(Number(pkg.price));

    // Clean up so this stray OVERDUE row doesn't linger in the overview for other assertions.
    await request(app.getHttpServer())
      .patch(`/super-admin/billing/invoices/${overdueInvoiceId}`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ status: 'CANCELLED' })
      .expect(200);
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot manage billing', async () => {
    await request(app.getHttpServer()).get('/super-admin/billing/overview').set('Authorization', `Bearer ${tokenA}`).expect(403);
    await request(app.getHttpServer()).get('/super-admin/billing/overview').set('Authorization', `Bearer ${tokenReducedSuperAdmin}`).expect(403);
    await request(app.getHttpServer())
      .post(`/super-admin/billing/schools/${schoolAId}/invoices`)
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ periodStart: '2026-01-01', periodEnd: '2026-02-01', dueDate: '2026-01-15' })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // System Health (Phase 13) — a real-time operational snapshot: every number
  // traces back to a live query or a real row, no invented uptime/verdicts.
  // ---------------------------------------------------------------------------

  it('The system health overview reports real, live-measured signals across all 5 areas', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/system-health/overview')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);

    expect(res.body.api.status).toBe('OK');
    expect(typeof res.body.api.version).toBe('string');

    expect(res.body.database.status).toBe('OK');
    expect(res.body.database.latencyMs).toBeGreaterThanOrEqual(0);

    // This run alone has already generated real auth.login events (seedUser signs
    // every fixture in via password auth), so this is a real, non-zero count.
    expect(res.body.auth.last24h.logins).toBeGreaterThanOrEqual(1);
    expect(res.body.auth.last24h.failures).toBeGreaterThanOrEqual(0);
    expect(res.body.auth.last7d.logins).toBeGreaterThanOrEqual(res.body.auth.last24h.logins);

    expect(res.body.notifications.pending).toBeGreaterThanOrEqual(0);
    expect(res.body.notifications.sentLast24h).toBeGreaterThanOrEqual(0);
    expect(res.body.notifications.failedLast24h).toBeGreaterThanOrEqual(0);
    expect(['OK', 'STALE', 'UNKNOWN']).toContain(res.body.notifications.lastDispatchStatus);

    expect(res.body.payments.paidToday).toBeGreaterThanOrEqual(0);
    expect(res.body.payments.paidThisWeek).toBeGreaterThanOrEqual(0);
    expect(res.body.payments.pendingCount).toBeGreaterThanOrEqual(0);
    expect(res.body.payments.failedLast24h).toBeGreaterThanOrEqual(0);
    expect(res.body.payments.totalCollectedThisWeek).toBeGreaterThanOrEqual(0);
    expect(res.body.payments.webhookDeliveries.successLast24h).toBeGreaterThanOrEqual(0);
    expect(res.body.payments.webhookDeliveries.failedLast24h).toBeGreaterThanOrEqual(0);
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot view system health', async () => {
    await request(app.getHttpServer()).get('/super-admin/system-health/overview').set('Authorization', `Bearer ${tokenA}`).expect(403);
    await request(app.getHttpServer()).get('/super-admin/system-health/overview').set('Authorization', `Bearer ${tokenReducedSuperAdmin}`).expect(403);
  });

  // ---------------------------------------------------------------------------
  // Assessments/gradebook schema-drift fix — the live `assessments` table
  // never matched what assessments.service.ts assumed (max_score/date/kind/
  // created_by_id don't exist; real columns are max_marks/assessment_date/
  // teacher_id NOT NULL). This is the first real end-to-end coverage this
  // feature has ever had.
  // ---------------------------------------------------------------------------

  it('Creating an assessment threads teacher_id/description correctly, and a TEACHER only sees assessments assigned to them', async () => {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const subjectAId = randomUUID();
    const termAId = randomUUID();

    await admin.from('subjects').insert({ id: subjectAId, school_id: schoolAId, name: `Test Subject ${suffix}`, code: 'TST', updated_at: now });
    await admin.from('terms').insert({ id: termAId, school_id: schoolAId, name: `Test Term ${suffix}`, start_date: today, end_date: today, is_current: true });
    await admin.from('subject_assignments').insert({ id: randomUUID(), class_id: classAId, subject_id: subjectAId, teacher_id: teacherATeacherId });

    const createRes = await request(app.getHttpServer())
      .post('/assessments')
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .send({ classId: classAId, subjectId: subjectAId, termId: termAId, name: 'Mid-term', maxMarks: 100, assessmentDate: today, description: 'A test description' })
      .expect(201);
    const assessmentId = createRes.body.id as string;
    expect(createRes.body.max_marks).toBe(100);
    expect(createRes.body.assessment_date).toBe(today);

    // teacher_id/description aren't in the API's select-back — verify the actual row directly.
    const { data: row } = await admin.from('assessments').select('teacher_id, description').eq('id', assessmentId).single();
    expect(row?.teacher_id).toBe(teacherATeacherId);
    expect(row?.description).toBe('A test description');

    await request(app.getHttpServer())
      .post(`/assessments/${assessmentId}/scores`)
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .send({ scores: [{ studentId: studentAId, marksObtained: 85, comments: 'Great job' }] })
      .expect(201);

    const scores = await request(app.getHttpServer())
      .get(`/assessments/${assessmentId}/scores`)
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .expect(200);
    expect(scores.body.assessment.max_marks).toBe(100);
    expect(scores.body.scores[0].marks_obtained).toBe(85);

    const studentGrades = await request(app.getHttpServer())
      .get('/assessments/grades')
      .query({ studentId: studentAId, termId: termAId })
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .expect(200);
    expect((studentGrades.body as Array<{ assessment: { id: string } }>).some((g) => g.assessment.id === assessmentId)).toBe(true);

    const listRes = await request(app.getHttpServer())
      .get('/assessments')
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .expect(200);
    expect((listRes.body as Array<{ id: string }>).map((a) => a.id)).toContain(assessmentId);

    // A second teacher in the SAME school, not assigned to this class/subject,
    // must not see it — this is exactly the bug that was fixed (list() used to
    // filter by a nonexistent created_by_id column instead of teacher_id).
    const email2 = `teacher-a2-${suffix}@test-isolation.internal`;
    const password2 = `TestPass${suffix}!`;
    const { data: authData2 } = await admin.auth.admin.createUser({
      email: email2, password: password2, email_confirm: true,
      user_metadata: { school_id: schoolAId, role: 'TEACHER' },
    });
    authUserIds.push(authData2!.user.id);
    const { data: teacherUserRow2 } = await admin.from('users').select('id').eq('auth_id', authData2!.user.id).single();
    const teacher2Id = randomUUID();
    await admin.from('teachers').insert({ id: teacher2Id, school_id: schoolAId, user_id: teacherUserRow2!.id, staff_no: `TA2-${suffix}`, updated_at: now });
    const anon2 = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
    });
    const { data: session2 } = await anon2.auth.signInWithPassword({ email: email2, password: password2 });
    const tokenTeacherA2 = session2!.session!.access_token;

    const listResA2 = await request(app.getHttpServer())
      .get('/assessments')
      .set('Authorization', `Bearer ${tokenTeacherA2}`)
      .expect(200);
    expect((listResA2.body as Array<{ id: string }>).map((a) => a.id)).not.toContain(assessmentId);

    // ADMIN sees every assessment in their school regardless of teacher_id.
    const listResAdmin = await request(app.getHttpServer())
      .get('/assessments')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect((listResAdmin.body as Array<{ id: string }>).map((a) => a.id)).toContain(assessmentId);

    // cleanup
    await admin.from('teachers').delete().eq('id', teacher2Id);
    await admin.from('grades').delete().eq('assessment_id', assessmentId);
    await admin.from('assessments').delete().eq('id', assessmentId);
    await admin.from('subject_assignments').delete().eq('subject_id', subjectAId);
    await admin.from('terms').delete().eq('id', termAId);
    await admin.from('subjects').delete().eq('id', subjectAId);
  });

  // ---------------------------------------------------------------------------
  // Platform Users (deferred item) — cross-tenant user search + SUPER_ADMIN
  // account administration. Before this, there was no way to create a
  // SUPER_ADMIN or edit anyone's platform_permissions except raw DB access.
  // ---------------------------------------------------------------------------

  it('Cross-tenant search finds a known fixture user and a status toggle round-trips', async () => {
    const search = await request(app.getHttpServer())
      .get('/super-admin/platform-users')
      .query({ q: `admin-a-${suffix}` })
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    const rows = search.body.rows as Array<{ id: string; email: string; school: { id: string } | null }>;
    const found = rows.find((r) => r.email === `admin-a-${suffix}@test-isolation.internal`);
    expect(found).toBeTruthy();
    expect(found?.school?.id).toBe(schoolAId);

    const toggled = await request(app.getHttpServer())
      .patch(`/super-admin/platform-users/${found!.id}/status`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ isActive: false })
      .expect(200);
    expect(toggled.body.is_active).toBe(false);

    // Restore, so this doesn't affect any later test relying on admin-a being active.
    await request(app.getHttpServer())
      .patch(`/super-admin/platform-users/${found!.id}/status`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ isActive: true })
      .expect(200);
  });

  it('Creating a SUPER_ADMIN grants all permissions via the trigger, and permissions can then be narrowed', async () => {
    const email = `new-super-admin-${suffix}@test-isolation.internal`;
    const createRes = await request(app.getHttpServer())
      .post('/super-admin/platform-users/super-admins')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ fullName: 'New Super Admin', email })
      .expect(201);
    expect(createRes.body.platform_permissions.length).toBe(17);
    const newAdminId = createRes.body.id as string;
    const temporaryPassword = createRes.body.temporaryPassword as string;

    const { data: authRow } = await admin.from('users').select('auth_id').eq('id', newAdminId).single();
    authUserIds.push(authRow!.auth_id);

    const list = await request(app.getHttpServer())
      .get('/super-admin/platform-users/super-admins')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect((list.body as Array<{ id: string }>).map((a) => a.id)).toContain(newAdminId);

    // Narrow to a single permission.
    await request(app.getHttpServer())
      .patch(`/super-admin/platform-users/super-admins/${newAdminId}/permissions`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ permissions: ['VIEW_SCHOOLS'] })
      .expect(200);

    // Sign in as the new account and confirm /auth/me reflects the narrowed set.
    const anonNew = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
    });
    const { data: session } = await anonNew.auth.signInWithPassword({ email, password: temporaryPassword });
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${session!.session!.access_token}`)
      .expect(200);
    expect(me.body.platformPermissions).toEqual(['VIEW_SCHOOLS']);
  });

  it('A regular ADMIN and a zero-permission SUPER_ADMIN cannot manage platform users', async () => {
    await request(app.getHttpServer()).get('/super-admin/platform-users').set('Authorization', `Bearer ${tokenA}`).expect(403);
    await request(app.getHttpServer()).get('/super-admin/platform-users').set('Authorization', `Bearer ${tokenReducedSuperAdmin}`).expect(403);
    await request(app.getHttpServer()).get('/super-admin/platform-users/super-admins').set('Authorization', `Bearer ${tokenReducedSuperAdmin}`).expect(403);
    await request(app.getHttpServer())
      .post('/super-admin/platform-users/super-admins')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .send({ fullName: 'Should fail', email: `should-fail-${suffix}@test-isolation.internal` })
      .expect(403);
  });

  // ---------------------------------------------------------------------------
  // Platform Settings (deferred item) — read-only deployment config viewer.
  // ---------------------------------------------------------------------------

  it('Settings overview returns real deployment config and is permission-gated', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/settings/overview')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .expect(200);
    expect(typeof res.body.notificationSenderEmail).toBe('string');
    expect(typeof res.body.appUrl).toBe('string');
    expect(typeof res.body.webhookSecretConfigured).toBe('boolean');

    await request(app.getHttpServer()).get('/super-admin/settings/overview').set('Authorization', `Bearer ${tokenA}`).expect(403);
    await request(app.getHttpServer()).get('/super-admin/settings/overview').set('Authorization', `Bearer ${tokenReducedSuperAdmin}`).expect(403);
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

  // ---------------------------------------------------------------------------
  // Bug fixes and messaging improvements — Tasks 1-5
  // ---------------------------------------------------------------------------

  /** Same pattern as seedUser() inside beforeAll, exposed here for tests that
   * run after beforeAll has finished (that function's closure isn't reachable). */
  async function createExtraUser(schoolId: string | null, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT', label: string) {
    const email = `${label}-${suffix}@test-isolation.internal`;
    const password = `TestPass${suffix}!`;
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { school_id: schoolId, role },
    });
    if (authErr) throw new Error(`Auth user create failed (${label}): ${authErr.message}`);
    authUserIds.push(authData.user.id);
    const userId = randomUUID();
    await admin.from('users').upsert({
      id: userId, school_id: schoolId, auth_id: authData.user.id,
      email, full_name: `Test ${label}`, role, updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_id' });
    const { data: row } = await admin.from('users').select('id').eq('auth_id', authData.user.id).single();
    const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
    });
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`Sign-in failed (${label}): ${signInErr.message}`);
    return { authId: authData.user.id, userId: row?.id ?? userId, token: session.session!.access_token };
  }

  it('Task 1: the permission-denial message is action-oriented, not just a raw key', async () => {
    const res = await request(app.getHttpServer())
      .get('/super-admin/schools')
      .set('Authorization', `Bearer ${tokenReducedSuperAdmin}`)
      .expect(403);
    expect(res.body.message).toMatch(/platform permission/i);
    expect(res.body.message).toMatch(/ask another superadmin/i);
  });

  it('Task 2: a parent composing a first message to a teacher succeeds (regression for the on_conflict 500)', async () => {
    const parent = await createExtraUser(schoolAId, 'PARENT', 'task2-parent');
    const { data: teacherRow } = await admin.from('teachers').select('user_id').eq('id', teacherATeacherId).single();

    const res = await request(app.getHttpServer())
      .post('/messaging/conversations')
      .set('Authorization', `Bearer ${parent.token}`)
      .send({ recipientUserId: teacherRow!.user_id, firstMessage: 'Hello, checking in about homework.' })
      .expect(201);
    expect(res.body.id).toBeDefined();

    // Composing again to the same teacher must find the existing thread, not error.
    const res2 = await request(app.getHttpServer())
      .post('/messaging/conversations')
      .set('Authorization', `Bearer ${parent.token}`)
      .send({ recipientUserId: teacherRow!.user_id, firstMessage: 'Following up.' })
      .expect(201);
    expect(res2.body.id).toBe(res.body.id);

    await admin.from('messages').delete().eq('conversation_id', res.body.id);
    await admin.from('conversations').delete().eq('id', res.body.id);
  });

  it('Task 2: a malformed compose body returns 400 with a real message, not a bare 500', async () => {
    const parent = await createExtraUser(schoolAId, 'PARENT', 'task2-badbody-parent');
    const res = await request(app.getHttpServer())
      .post('/messaging/conversations')
      .set('Authorization', `Bearer ${parent.token}`)
      .send({ firstMessage: '' }) // missing recipientUserId, empty message
      .expect(400);
    expect(res.body.message).toBeDefined();
  });

  it('Task 3: admin can message a teacher and a parent at their own school, with bypass_quiet_hours honored', async () => {
    const { data: teacherRow } = await admin.from('teachers').select('user_id').eq('id', teacherATeacherId).single();
    const parent = await createExtraUser(schoolAId, 'PARENT', 'task3-parent');

    const toTeacher = await request(app.getHttpServer())
      .post('/messaging/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recipientUserId: teacherRow!.user_id, recipientRole: 'TEACHER', firstMessage: 'Staff meeting Friday.', bypassQuietHours: true })
      .expect(201);

    const { data: msgRow } = await admin.from('messages').select('bypass_quiet_hours').eq('conversation_id', toTeacher.body.id).single();
    expect(msgRow?.bypass_quiet_hours).toBe(true);

    const { data: auditRow } = await admin.from('audit_logs').select('action, metadata')
      .eq('entity_id', toTeacher.body.id).eq('action', 'message.admin_send').maybeSingle();
    expect(auditRow?.action).toBe('message.admin_send');

    const toParent = await request(app.getHttpServer())
      .post('/messaging/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recipientUserId: parent.userId, recipientRole: 'PARENT', firstMessage: 'Reminder about the trip form.' })
      .expect(201);
    expect(toParent.body.id).toBeDefined();

    await admin.from('messages').delete().in('conversation_id', [toTeacher.body.id, toParent.body.id]);
    await admin.from('conversations').delete().in('id', [toTeacher.body.id, toParent.body.id]);
  });

  it('Task 3: School A admin cannot message a School B teacher (cross-tenant)', async () => {
    const { data: teacherBRow } = await admin.from('teachers').select('user_id').eq('id', teacherBTeacherId).single();
    await request(app.getHttpServer())
      .post('/messaging/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recipientUserId: teacherBRow!.user_id, recipientRole: 'TEACHER', firstMessage: 'Hi' })
      .expect(400);
  });

  it('Task 3: a STUDENT can never be a conversation participant — rejected by RLS and by the unconditional trigger', async () => {
    const { data: studentRow } = await admin.from('students').select('user_id').eq('id', studentAId).single();
    const studentUserId = studentRow!.user_id;
    const { data: adminARow } = await admin.from('users').select('id').eq('email', `admin-a-${suffix}@test-isolation.internal`).single();
    const adminAUserId = adminARow!.id;

    // Well-formed admin+teacher shape in every other respect (passes the
    // CHECK constraint) — the only thing wrong is that the "teacher" slot is
    // actually a student, which is what should trigger the rejection.
    const rlsAttempt = await clientAs(tokenA)
      .from('conversations')
      .insert({ id: randomUUID(), school_id: schoolAId, admin_user_id: adminAUserId, teacher_user_id: studentUserId, parent_user_id: null })
      .select();
    expect(rlsAttempt.error).toBeTruthy();

    // Trigger: even the service-role client (which bypasses RLS entirely) is
    // blocked — same well-formed shape, service-role client this time.
    const parentForShape = await createExtraUser(schoolAId, 'PARENT', 'task3-trigger-parent');
    const triggerAttempt = await admin
      .from('conversations')
      .insert({ id: randomUUID(), school_id: schoolAId, teacher_user_id: studentUserId, parent_user_id: parentForShape.userId, admin_user_id: null });
    expect(triggerAttempt.error).toBeTruthy();
    expect(triggerAttempt.error?.message).toMatch(/student/i);
  });

  it('Task 4: a teacher can message a parent of a student they teach, grouped by student; out-of-scope is denied at both API and RLS', async () => {
    const now = new Date().toISOString();
    const subjectId = randomUUID();
    await admin.from('subjects').insert({ id: subjectId, school_id: schoolAId, name: `Task4 Subject ${suffix}`, code: 'T4', updated_at: now });
    await admin.from('subject_assignments').insert({ id: randomUUID(), class_id: classAId, subject_id: subjectId, teacher_id: teacherATeacherId });
    const { data: teacherARow } = await admin.from('teachers').select('user_id').eq('id', teacherATeacherId).single();
    const teacherAUserId = teacherARow!.user_id;

    const parent = await createExtraUser(schoolAId, 'PARENT', 'task4-parent');
    const guardianId = randomUUID();
    await admin.from('guardians').insert({ id: guardianId, user_id: parent.userId, student_id: studentAId, relationship: 'Mother' });

    const contacts = await request(app.getHttpServer())
      .get('/messaging/contacts')
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .expect(200);
    expect((contacts.body.contacts as Array<{ user_id: string }>).map((c) => c.user_id)).toContain(parent.userId);

    const ok = await request(app.getHttpServer())
      .post('/messaging/conversations')
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .send({ recipientUserId: parent.userId, studentId: studentAId, firstMessage: 'How is progress going?' })
      .expect(201);

    // A parent NOT linked to any student this teacher teaches is out of scope.
    const outOfScopeParent = await createExtraUser(schoolAId, 'PARENT', 'task4-outofscope-parent');
    await request(app.getHttpServer())
      .post('/messaging/conversations')
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .send({ recipientUserId: outOfScopeParent.userId, firstMessage: 'Hi' })
      .expect(403);

    // Defense in depth: RLS blocks it too, even bypassing the API's own check.
    const rlsAttempt = await clientAs(tokenTeacherA)
      .from('conversations')
      .insert({ id: randomUUID(), school_id: schoolAId, teacher_user_id: teacherAUserId, parent_user_id: outOfScopeParent.userId, admin_user_id: null })
      .select();
    expect(rlsAttempt.error).toBeTruthy();

    await admin.from('messages').delete().eq('conversation_id', ok.body.id);
    await admin.from('conversations').delete().eq('id', ok.body.id);
    await admin.from('guardians').delete().eq('id', guardianId);
    await admin.from('subject_assignments').delete().eq('subject_id', subjectId);
    await admin.from('subjects').delete().eq('id', subjectId);
  });

  it('Task 5: an assignment blocks submission after its deadline, but keeps past submissions visible and gradable', async () => {
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { data: teacherARow } = await admin.from('teachers').select('user_id').eq('id', teacherATeacherId).single();
    const teacherAUserId = teacherARow!.user_id;

    const openAssignmentId = randomUUID();
    const closedAssignmentId = randomUUID();
    await admin.from('assignments').insert([
      { id: openAssignmentId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Open', due_date: tomorrow, updated_at: now },
      { id: closedAssignmentId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Closed', due_date: yesterday, updated_at: now },
    ]);

    // Before deadline: student can submit.
    const openSub = await clientAs(tokenStudentA)
      .from('submissions')
      .insert({ id: randomUUID(), school_id: schoolAId, assignment_id: openAssignmentId, student_id: studentAId, content: 'my answer' })
      .select().single();
    expect(openSub.error).toBeNull();

    // After deadline: student cannot submit for the first time. Unlike UPDATE
    // (which silently filters rows the USING clause rejects), a failed INSERT
    // WITH CHECK raises a real RLS error.
    const closedSub = await clientAs(tokenStudentA)
      .from('submissions')
      .insert({ id: randomUUID(), school_id: schoolAId, assignment_id: closedAssignmentId, student_id: studentAId, content: 'too late' })
      .select();
    expect(closedSub.error).toBeTruthy();

    // Seed a submission directly (as if made before the deadline), then prove
    // the student can no longer resubmit it now that the deadline has passed —
    // but a teacher can still grade it, and the student can still read it.
    const pastSubId = randomUUID();
    await admin.from('submissions').insert({ id: pastSubId, school_id: schoolAId, assignment_id: closedAssignmentId, student_id: studentAId, content: 'original' });

    const resubmitAttempt = await clientAs(tokenStudentA)
      .from('submissions')
      .update({ content: 'trying to resubmit' })
      .eq('id', pastSubId)
      .select();
    expect(resubmitAttempt.data ?? []).toHaveLength(0);

    const teacherGrade = await clientAs(tokenTeacherA)
      .from('submissions')
      .update({ grade_score: 8, grade_comment: 'Good, though late-graded' })
      .eq('id', pastSubId)
      .select();
    expect(teacherGrade.error).toBeNull();
    expect(teacherGrade.data?.[0]?.grade_score).toBe(8);

    const studentRead = await clientAs(tokenStudentA).from('submissions').select('id, content, grade_score').eq('id', pastSubId).single();
    expect(studentRead.data?.content).toBe('original');
    expect(studentRead.data?.grade_score).toBe(8);

    await admin.from('submissions').delete().in('id', [openSub.data!.id, pastSubId]);
    await admin.from('assignments').delete().in('id', [openAssignmentId, closedAssignmentId]);
  });

  it('Task 5: a quiz blocks new/resumed attempts after closes_at, but keeps a past attempt visible', async () => {
    const inOneHour = new Date(Date.now() + 3_600_000).toISOString();
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { data: teacherARow } = await admin.from('teachers').select('user_id').eq('id', teacherATeacherId).single();
    const teacherAUserId = teacherARow!.user_id;

    const openQuizId = randomUUID();
    const closedQuizId = randomUUID();
    await admin.from('quizzes').insert([
      { id: openQuizId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Open Quiz', is_published: true, closes_at: inOneHour },
      { id: closedQuizId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Closed Quiz', is_published: true, closes_at: oneHourAgo },
    ]);

    // Before closes_at: starting an attempt succeeds.
    const openAttempt = await clientAs(tokenStudentA)
      .from('quiz_attempts')
      .insert({ id: randomUUID(), school_id: schoolAId, quiz_id: openQuizId, student_id: studentAId })
      .select().single();
    expect(openAttempt.error).toBeNull();

    // After closes_at: starting a new attempt is blocked (INSERT WITH CHECK
    // failure raises a real RLS error, unlike UPDATE's silent row filtering).
    const closedAttempt = await clientAs(tokenStudentA)
      .from('quiz_attempts')
      .insert({ id: randomUUID(), school_id: schoolAId, quiz_id: closedQuizId, student_id: studentAId })
      .select();
    expect(closedAttempt.error).toBeTruthy();

    // An attempt that was already in progress can no longer be saved/submitted either.
    const inProgressId = randomUUID();
    await admin.from('quiz_attempts').insert({ id: inProgressId, school_id: schoolAId, quiz_id: closedQuizId, student_id: studentAId, answers: { q1: 'a' } });
    const lateSave = await clientAs(tokenStudentA)
      .from('quiz_attempts')
      .update({ answers: { q1: 'b' }, submitted_at: new Date().toISOString() })
      .eq('id', inProgressId)
      .select();
    expect(lateSave.data ?? []).toHaveLength(0);

    // Still readable by the student, and still gradable by the teacher.
    const studentRead = await clientAs(tokenStudentA).from('quiz_attempts').select('id, answers').eq('id', inProgressId).single();
    expect(studentRead.data?.answers).toEqual({ q1: 'a' });

    const teacherGrade = await clientAs(tokenTeacherA)
      .from('quiz_attempts')
      .update({ score: 5, max_score: 10, submitted_at: new Date().toISOString() })
      .eq('id', inProgressId)
      .select();
    expect(teacherGrade.error).toBeNull();

    await admin.from('quiz_attempts').delete().in('id', [openAttempt.data!.id, inProgressId]);
    await admin.from('quizzes').delete().in('id', [openQuizId, closedQuizId]);
  });

  // ---------------------------------------------------------------------------
  // Departments, Class Teacher powers, and Behavior leaderboard
  // ---------------------------------------------------------------------------

  it('Task 1: admin can CRUD departments; non-admin cannot; cross-tenant isolated; soft-delete nulls department_id', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/departments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Mathematics' })
      .expect(201);
    const deptId = createRes.body.id as string;

    await request(app.getHttpServer())
      .post('/departments')
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .send({ name: 'Should fail' })
      .expect(403);

    // Cross-tenant: School B admin cannot see School A's department.
    const listB = await request(app.getHttpServer())
      .get('/departments')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect((listB.body as Array<{ id: string }>).map((d) => d.id)).not.toContain(deptId);

    // Assign a teacher, then soft-delete the department — the teacher's
    // department_id must be nulled by the trigger, teacher otherwise intact.
    await admin.from('teachers').update({ department_id: deptId }).eq('id', teacherATeacherId);
    await request(app.getHttpServer())
      .delete(`/departments/${deptId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const { data: teacherRow } = await admin.from('teachers').select('department_id, staff_no').eq('id', teacherATeacherId).single();
    expect(teacherRow?.department_id).toBeNull();
    expect(teacherRow?.staff_no).toBeTruthy(); // untouched otherwise

    const { data: deptRow } = await admin.from('departments').select('deleted_at').eq('id', deptId).single();
    expect(deptRow?.deleted_at).toBeTruthy();
  });

  it('Task 2: Class Teacher powers — own class succeeds, wrong class denied (API + RLS), cross-tenant denied, uniqueness enforced', async () => {
    const { data: teacherARow } = await admin.from('teachers').select('user_id').eq('id', teacherATeacherId).single();
    const teacherAUserId = teacherARow!.user_id;

    // Make teacherA the class teacher of classA for the duration of this test.
    await admin.from('teachers').update({ is_class_teacher_of: classAId }).eq('id', teacherATeacherId);

    try {
      // 2.1: full-class grades view — an assessment created by a genuinely
      // DIFFERENT teacher/subject in classA must still show up for the class
      // teacher, who has no subject_assignments row for it.
      const now = new Date().toISOString();
      const today = now.slice(0, 10);
      const otherTermId = randomUUID();
      const { error: termErr } = await admin.from('terms').insert({ id: otherTermId, school_id: schoolAId, name: `Task2 Term ${suffix}`, start_date: today, end_date: today, is_current: false });
      if (termErr) throw new Error(`fixture: term insert failed: ${termErr.message}`);

      const otherSubjectId = randomUUID();
      const { error: subjErr } = await admin.from('subjects').insert({ id: otherSubjectId, school_id: schoolAId, name: `Other Subject ${suffix}`, code: 'OTH', updated_at: now });
      if (subjErr) throw new Error(`fixture: subject insert failed: ${subjErr.message}`);

      const otherTeacher = await createExtraUser(schoolAId, 'TEACHER', 'task2-other-teacher');
      const otherTeacherId = randomUUID();
      const { error: teachErr2 } = await admin.from('teachers').insert({ id: otherTeacherId, school_id: schoolAId, user_id: otherTeacher.userId, staff_no: `OT-${suffix}`, updated_at: now });
      if (teachErr2) throw new Error(`fixture: teacher insert failed: ${teachErr2.message}`);

      const otherAssessmentId = randomUUID();
      const { error: assessErr } = await admin.from('assessments').insert({
        id: otherAssessmentId, school_id: schoolAId, class_id: classAId, subject_id: otherSubjectId, term_id: otherTermId,
        teacher_id: otherTeacherId, name: 'Other Assessment', max_marks: 100,
      });
      if (assessErr) throw new Error(`fixture: assessment insert failed: ${assessErr.message}`);

      const withClassId = await request(app.getHttpServer())
        .get('/assessments').query({ classId: classAId })
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .expect(200);
      expect((withClassId.body as Array<{ id: string }>).map((a) => a.id)).toContain(otherAssessmentId);

      // Without the classId param, teacherA (not assigned to that subject)
      // must NOT see it — confirms the exception is classId-scoped, not global.
      const withoutClassId = await request(app.getHttpServer())
        .get('/assessments')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .expect(200);
      expect((withoutClassId.body as Array<{ id: string }>).map((a) => a.id)).not.toContain(otherAssessmentId);

      // 2.2: broadcast to class parents — creates one conversation per parent, not a group.
      const bcParent = await createExtraUser(schoolAId, 'PARENT', 'task2-broadcast-parent');
      const guardianId = randomUUID();
      await admin.from('guardians').insert({ id: guardianId, user_id: bcParent.userId, student_id: studentAId, relationship: 'Father' });

      const broadcastRes = await request(app.getHttpServer())
        .post('/messaging/broadcast')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ classId: classAId, body: 'Reminder: trip forms due Friday.' })
        .expect(201);
      expect(broadcastRes.body.sent).toBeGreaterThanOrEqual(1);
      expect(broadcastRes.body.conversationIds).toEqual(expect.arrayContaining([expect.any(String)]));

      // 2.4: behaviour point without subject context — teacherA has no
      // subject_assignments row for classA, only is_class_teacher_of.
      const directBpInsert = await clientAs(tokenTeacherA)
        .from('behaviour_points')
        .insert({ id: randomUUID(), school_id: schoolAId, student_id: studentAId, teacher_id: teacherATeacherId, category: 'POSITIVE', points: 2, reason: 'Pastoral note' })
        .select();
      expect(directBpInsert.error).toBeNull();
      expect(directBpInsert.data).toHaveLength(1);

      // Wrong class: teacherA (class teacher of classA) has no standing over classB.
      await request(app.getHttpServer())
        .get('/assessments').query({ classId: classBId })
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .expect(403);

      // A parent NOT linked to any student in classA is out of scope for a
      // broadcast-style conversation insert, even via direct RLS.
      const outOfScopeParent = await createExtraUser(schoolAId, 'PARENT', 'task2-outofscope-parent');
      const rlsWrongClass = await clientAs(tokenTeacherA)
        .from('conversations')
        .insert({ id: randomUUID(), school_id: schoolAId, teacher_user_id: teacherAUserId, parent_user_id: outOfScopeParent.userId, admin_user_id: null })
        .select();
      expect(rlsWrongClass.error).toBeTruthy();

      // Cross-tenant: teacherA cannot broadcast to classB (School B).
      await request(app.getHttpServer())
        .post('/messaging/broadcast')
        .set('Authorization', `Bearer ${tokenTeacherA}`)
        .send({ classId: classBId, body: 'Hi' })
        .expect(403);

      // Uniqueness: teacherB cannot also become class teacher of classA.
      const uniqueAttempt = await admin.from('teachers').update({ is_class_teacher_of: classAId }).eq('id', teacherBTeacherId).select();
      expect(uniqueAttempt.error).toBeTruthy();

      await admin.from('messages').delete().in('conversation_id', broadcastRes.body.conversationIds);
      await admin.from('conversations').delete().in('id', broadcastRes.body.conversationIds);
      await admin.from('guardians').delete().eq('id', guardianId);
      await admin.from('behaviour_points').delete().eq('student_id', studentAId).eq('reason', 'Pastoral note');
      await admin.from('assessments').delete().eq('id', otherAssessmentId);
      await admin.from('teachers').delete().eq('id', otherTeacherId);
      await admin.from('subjects').delete().eq('id', otherSubjectId);
      await admin.from('terms').delete().eq('id', otherTermId);
    } finally {
      await admin.from('teachers').update({ is_class_teacher_of: null }).eq('id', teacherATeacherId);
    }
  });

  it('Task 3: leaderboard visibility caps per role, and cross-tenant isolation', async () => {
    const now = new Date().toISOString();
    const bpIds = [randomUUID(), randomUUID()];
    await admin.from('behaviour_points').insert([
      { id: bpIds[0], school_id: schoolAId, student_id: studentAId, teacher_id: teacherATeacherId, category: 'POSITIVE', points: 5, reason_category: 'academic', reason: 'Great essay', date: now.slice(0, 10) },
      { id: bpIds[1], school_id: schoolBId, student_id: studentBId, teacher_id: teacherBTeacherId, category: 'POSITIVE', points: 5, reason_category: 'academic', reason: 'Great essay', date: now.slice(0, 10) },
    ]);

    // Student/parent: school-wide only, denied for class/grade scope.
    const studentView = await request(app.getHttpServer())
      .get('/behaviour/leaderboard').query({ window: 'all', scope: 'school' })
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(200);
    expect((studentView.body.rows as Array<{ studentId: string }>).map((r) => r.studentId)).toContain(studentAId);
    expect((studentView.body.rows as Array<{ studentId: string }>).map((r) => r.studentId)).not.toContain(studentBId);

    await request(app.getHttpServer())
      .get('/behaviour/leaderboard').query({ window: 'all', scope: 'class', classId: classAId })
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .expect(403);

    // Grade-scope is not in any TEACHER's visibility at all, regardless of
    // what they teach — denied unconditionally, before any assignment check.
    await request(app.getHttpServer())
      .get('/behaviour/leaderboard').query({ window: 'all', scope: 'grade', gradeLevel: 1 })
      .set('Authorization', `Bearer ${tokenTeacherA}`)
      .expect(403);

    // Admin: full ranking for a specific class (uncapped).
    const adminClassView = await request(app.getHttpServer())
      .get('/behaviour/leaderboard').query({ window: 'all', scope: 'class', classId: classAId })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(adminClassView.body.capped).toBe(false);

    await admin.from('behaviour_points').delete().in('id', bpIds);
  });
});
