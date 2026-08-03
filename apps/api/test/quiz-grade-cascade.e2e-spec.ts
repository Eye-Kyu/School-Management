// =============================================================================
// record_quiz_grade() SECURITY DEFINER function — Bucket 1, PR 2a
// =============================================================================
// Infrastructure only (see docs/audits/homework-quiz-gradebook-relationship.md
// and the migration's own header comment for why this is a DB function rather
// than a NestJS endpoint or a widened RLS policy). Not invoked from any real
// quiz submission flow yet — B1-2b owns that wiring plus the score
// normalization formula. These are live/integration tests, not mocked unit
// tests — a plpgsql function has no meaningful mock surface, matching how
// class_average_scores() (the only other student-callable RPC in this
// codebase) is itself only ever tested live.
// =============================================================================

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import ws from 'ws';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALTIME_OPTIONS = { transport: ws } as any;

describe('record_quiz_grade() (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;

  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const authUserIds: string[] = [];

  let classAId: string;
  let subjectAId: string;
  let termAId: string;
  let teacherAUserId: string;
  let studentAId: string;
  let studentAToken: string;

  let assessmentAId: string; // the "linked" target in school A
  let assessmentBId: string; // a different school's assessment, for cross-tenant

  async function seedUser(schoolId: string, role: 'TEACHER' | 'STUDENT', label: string) {
    const email = `${label}-${suffix}@test-quizcascade.internal`;
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

  // Every test gets its own quiz + submitted attempt — record_quiz_grade
  // upserts into grades keyed on (assessment_id, student_id), so reusing one
  // attempt across tests wouldn't cleanly exercise "does it create the row"
  // vs "does it update it" independently.
  async function createSubmittedAttempt(score: number, maxScore: number) {
    const quizId = randomUUID();
    await admin.from('quizzes').insert({
      id: quizId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Cascade test quiz', is_published: true,
    });
    const attemptId = randomUUID();
    await admin.from('quiz_attempts').insert({
      id: attemptId, school_id: schoolAId, quiz_id: quizId, student_id: studentAId,
      submitted_at: new Date().toISOString(), score, max_score: maxScore, answers: {},
    });
    return attemptId;
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
      { id: schoolAId, name: `Quiz Cascade Test School A ${suffix}`, slug: `quizcascade-test-a-${suffix}`, updated_at: now },
      { id: schoolBId, name: `Quiz Cascade Test School B ${suffix}`, slug: `quizcascade-test-b-${suffix}`, updated_at: now },
    ]);

    classAId = randomUUID();
    await admin.from('classes').insert({ id: classAId, school_id: schoolAId, name: 'Quiz Cascade Class', grade_level: 1, updated_at: now });

    subjectAId = randomUUID();
    await admin.from('subjects').insert({ id: subjectAId, school_id: schoolAId, name: `Quiz Cascade Subject ${suffix}`, code: 'QCS', updated_at: now });

    termAId = randomUUID();
    await admin.from('terms').insert({ id: termAId, school_id: schoolAId, name: `Quiz Cascade Term ${suffix}`, start_date: today, end_date: today, is_current: true });

    const teacherA = await seedUser(schoolAId, 'TEACHER', 'quizcascade-teacher-a');
    teacherAUserId = teacherA.userId;
    const teacherARowId = randomUUID();
    await admin.from('teachers').insert({ id: teacherARowId, school_id: schoolAId, user_id: teacherAUserId, staff_no: `QCT-${suffix}`, updated_at: now });

    const studentA = await seedUser(schoolAId, 'STUDENT', 'quizcascade-student-a');
    studentAToken = studentA.token;
    studentAId = randomUUID();
    await admin.from('students').insert({
      id: studentAId, school_id: schoolAId, user_id: studentA.userId, current_class_id: classAId,
      admission_no: `QUIZCASCADE-${suffix}`, updated_at: now,
    });

    assessmentAId = randomUUID();
    await admin.from('assessments').insert({
      id: assessmentAId, school_id: schoolAId, class_id: classAId, subject_id: subjectAId, term_id: termAId,
      teacher_id: teacherARowId, name: 'Quiz Cascade Target Assessment', max_marks: 10,
    });

    // A second school's assessment, purely for the cross-tenant test.
    const classBId = randomUUID();
    await admin.from('classes').insert({ id: classBId, school_id: schoolBId, name: 'Quiz Cascade Class B', grade_level: 1, updated_at: now });
    const subjectBId = randomUUID();
    await admin.from('subjects').insert({ id: subjectBId, school_id: schoolBId, name: `Quiz Cascade Subject B ${suffix}`, code: 'QCB', updated_at: now });
    const termBId = randomUUID();
    await admin.from('terms').insert({ id: termBId, school_id: schoolBId, name: `Quiz Cascade Term B ${suffix}`, start_date: today, end_date: today, is_current: true });
    const teacherB = await seedUser(schoolBId, 'TEACHER', 'quizcascade-teacher-b');
    const teacherBRowId = randomUUID();
    await admin.from('teachers').insert({ id: teacherBRowId, school_id: schoolBId, user_id: teacherB.userId, staff_no: `QCTB-${suffix}`, updated_at: now });
    assessmentBId = randomUUID();
    await admin.from('assessments').insert({
      id: assessmentBId, school_id: schoolBId, class_id: classBId, subject_id: subjectBId, term_id: termBId,
      teacher_id: teacherBRowId, name: 'Quiz Cascade Target Assessment B', max_marks: 10,
    });
  });

  afterAll(async () => {
    await admin.from('grades').delete().in('assessment_id', [assessmentAId, assessmentBId]);
    await admin.from('quiz_attempts').delete().eq('school_id', schoolAId);
    await admin.from('quizzes').delete().eq('school_id', schoolAId);
    await admin.from('assessments').delete().in('id', [assessmentAId, assessmentBId]);
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('students').delete().eq('id', studentAId);
    await admin.from('teachers').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('terms').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('subjects').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('classes').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('users').delete().in('auth_id', authUserIds);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    if (app) await app.close();
  });

  function clientAs(token: string) {
    return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }

  it('creates a grades row for a real submitted attempt, callable by the student themselves', async () => {
    const attemptId = await createSubmittedAttempt(8, 10);
    const { data: gradeId, error } = await clientAs(studentAToken)
      .rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId, p_assessment_id: assessmentAId });
    expect(error).toBeNull();
    expect(gradeId).toBeTruthy();

    const { data: grade } = await admin.from('grades').select('score, student_id').eq('id', gradeId).single();
    expect(grade!.student_id).toBe(studentAId);
    expect(grade!.score).toBe(8);
  });

  it('calling it twice for the same attempt does not duplicate the grade row', async () => {
    const attemptId = await createSubmittedAttempt(6, 10);
    const client = clientAs(studentAToken);

    const first = await client.rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId, p_assessment_id: assessmentAId });
    expect(first.error).toBeNull();

    const second = await client.rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId, p_assessment_id: assessmentAId });
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data); // same grades.id both times

    const { data: rows } = await admin.from('grades').select('id').eq('assessment_id', assessmentAId).eq('student_id', studentAId);
    expect(rows).toHaveLength(1);
  });

  it('rejects a crafted assessment id from another school', async () => {
    const attemptId = await createSubmittedAttempt(5, 10);
    const { data, error } = await clientAs(studentAToken)
      .rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId, p_assessment_id: assessmentBId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/different schools/);
    expect(data).toBeNull();

    const { data: rows } = await admin.from('grades').select('id').eq('assessment_id', assessmentBId);
    expect(rows).toHaveLength(0);
  });

  it('full scenario: quiz + submitted attempt + explicit rpc() call produces the expected grades row', async () => {
    const attemptId = await createSubmittedAttempt(9, 10);
    const { data: gradeId, error } = await clientAs(studentAToken)
      .rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId, p_assessment_id: assessmentAId });
    expect(error).toBeNull();

    const { data: grade } = await admin.from('grades').select('student_id, score, assessment_id').eq('id', gradeId).single();
    expect(grade).toMatchObject({ student_id: studentAId, score: 9, assessment_id: assessmentAId });

    // grades is upserted on (assessment_id, student_id) — every test in this
    // file that targets assessmentAId shares the same underlying grade row,
    // so audit_logs for that entity_id accumulates across tests (correctly —
    // each call is a real, distinct recording event worth auditing). Scope
    // to this test's own attemptId (unique per test) to isolate its own entry.
    const { data: auditRows } = await admin.from('audit_logs')
      .select('action, entity_id, metadata').eq('action', 'quiz.record_grade').eq('entity_id', gradeId);
    const ownEntry = (auditRows ?? []).filter((r) => (r.metadata as { quizAttemptId?: string })?.quizAttemptId === attemptId);
    expect(ownEntry).toHaveLength(1);
  });

  it('rejects an attempt that has not been submitted yet', async () => {
    const quizId = randomUUID();
    await admin.from('quizzes').insert({ id: quizId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Unsubmitted cascade quiz', is_published: true });
    const attemptId = randomUUID();
    await admin.from('quiz_attempts').insert({ id: attemptId, school_id: schoolAId, quiz_id: quizId, student_id: studentAId, answers: {} });

    const { error } = await clientAs(studentAToken)
      .rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId, p_assessment_id: assessmentAId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not yet submitted/);
  });
});
