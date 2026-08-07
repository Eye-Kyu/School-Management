// =============================================================================
// Gradebook linking layer (homework/quiz → assessments) — Bucket 1, PR 2b
// =============================================================================
// Covers what unit tests (homework.service.spec.ts / quizzes.service.spec.ts,
// mocked Supabase) can't: real RLS/DB behavior across the full link → cascade
// → unlink → recompute lifecycle, retroactive-rollup counts against real
// rows, the read-only backstop (API 403 + DB trigger, including a raw
// service-role write bypassing the API entirely), record_quiz_grade()'s new
// link-resolving one-parameter signature, and cross-tenant isolation of the
// new link-to-gradebook endpoints. Authorization branch logic (creator/admin
// checks) already has full unit coverage against a mocked client — this file
// is deliberately not a re-test of that (same convention as
// homework-grading.e2e-spec.ts's own header comment).
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

describe('Gradebook linking (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;

  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const authUserIds: string[] = [];

  let classAId: string;
  let subjectAId: string;
  let termAId: string;
  let teacherACreatorRowId: string; // teachers.id
  let teacherACreatorUserId: string; // users.id — quizzes.created_by_id compares against this
  let teacherACreatorToken: string;

  let studentA1Id: string;
  let studentA2Id: string;
  let studentA3Id: string;

  // School B — only enough to prove cross-tenant isolation of the new routes.
  let teacherBToken: string;

  const homeworkIds: string[] = [];
  const quizIds: string[] = [];
  const assessmentIds: string[] = [];

  async function seedUser(schoolId: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT', label: string) {
    const email = `${label}-${suffix}@test-gblink.internal`;
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

  function clientAs(token: string) {
    return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }

  async function createHomework(maxScore: number) {
    const id = randomUUID();
    await admin.from('homework_assignments').insert({
      id, school_id: schoolAId, class_id: classAId, subject_id: subjectAId, teacher_id: teacherACreatorRowId,
      title: `Linking test homework ${id}`, due_date: '2026-01-01', max_score: maxScore, updated_at: new Date().toISOString(),
    });
    homeworkIds.push(id);
    return id;
  }

  // Seeds a completion as already-graded, bypassing the grading endpoint —
  // simulates pre-existing history from before the homework was linked.
  async function seedGradedCompletion(homeworkId: string, studentId: string, score: number) {
    const id = randomUUID();
    await admin.from('homework_completions').insert({
      id, school_id: schoolAId, homework_id: homeworkId, student_id: studentId,
      completed_at: new Date().toISOString(), score, graded_at: new Date().toISOString(),
    });
    return id;
  }

  async function seedUngradedCompletion(homeworkId: string, studentId: string) {
    const id = randomUUID();
    await admin.from('homework_completions').insert({
      id, school_id: schoolAId, homework_id: homeworkId, student_id: studentId, completed_at: new Date().toISOString(),
    });
    return id;
  }

  async function createQuiz() {
    const id = randomUUID();
    await admin.from('quizzes').insert({
      id, school_id: schoolAId, class_id: classAId, subject_id: subjectAId, created_by_id: teacherACreatorUserId,
      title: `Linking test quiz ${id}`, is_published: true,
    });
    quizIds.push(id);
    return id;
  }

  async function seedQuizAttempt(quizId: string, studentId: string, score: number, maxScore: number, submitted: boolean) {
    const id = randomUUID();
    await admin.from('quiz_attempts').insert({
      id, school_id: schoolAId, quiz_id: quizId, student_id: studentId,
      submitted_at: submitted ? new Date().toISOString() : null, score, max_score: maxScore, answers: {},
    });
    return id;
  }

  function linkBody(overrides: Partial<{ name: string; subjectId: string; classId: string; termId: string; maxMarks: number; confirmed: boolean }> = {}) {
    return {
      name: `Linked assessment ${randomUUID()}`,
      subjectId: subjectAId,
      classId: classAId,
      termId: termAId,
      maxMarks: 20,
      ...overrides,
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
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
    });

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    await admin.from('schools').insert([
      { id: schoolAId, name: `GB Link Test School A ${suffix}`, slug: `gblink-test-a-${suffix}`, updated_at: now },
      { id: schoolBId, name: `GB Link Test School B ${suffix}`, slug: `gblink-test-b-${suffix}`, updated_at: now },
    ]);

    classAId = randomUUID();
    await admin.from('classes').insert({ id: classAId, school_id: schoolAId, name: 'GB Link Class', grade_level: 1, updated_at: now });
    subjectAId = randomUUID();
    await admin.from('subjects').insert({ id: subjectAId, school_id: schoolAId, name: `GB Link Subject ${suffix}`, code: 'GBL', updated_at: now });
    termAId = randomUUID();
    await admin.from('terms').insert({ id: termAId, school_id: schoolAId, name: `GB Link Term ${suffix}`, start_date: today, end_date: today, is_current: true });

    const teacherCreator = await seedUser(schoolAId, 'TEACHER', 'gblink-teacher-creator');
    teacherACreatorToken = teacherCreator.token;
    teacherACreatorUserId = teacherCreator.userId;
    teacherACreatorRowId = randomUUID();
    await admin.from('teachers').insert({ id: teacherACreatorRowId, school_id: schoolAId, user_id: teacherCreator.userId, staff_no: `GBLC-${suffix}`, updated_at: now });
    // AssessmentsService.create() requires the creating teacher to be assigned to the class/subject.
    await admin.from('subject_assignments').insert({ id: randomUUID(), class_id: classAId, subject_id: subjectAId, teacher_id: teacherACreatorRowId });

    const studentA1 = await seedUser(schoolAId, 'STUDENT', 'gblink-student-a1');
    studentA1Id = randomUUID();
    await admin.from('students').insert({ id: studentA1Id, school_id: schoolAId, user_id: studentA1.userId, current_class_id: classAId, admission_no: `GBL1-${suffix}`, updated_at: now });

    const studentA2 = await seedUser(schoolAId, 'STUDENT', 'gblink-student-a2');
    studentA2Id = randomUUID();
    await admin.from('students').insert({ id: studentA2Id, school_id: schoolAId, user_id: studentA2.userId, current_class_id: classAId, admission_no: `GBL2-${suffix}`, updated_at: now });

    const studentA3 = await seedUser(schoolAId, 'STUDENT', 'gblink-student-a3');
    studentA3Id = randomUUID();
    await admin.from('students').insert({ id: studentA3Id, school_id: schoolAId, user_id: studentA3.userId, current_class_id: classAId, admission_no: `GBL3-${suffix}`, updated_at: now });

    // School B — minimal, cross-tenant checks only.
    const classBId = randomUUID();
    await admin.from('classes').insert({ id: classBId, school_id: schoolBId, name: 'GB Link Class B', grade_level: 1, updated_at: now });
    const teacherB = await seedUser(schoolBId, 'TEACHER', 'gblink-teacher-b');
    teacherBToken = teacherB.token;
    const teacherBRowId = randomUUID();
    await admin.from('teachers').insert({ id: teacherBRowId, school_id: schoolBId, user_id: teacherB.userId, staff_no: `GBLB-${suffix}`, updated_at: now });
  });

  afterAll(async () => {
    await admin.from('grades').delete().in('assessment_id', assessmentIds.length ? assessmentIds : ['00000000-0000-0000-0000-000000000000']);
    await admin.from('assessments').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('homework_completions').delete().in('homework_id', homeworkIds.length ? homeworkIds : ['00000000-0000-0000-0000-000000000000']);
    await admin.from('homework_assignments').delete().eq('school_id', schoolAId);
    await admin.from('quiz_attempts').delete().eq('school_id', schoolAId);
    await admin.from('quizzes').delete().eq('school_id', schoolAId);
    await admin.from('subject_assignments').delete().eq('teacher_id', teacherACreatorRowId);
    await admin.from('students').delete().in('id', [studentA1Id, studentA2Id, studentA3Id]);
    await admin.from('teachers').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('terms').delete().eq('school_id', schoolAId);
    await admin.from('subjects').delete().eq('school_id', schoolAId);
    await admin.from('classes').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('users').delete().in('auth_id', authUserIds);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    if (app) await app.close();
  });

  describe('Homework linking', () => {
    it('previews a retroactive rollup with real graded/ungraded counts, then on confirm creates the assessment and cascades only the graded students', async () => {
      const homeworkId = await createHomework(10);
      await seedGradedCompletion(homeworkId, studentA1Id, 8);
      await seedGradedCompletion(homeworkId, studentA2Id, 6);
      await seedUngradedCompletion(homeworkId, studentA3Id);

      const preview = await request(app.getHttpServer())
        .post(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 20 }))
        .expect(201); // no @HttpCode override — POST defaults to 201 even for a preview body
      expect(preview.body).toMatchObject({ preview: true, kind: 'retroactive_rollup', gradedCount: 2, ungradedCount: 1 });
      const sample1 = preview.body.sampleGrades.find((s: { studentName: string }) => s.studentName === 'Test gblink-student-a1');
      const sample2 = preview.body.sampleGrades.find((s: { studentName: string }) => s.studentName === 'Test gblink-student-a2');
      expect(sample1.normalizedScore).toBe(16); // (8/10)*20
      expect(sample2.normalizedScore).toBe(12); // (6/10)*20

      // Nothing written yet.
      const { data: beforeConfirm } = await admin.from('assessments').select('id').eq('source_type', 'HOMEWORK').eq('source_id', homeworkId);
      expect(beforeConfirm).toHaveLength(0);

      const confirmed = await request(app.getHttpServer())
        .post(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 20, confirmed: true }))
        .expect(201);
      expect(confirmed.body).toMatchObject({ max_marks: 20, source_type: 'HOMEWORK', source_id: homeworkId });
      const assessmentId = confirmed.body.id as string;
      assessmentIds.push(assessmentId);

      const { data: grades } = await admin.from('grades').select('student_id, score').eq('assessment_id', assessmentId);
      expect(grades).toHaveLength(2); // the ungraded student gets no row
      expect(grades!.find((g) => g.student_id === studentA1Id)?.score).toBe(16);
      expect(grades!.find((g) => g.student_id === studentA2Id)?.score).toBe(12);
      expect(grades!.find((g) => g.student_id === studentA3Id)).toBeUndefined();
    });

    it('links immediately when there is no prior graded work, cascades a subsequent grade automatically, then unlinking preserves grades but stops future cascades', async () => {
      const homeworkId = await createHomework(10);

      const linked = await request(app.getHttpServer())
        .post(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 20 })) // no confirmed flag needed — gradedCount is 0
        .expect(201);
      expect(linked.body).toMatchObject({ source_type: 'HOMEWORK', source_id: homeworkId });
      const assessmentId = linked.body.id as string;
      assessmentIds.push(assessmentId);

      const submissionId = await seedUngradedCompletion(homeworkId, studentA1Id);
      await request(app.getHttpServer())
        .patch(`/homework/${homeworkId}/submissions/${submissionId}/grade`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send({ score: 8 })
        .expect(200);

      const { data: afterGrade } = await admin.from('grades').select('score').eq('assessment_id', assessmentId).eq('student_id', studentA1Id).maybeSingle();
      expect(afterGrade?.score).toBe(16); // (8/10)*20

      await request(app.getHttpServer())
        .delete(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .expect(200);

      const { data: unlinkedAssessment } = await admin.from('assessments').select('source_type, source_id').eq('id', assessmentId).single();
      expect(unlinkedAssessment).toEqual({ source_type: 'DIRECT', source_id: null });

      // The existing grade row survives the unlink.
      const { data: preserved } = await admin.from('grades').select('score').eq('assessment_id', assessmentId).eq('student_id', studentA1Id).single();
      expect(preserved!.score).toBe(16);

      // Re-grading after unlink no longer cascades (the assessment is DIRECT now).
      await request(app.getHttpServer())
        .patch(`/homework/${homeworkId}/submissions/${submissionId}/grade`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send({ score: 9 })
        .expect(200);
      const { data: stillPreserved } = await admin.from('grades').select('score').eq('assessment_id', assessmentId).eq('student_id', studentA1Id).single();
      expect(stillPreserved!.score).toBe(16); // unchanged — no cascade fired
    });

    it('changing max_marks on an already-linked homework previews a recompute, then applies it on confirm', async () => {
      const homeworkId = await createHomework(10);
      await seedGradedCompletion(homeworkId, studentA1Id, 8);

      const created = await request(app.getHttpServer())
        .post(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 20, confirmed: true }))
        .expect(201);
      const assessmentId = created.body.id as string;
      assessmentIds.push(assessmentId);
      const { data: firstGrade } = await admin.from('grades').select('score').eq('assessment_id', assessmentId).eq('student_id', studentA1Id).single();
      expect(firstGrade!.score).toBe(16); // (8/10)*20

      const recomputePreview = await request(app.getHttpServer())
        .post(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 30 })) // different from the existing 20, unconfirmed
        .expect(201); // no @HttpCode override — POST defaults to 201 even for a preview body
      expect(recomputePreview.body).toMatchObject({ preview: true, kind: 'recompute', gradedCount: 1 });

      // Still the old value — recompute preview writes nothing.
      const { data: beforeApply } = await admin.from('grades').select('score').eq('assessment_id', assessmentId).eq('student_id', studentA1Id).single();
      expect(beforeApply!.score).toBe(16);

      await request(app.getHttpServer())
        .post(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 30, confirmed: true }))
        .expect(201);

      const { data: assessmentAfter } = await admin.from('assessments').select('max_marks').eq('id', assessmentId).single();
      expect(assessmentAfter!.max_marks).toBe(30);
      const { data: afterApply } = await admin.from('grades').select('score').eq('assessment_id', assessmentId).eq('student_id', studentA1Id).single();
      expect(afterApply!.score).toBe(24); // (8/10)*30
    });
  });

  describe('Quiz linking', () => {
    it('a submitted attempt on a linked quiz cascades via record_quiz_grade(), and an unlinked quiz is a no-op', async () => {
      const quizId = await createQuiz();

      const linked = await request(app.getHttpServer())
        .post(`/quizzes/${quizId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 10 }))
        .expect(201);
      const assessmentId = linked.body.id as string;
      assessmentIds.push(assessmentId);

      const studentA1 = await seedUser(schoolAId, 'STUDENT', `gblink-quiz-student-${randomUUID()}`);
      const studentA1RowId = randomUUID();
      await admin.from('students').insert({ id: studentA1RowId, school_id: schoolAId, user_id: studentA1.userId, current_class_id: classAId, admission_no: `GBLQ1-${suffix}-${Date.now()}`, updated_at: new Date().toISOString() });

      const attemptId = await seedQuizAttempt(quizId, studentA1RowId, 8, 10, true);
      const { data: gradeId, error } = await clientAs(studentA1.token).rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
      expect(error).toBeNull();
      expect(gradeId).toBeTruthy();

      const { data: grade } = await admin.from('grades').select('score').eq('id', gradeId).single();
      expect(grade!.score).toBe(8); // (8/10)*10

      // Unlink, then re-invoking record_quiz_grade on the same attempt (e.g.
      // a short-answer regrade re-firing the cascade) is a documented no-op —
      // quiz_attempts has UNIQUE(quiz_id, student_id), so a second attempt
      // row for the same pair isn't a real scenario this schema allows.
      await request(app.getHttpServer())
        .delete(`/quizzes/${quizId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .expect(200);

      const noop = await clientAs(studentA1.token).rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
      expect(noop.error).toBeNull();
      expect(noop.data).toBeNull();

      // The original cascaded grade is untouched.
      const { data: stillThere } = await admin.from('grades').select('score').eq('id', gradeId).single();
      expect(stillThere!.score).toBe(8);

      await admin.from('students').delete().eq('id', studentA1RowId);
    });

    it('linking a quiz with existing submitted attempts previews then confirms a retroactive rollup, skipping an unsubmitted attempt', async () => {
      const quizId = await createQuiz();
      await seedQuizAttempt(quizId, studentA1Id, 9, 10, true);
      await seedQuizAttempt(quizId, studentA2Id, 5, 10, true);
      await seedQuizAttempt(quizId, studentA3Id, 0, 10, false); // in progress, not submitted

      const preview = await request(app.getHttpServer())
        .post(`/quizzes/${quizId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 20 }))
        .expect(201); // no @HttpCode override — POST defaults to 201 even for a preview body
      expect(preview.body).toMatchObject({ preview: true, kind: 'retroactive_rollup', gradedCount: 2, ungradedCount: 1 });

      const confirmed = await request(app.getHttpServer())
        .post(`/quizzes/${quizId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 20, confirmed: true }))
        .expect(201);
      const assessmentId = confirmed.body.id as string;
      assessmentIds.push(assessmentId);

      const { data: grades } = await admin.from('grades').select('student_id, score').eq('assessment_id', assessmentId);
      expect(grades).toHaveLength(2);
      expect(grades!.find((g) => g.student_id === studentA1Id)?.score).toBe(18); // (9/10)*20
      expect(grades!.find((g) => g.student_id === studentA2Id)?.score).toBe(10); // (5/10)*20
      expect(grades!.find((g) => g.student_id === studentA3Id)).toBeUndefined();
    });
  });

  describe('Read-only enforcement on linked assessments', () => {
    it('rejects a direct upsertScores() edit via the API (403), and a raw service-role write is rejected by the DB trigger', async () => {
      const homeworkId = await createHomework(10);
      await seedGradedCompletion(homeworkId, studentA1Id, 8);

      const created = await request(app.getHttpServer())
        .post(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 20, confirmed: true }))
        .expect(201);
      const assessmentId = created.body.id as string;
      assessmentIds.push(assessmentId);

      // API layer.
      await request(app.getHttpServer())
        .post(`/assessments/${assessmentId}/scores`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send({ scores: [{ studentId: studentA1Id, marksObtained: 99 }] })
        .expect(403);

      // DB layer — bypasses the API entirely using the service-role client,
      // which also bypasses RLS, proving the trigger (not RLS) is the backstop.
      const { error } = await admin.from('grades').update({ score: 99 }).eq('assessment_id', assessmentId).eq('student_id', studentA1Id);
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/derived from HOMEWORK/);

      // Unchanged by either attempt.
      const { data: finalGrade } = await admin.from('grades').select('score').eq('assessment_id', assessmentId).eq('student_id', studentA1Id).single();
      expect(finalGrade!.score).toBe(16);
    });

    it('control: a raw write to a DIRECT (non-linked) assessment is unaffected by the trigger', async () => {
      const res = await request(app.getHttpServer())
        .post('/assessments')
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send({ name: 'Direct control assessment', subjectId: subjectAId, classId: classAId, termId: termAId, maxMarks: 100 })
        .expect(201);
      const assessmentId = res.body.id as string;
      assessmentIds.push(assessmentId);

      const { error } = await admin.from('grades').insert({
        id: randomUUID(), school_id: schoolAId, assessment_id: assessmentId, student_id: studentA1Id, score: 77,
      });
      expect(error).toBeNull();
    });
  });

  describe('Cross-tenant isolation', () => {
    it('a School B teacher cannot link or unlink a School A homework (404 — RLS hides the row)', async () => {
      const homeworkId = await createHomework(10);

      await request(app.getHttpServer())
        .post(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherBToken}`)
        .send(linkBody())
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherBToken}`)
        .expect(404);
    });

    it("a School B client cannot see a School A linked assessment or its cascaded grades", async () => {
      const homeworkId = await createHomework(10);
      await seedGradedCompletion(homeworkId, studentA1Id, 8);
      const created = await request(app.getHttpServer())
        .post(`/homework/${homeworkId}/link-to-gradebook`)
        .set('Authorization', `Bearer ${teacherACreatorToken}`)
        .send(linkBody({ maxMarks: 20, confirmed: true }))
        .expect(201);
      const assessmentId = created.body.id as string;
      assessmentIds.push(assessmentId);

      const { data: assessmentAsB } = await clientAs(teacherBToken).from('assessments').select('id').eq('id', assessmentId);
      expect(assessmentAsB).toEqual([]);

      const { data: gradesAsB } = await clientAs(teacherBToken).from('grades').select('id').eq('assessment_id', assessmentId);
      expect(gradesAsB).toEqual([]);
    });
  });
});
