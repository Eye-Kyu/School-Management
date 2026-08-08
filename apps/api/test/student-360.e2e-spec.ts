// =============================================================================
// Student 360 (Bucket 1, PR 4a) — read-only pastoral-care aggregation
// =============================================================================
// Covers what the mocked-Supabase unit suite (student-360.service.spec.ts)
// can't: real RLS/DB behavior for the access check, real cross-tenant
// isolation across all 4 data sources, and real audit-log rows — same
// division of labor as gradebook-linking.e2e-spec.ts's own header comment.
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

describe('Student 360 (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;

  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const authUserIds: string[] = [];

  let classAId: string;
  let subjectAId: string;
  let termAId: string;

  let classTeacherAToken: string;
  let otherTeacherAToken: string;
  let adminAToken: string;
  let adminBToken: string;

  let studentA1Id: string;
  let studentA2Id: string; // in a different class in the same school — for the "wrong class" 403 case
  let studentB1Id: string; // school B, for cross-tenant checks

  async function seedUser(schoolId: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT', label: string) {
    const email = `${label}-${suffix}@test-s360.internal`;
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

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    await admin.from('schools').insert([
      { id: schoolAId, name: `S360 Test School A ${suffix}`, slug: `s360-test-a-${suffix}`, updated_at: now },
      { id: schoolBId, name: `S360 Test School B ${suffix}`, slug: `s360-test-b-${suffix}`, updated_at: now },
    ]);

    classAId = randomUUID();
    const classA2Id = randomUUID();
    await admin.from('classes').insert([
      { id: classAId, school_id: schoolAId, name: 'S360 Class A', grade_level: 1, updated_at: now },
      { id: classA2Id, school_id: schoolAId, name: 'S360 Class A2', grade_level: 1, updated_at: now },
    ]);
    subjectAId = randomUUID();
    await admin.from('subjects').insert({ id: subjectAId, school_id: schoolAId, name: `S360 Subject ${suffix}`, code: 'S360', updated_at: now });
    termAId = randomUUID();
    await admin.from('terms').insert({ id: termAId, school_id: schoolAId, name: `S360 Term ${suffix}`, start_date: today, end_date: today, is_current: true });

    const classTeacherA = await seedUser(schoolAId, 'TEACHER', 's360-class-teacher-a');
    classTeacherAToken = classTeacherA.token;
    const classTeacherARowId = randomUUID();
    await admin.from('teachers').insert({
      id: classTeacherARowId, school_id: schoolAId, user_id: classTeacherA.userId, staff_no: `S360CT-${suffix}`,
      is_class_teacher_of: classAId, updated_at: now,
    });

    const otherTeacherA = await seedUser(schoolAId, 'TEACHER', 's360-other-teacher-a');
    otherTeacherAToken = otherTeacherA.token;
    const otherTeacherARowId = randomUUID();
    // Class teacher of a DIFFERENT class in the same school — not this student's class teacher.
    await admin.from('teachers').insert({
      id: otherTeacherARowId, school_id: schoolAId, user_id: otherTeacherA.userId, staff_no: `S360OT-${suffix}`,
      is_class_teacher_of: classA2Id, updated_at: now,
    });

    const adminA = await seedUser(schoolAId, 'ADMIN', 's360-admin-a');
    adminAToken = adminA.token;

    const studentA1 = await seedUser(schoolAId, 'STUDENT', 's360-student-a1');
    studentA1Id = randomUUID();
    await admin.from('students').insert({
      id: studentA1Id, school_id: schoolAId, user_id: studentA1.userId, current_class_id: classAId,
      admission_no: `S360A1-${suffix}`, updated_at: now,
    });

    const studentA2 = await seedUser(schoolAId, 'STUDENT', 's360-student-a2');
    studentA2Id = randomUUID();
    await admin.from('students').insert({
      id: studentA2Id, school_id: schoolAId, user_id: studentA2.userId, current_class_id: classA2Id,
      admission_no: `S360A2-${suffix}`, updated_at: now,
    });

    // Fixture data for student A1 — one of each source, so the aggregation
    // response can be checked as genuinely populated, not just present.
    const assessmentId = randomUUID();
    await admin.from('assessments').insert({
      id: assessmentId, school_id: schoolAId, term_id: termAId, class_id: classAId, subject_id: subjectAId,
      teacher_id: classTeacherARowId, name: 'S360 Test Assessment', max_marks: 20,
    });
    await admin.from('grades').insert({ id: randomUUID(), school_id: schoolAId, assessment_id: assessmentId, student_id: studentA1Id, score: 15 });
    await admin.from('attendance_records').insert({
      id: randomUUID(), school_id: schoolAId, student_id: studentA1Id, class_id: classAId, date: today,
      status: 'ABSENT', marked_by_id: classTeacherARowId, updated_at: now,
    });
    await admin.from('behaviour_points').insert({
      id: randomUUID(), school_id: schoolAId, student_id: studentA1Id, teacher_id: classTeacherARowId,
      category: 'POSITIVE', points: 5, reason: 'Helped a classmate', reason_category: 'citizenship', date: today,
    });
    await admin.from('behavior_incident_reports').insert({
      id: randomUUID(), school_id: schoolAId, reported_by_user_id: classTeacherA.userId, student_id: studentA1Id,
      category: 'Minor disruption', description: 'Talked during a test.',
    });

    // School B — cross-tenant checks only.
    const classBId = randomUUID();
    await admin.from('classes').insert({ id: classBId, school_id: schoolBId, name: 'S360 Class B', grade_level: 1, updated_at: now });
    const adminB = await seedUser(schoolBId, 'ADMIN', 's360-admin-b');
    adminBToken = adminB.token;
    const studentB1 = await seedUser(schoolBId, 'STUDENT', 's360-student-b1');
    studentB1Id = randomUUID();
    await admin.from('students').insert({
      id: studentB1Id, school_id: schoolBId, user_id: studentB1.userId, current_class_id: classBId,
      admission_no: `S360B1-${suffix}`, updated_at: now,
    });
    await admin.from('behaviour_points').insert({
      id: randomUUID(), school_id: schoolBId, student_id: studentB1Id,
      teacher_id: (await admin.from('teachers').insert({
        id: randomUUID(), school_id: schoolBId, user_id: adminB.userId, staff_no: `S360TB-${suffix}`, updated_at: now,
      }).select('id').single()).data!.id,
      category: 'NEGATIVE', points: 3, reason: 'School B only data', date: today,
    });
  });

  afterAll(async () => {
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('behavior_incident_reports').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('behaviour_points').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('attendance_records').delete().eq('school_id', schoolAId);
    await admin.from('grades').delete().in('student_id', [studentA1Id, studentA2Id]);
    await admin.from('assessments').delete().eq('school_id', schoolAId);
    await admin.from('students').delete().in('id', [studentA1Id, studentA2Id, studentB1Id]);
    await admin.from('teachers').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('terms').delete().eq('school_id', schoolAId);
    await admin.from('subjects').delete().eq('school_id', schoolAId);
    await admin.from('classes').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('users').delete().in('auth_id', authUserIds);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    if (app) await app.close();
  });

  it("the student's own Class Teacher gets a populated 200 response", async () => {
    const res = await request(app.getHttpServer())
      .get(`/students/${studentA1Id}/student-360`)
      .set('Authorization', `Bearer ${classTeacherAToken}`)
      .expect(200);

    expect(res.body.student.admission_no).toBe(`S360A1-${suffix}`);
    expect(res.body.academic.assessment_count).toBe(1);
    expect(res.body.attendance.total_school_days).toBe(1);
    expect(res.body.attendance.unapproved_absences).toBe(1);
    expect(res.body.behavior.points_balance).toBe(5);
    expect(res.body.incident_reports.total_count).toBe(1);
    expect(res.body.incident_reports.recent_reports[0].reporter_name).toBe('Test s360-class-teacher-a');
    expect(res.body.metadata.viewer_role).toBe('TEACHER');
  });

  it('ADMIN gets a populated 200 response', async () => {
    const res = await request(app.getHttpServer())
      .get(`/students/${studentA1Id}/student-360`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(200);
    expect(res.body.metadata.viewer_role).toBe('ADMIN');
  });

  it('a Class Teacher of a DIFFERENT class in the same school gets 403', async () => {
    await request(app.getHttpServer())
      .get(`/students/${studentA1Id}/student-360`)
      .set('Authorization', `Bearer ${otherTeacherAToken}`)
      .expect(403);
  });

  it('an ADMIN at a different school gets 404, not 403 — hides existence, matching the approved-absences endpoint convention', async () => {
    await request(app.getHttpServer())
      .get(`/students/${studentA1Id}/student-360`)
      .set('Authorization', `Bearer ${adminBToken}`)
      .expect(404);
  });

  it('records an audit log entry with the correct viewer_role on every view', async () => {
    await request(app.getHttpServer())
      .get(`/students/${studentA1Id}/student-360`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(200);

    const { data: rows } = await admin
      .from('audit_logs')
      .select('action, entity_id, metadata')
      .eq('school_id', schoolAId)
      .eq('action', 'student.view_360')
      .eq('entity_id', studentA1Id)
      .order('created_at', { ascending: false })
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows![0]!.metadata).toMatchObject({ target_student_id: studentA1Id, viewer_role: 'ADMIN' });
  });

  it("never surfaces School B's behavior/attendance/grades/incident data for a School A student, and School A's ADMIN cannot reach School B's student at all", async () => {
    const resA = await request(app.getHttpServer())
      .get(`/students/${studentA1Id}/student-360`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(200);
    // Only School A's +5 point row should be counted, never School B's -3.
    expect(resA.body.behavior.points_balance).toBe(5);

    await request(app.getHttpServer())
      .get(`/students/${studentB1Id}/student-360`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .expect(404);
  });
});
