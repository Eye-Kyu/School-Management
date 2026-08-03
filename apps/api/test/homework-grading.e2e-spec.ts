// =============================================================================
// Homework grading (PATCH /homework/:homeworkId/submissions/:submissionId/grade)
// — Bucket 1, PR 2a
// =============================================================================
// Homework had zero grading capability before this PR (see
// docs/audits/homework-quiz-gradebook-relationship.md). This covers the
// genuinely new, real-RLS-dependent behavior: creator/class-teacher/admin
// authorization, cross-tenant isolation (both at the API and at the RLS
// layer directly), the score-vs-max_score DB trigger, the notification +
// dashboard-feed integration, and that the endpoint can never touch
// completed_at regardless of what a request body contains. Score-vs-max_score
// app-layer validation and the authorization branch logic already have unit
// coverage in homework.service.spec.ts against a mocked Supabase client —
// this file is deliberately not a re-test of that.
//
// Each test that mutates a submission's grade gets its own fresh
// homework_completions row (via createSubmission()) rather than sharing one
// across the file — avoids any ordering hazard between tests.
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

describe('Homework grading (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;

  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const authUserIds: string[] = [];

  let classAId: string;
  let teacherACreatorId: string; // teachers.id — creates the homework
  let teacherACreatorToken: string;
  let teacherAClassTeacherToken: string; // is_class_teacher_of classAId, didn't create the homework
  let teacherAOutsiderToken: string; // neither creator nor class teacher
  let teacherBToken: string; // school B

  let studentAId: string; // students.id
  let studentAUserToken: string;
  let parentAToken: string;

  let homeworkId: string;

  async function seedUser(schoolId: string, role: 'ADMIN' | 'PARENT' | 'TEACHER' | 'STUDENT', label: string) {
    const email = `${label}-${suffix}@test-hwgrade.internal`;
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

  // homework_completions has UNIQUE(homework_id, student_id) — only one row
  // can ever exist for this homework+student pair, so each test resets it to
  // a fresh, ungraded state via upsert (matching HomeworkService.complete()'s
  // own upsert convention) rather than inserting a new row. Sidesteps any
  // ordering dependency on the *grade values* between tests; each test starts
  // from a known ungraded baseline regardless of what an earlier test did.
  async function createSubmission() {
    const id = randomUUID();
    const { data } = await admin.from('homework_completions').upsert({
      id, school_id: schoolAId, homework_id: homeworkId, student_id: studentAId,
      completed_at: new Date().toISOString(), score: null, grader_note: null, graded_at: null, graded_by_user_id: null,
    }, { onConflict: 'homework_id,student_id' }).select('id').single();
    return data!.id as string;
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
      { id: schoolAId, name: `HW Grade Test School A ${suffix}`, slug: `hwgrade-test-a-${suffix}`, updated_at: now },
      { id: schoolBId, name: `HW Grade Test School B ${suffix}`, slug: `hwgrade-test-b-${suffix}`, updated_at: now },
    ]);

    classAId = randomUUID();
    await admin.from('classes').insert({ id: classAId, school_id: schoolAId, name: 'Class Grade Test', grade_level: 1, updated_at: now });

    const teacherCreator = await seedUser(schoolAId, 'TEACHER', 'hwgrade-teacher-creator');
    teacherACreatorToken = teacherCreator.token;
    teacherACreatorId = randomUUID();
    await admin.from('teachers').insert({ id: teacherACreatorId, school_id: schoolAId, user_id: teacherCreator.userId, staff_no: `HWC-${suffix}`, updated_at: now });

    const teacherClassTeacher = await seedUser(schoolAId, 'TEACHER', 'hwgrade-teacher-classteacher');
    teacherAClassTeacherToken = teacherClassTeacher.token;
    const classTeacherId = randomUUID();
    await admin.from('teachers').insert({
      id: classTeacherId, school_id: schoolAId, user_id: teacherClassTeacher.userId, staff_no: `HWT-${suffix}`,
      is_class_teacher_of: classAId, updated_at: now,
    });

    const teacherOutsider = await seedUser(schoolAId, 'TEACHER', 'hwgrade-teacher-outsider');
    teacherAOutsiderToken = teacherOutsider.token;
    const outsiderTeacherId = randomUUID();
    await admin.from('teachers').insert({ id: outsiderTeacherId, school_id: schoolAId, user_id: teacherOutsider.userId, staff_no: `HWO-${suffix}`, updated_at: now });

    const teacherB = await seedUser(schoolBId, 'TEACHER', 'hwgrade-teacher-b');
    teacherBToken = teacherB.token;

    const studentA = await seedUser(schoolAId, 'STUDENT', 'hwgrade-student-a');
    studentAUserToken = studentA.token;
    studentAId = randomUUID();
    await admin.from('students').insert({
      id: studentAId, school_id: schoolAId, user_id: studentA.userId, current_class_id: classAId,
      admission_no: `HWGRADE-${suffix}`, updated_at: now,
    });

    const parentA = await seedUser(schoolAId, 'PARENT', 'hwgrade-parent-a');
    parentAToken = parentA.token;
    await admin.from('guardians').insert({ id: randomUUID(), user_id: parentA.userId, student_id: studentAId, relationship: 'PARENT' });

    homeworkId = randomUUID();
    await admin.from('homework_assignments').insert({
      id: homeworkId, school_id: schoolAId, class_id: classAId, teacher_id: teacherACreatorId,
      title: 'Grading test homework', due_date: '2026-01-01', max_score: 10, updated_at: now,
    });
  });

  afterAll(async () => {
    await admin.from('homework_completions').delete().eq('homework_id', homeworkId);
    await admin.from('homework_assignments').delete().eq('id', homeworkId);
    await admin.from('guardians').delete().eq('student_id', studentAId);
    await admin.from('students').delete().eq('id', studentAId);
    await admin.from('classes').delete().eq('id', classAId);
    await admin.from('teachers').delete().eq('school_id', schoolAId);
    await admin.from('notifications').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('users').delete().in('auth_id', authUserIds);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    if (app) await app.close();
  });

  it('rejects an unauthorized teacher (not creator, not class teacher, not admin)', async () => {
    const submissionId = await createSubmission();
    await request(app.getHttpServer())
      .patch(`/homework/${homeworkId}/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${teacherAOutsiderToken}`)
      .send({ score: 5 })
      .expect(403);
  });

  it('cross-tenant: a School B teacher cannot grade a School A submission (404 — RLS hides the row at the SELECT step before authorization is even reached)', async () => {
    // homework_select RLS is school_id = current_school_id(), so teacherB's
    // own fetch of the School A homework row returns nothing — gradeSubmission()
    // 404s here, matching the same "hide existence via 404, not 403" pattern
    // already established elsewhere (e.g. MessagingService.markRead()).
    const submissionId = await createSubmission();
    await request(app.getHttpServer())
      .patch(`/homework/${homeworkId}/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${teacherBToken}`)
      .send({ score: 5 })
      .expect(404);
  });

  it('cross-tenant: RLS itself blocks a School B teacher from updating the row directly, not just app-layer checks', async () => {
    const submissionId = await createSubmission();
    const teacherB = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
      global: { headers: { Authorization: `Bearer ${teacherBToken}` } },
    });
    const { data, error } = await teacherB
      .from('homework_completions').update({ score: 5 }).eq('id', submissionId).select();
    // RLS silently excludes the row rather than throwing — zero rows affected.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('the class teacher (not the homework creator) can grade the submission', async () => {
    const submissionId = await createSubmission();
    const res = await request(app.getHttpServer())
      .patch(`/homework/${homeworkId}/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${teacherAClassTeacherToken}`)
      .send({ score: 4 })
      .expect(200);
    expect(res.body.score).toBe(4);
  });

  it('the DB trigger rejects a score exceeding max_score even via a direct write (defense in depth)', async () => {
    const submissionId = await createSubmission();
    const { error } = await admin
      .from('homework_completions').update({ score: 999 }).eq('id', submissionId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/exceeds homework max_score/);
  });

  it('a crafted request body cannot change completed_at, even from an authorized teacher', async () => {
    const submissionId = await createSubmission();
    const { data: before } = await admin.from('homework_completions').select('completed_at').eq('id', submissionId).single();

    await request(app.getHttpServer())
      .patch(`/homework/${homeworkId}/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${teacherACreatorToken}`)
      .send({ score: 6, completedAt: '2020-01-01T00:00:00.000Z', completed_at: '2020-01-01T00:00:00.000Z' })
      .expect(200);

    const { data: after } = await admin.from('homework_completions').select('completed_at').eq('id', submissionId).single();
    expect(after!.completed_at).toBe(before!.completed_at);
  });

  it('full grade flow: teacher creator grades a submission — score/note saved, notification queued, appears in the feed', async () => {
    const submissionId = await createSubmission();
    const res = await request(app.getHttpServer())
      .patch(`/homework/${homeworkId}/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${teacherACreatorToken}`)
      .send({ score: 7, graderNote: 'Good effort' })
      .expect(200);
    expect(res.body.score).toBe(7);
    expect(res.body.grader_note).toBe('Good effort');
    expect(res.body.graded_at).toBeTruthy();

    const feed = await request(app.getHttpServer())
      .get('/dashboard-feed')
      .set('Authorization', `Bearer ${studentAUserToken}`)
      .expect(200);
    const alert = feed.body.alerts.find((a: { notifType: string }) => a.notifType === 'HOMEWORK_GRADED');
    expect(alert).toBeDefined();
    expect(alert.href).toBe('/student/homework');
    expect(alert.body).toContain('7/10');

    // Parent RLS-scoped read, matching the real parent homework page's exact
    // query shape — proves the data path the page actually depends on, since
    // the Next.js page itself can't be rendered from this API-focused suite.
    const parentClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
      global: { headers: { Authorization: `Bearer ${parentAToken}` } },
    });
    const { data: parentView, error: parentErr } = await parentClient
      .from('homework_assignments')
      .select('id, title, max_score, completions:homework_completions(student_id, completed_at, score, grader_note)')
      .eq('id', homeworkId)
      .maybeSingle();
    expect(parentErr).toBeNull();
    const match = (parentView?.completions as { student_id: string; score: number | null }[] | null)
      ?.find((c) => c.student_id === studentAId);
    expect(match?.score).toBe(7);
  });
});
