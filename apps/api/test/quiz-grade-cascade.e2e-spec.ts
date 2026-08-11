// =============================================================================
// record_quiz_grade() SECURITY DEFINER function — Bucket 1, PR 2a / 2b
// =============================================================================
// Infrastructure only in B1-2a (see
// docs/audits/homework-quiz-gradebook-relationship.md and the migration's own
// header comment for why this is a DB function rather than a NestJS endpoint
// or a widened RLS policy). B1-2b (20260728000083) wires it to real quiz
// submissions and changes its signature: it no longer takes an explicit
// p_assessment_id — B1-2a's version was scaffolding for a caller that didn't
// yet know how to resolve the real link, but nothing existed to call it with
// a real assessment id back then. Now the function resolves the link itself
// (assessments WHERE source_type='QUIZ' AND source_id = the attempt's
// quiz_id) and writes through the shared write_linked_grade() gateway
// (20260728000082) instead of its own raw INSERT — an unlinked quiz is a
// documented no-op (returns NULL), not an error. These are live/integration
// tests, not mocked unit tests — a plpgsql function has no meaningful mock
// surface, matching how class_average_scores() (the only other
// student-callable RPC in this codebase) is itself only ever tested live.
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
  // vs "does it update it" independently. Since B1-2b's record_quiz_grade
  // resolves its target by looking up assessments WHERE source_type='QUIZ'
  // AND source_id = quiz_id (it no longer takes an explicit assessment id),
  // linking is relinked to point at each new quiz in turn — assessmentAId
  // itself is still the one shared grades-upsert target across tests.
  async function createSubmittedAttempt(score: number, maxScore: number) {
    const quizId = randomUUID();
    await admin.from('quizzes').insert({
      id: quizId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Cascade test quiz', is_published: true,
    });
    await admin.from('assessments').update({ source_type: 'QUIZ', source_id: quizId }).eq('id', assessmentAId);
    const attemptId = randomUUID();
    await admin.from('quiz_attempts').insert({
      id: attemptId, school_id: schoolAId, quiz_id: quizId, student_id: studentAId,
      submitted_at: new Date().toISOString(), score, max_score: maxScore, answers: {},
    });
    return { attemptId, quizId };
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
    const { attemptId } = await createSubmittedAttempt(8, 10);
    const { data: gradeId, error } = await clientAs(studentAToken)
      .rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
    expect(error).toBeNull();
    expect(gradeId).toBeTruthy();

    const { data: grade } = await admin.from('grades').select('score, student_id').eq('id', gradeId).single();
    expect(grade!.student_id).toBe(studentAId);
    expect(grade!.score).toBe(8);
  });

  it('calling it twice for the same attempt does not duplicate the grade row', async () => {
    const { attemptId } = await createSubmittedAttempt(6, 10);
    const client = clientAs(studentAToken);

    const first = await client.rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
    expect(first.error).toBeNull();

    const second = await client.rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data); // same grades.id both times

    const { data: rows } = await admin.from('grades').select('id').eq('assessment_id', assessmentAId).eq('student_id', studentAId);
    expect(rows).toHaveLength(1);
  });

  it('is a documented no-op — returns NULL and writes nothing — when the quiz has no linked assessment', async () => {
    // A fresh quiz, deliberately never linked (assessmentAId is left pointed
    // at whatever the previous test linked it to, not this one).
    const quizId = randomUUID();
    await admin.from('quizzes').insert({ id: quizId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Unlinked cascade quiz', is_published: true });
    const attemptId = randomUUID();
    await admin.from('quiz_attempts').insert({
      id: attemptId, school_id: schoolAId, quiz_id: quizId, student_id: studentAId,
      submitted_at: new Date().toISOString(), score: 7, max_score: 10, answers: {},
    });

    const { count: countBefore } = await admin.from('grades').select('id', { count: 'exact', head: true }).eq('school_id', schoolAId);

    const { data, error } = await clientAs(studentAToken).rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
    expect(error).toBeNull();
    expect(data).toBeNull();

    const { count: countAfter } = await admin.from('grades').select('id', { count: 'exact', head: true }).eq('school_id', schoolAId);
    expect(countAfter).toBe(countBefore); // no new or updated row from this call
  });

  it('defense in depth: raises if a linked assessment belongs to a different school than the attempting student', async () => {
    // The mismatch record_quiz_grade actually guards against is assessment
    // school vs. the *attempting student's* school (joined from quiz_attempts
    // → students), not the quiz's own school_id — the function never reads
    // the quiz row's school at all. Linked directly to a fresh quiz here
    // (not via createSubmittedAttempt, which always links assessmentAId) —
    // the partial unique index on (source_type, source_id) means only one
    // assessment can ever be linked to a given quiz_id, so this couldn't be
    // constructed by instead trying to double-link assessmentAId/assessmentBId
    // to the same quiz. This exact combination (assessmentB, School A
    // student) can never arise through the real submission flow — RLS scopes
    // a student's own attempt insert to their own school — but the
    // function's own cross-school check is a real backstop worth proving.
    const quizId = randomUUID();
    await admin.from('quizzes').insert({ id: quizId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Defense-in-depth quiz', is_published: true });
    await admin.from('assessments').update({ source_type: 'QUIZ', source_id: quizId }).eq('id', assessmentBId);

    const attemptId = randomUUID();
    await admin.from('quiz_attempts').insert({
      id: attemptId, school_id: schoolAId, quiz_id: quizId, student_id: studentAId,
      submitted_at: new Date().toISOString(), score: 5, max_score: 10, answers: {},
    });

    const { data, error } = await clientAs(studentAToken).rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/different schools/);
    expect(data).toBeNull();

    const { data: rows } = await admin.from('grades').select('id').eq('assessment_id', assessmentBId);
    expect(rows).toHaveLength(0);

    // Cleanup — don't leak this crafted state into any later test in the file.
    await admin.from('quiz_attempts').delete().eq('id', attemptId);
    await admin.from('quizzes').delete().eq('id', quizId);
    await admin.from('assessments').update({ source_type: 'DIRECT', source_id: null }).eq('id', assessmentBId);
  });

  it('full scenario: quiz + submitted attempt + explicit rpc() call produces the expected grades row', async () => {
    const { attemptId } = await createSubmittedAttempt(9, 10);
    const { data: gradeId, error } = await clientAs(studentAToken)
      .rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
    expect(error).toBeNull();

    const { data: grade } = await admin.from('grades').select('student_id, score, assessment_id').eq('id', gradeId).single();
    expect(grade).toMatchObject({ student_id: studentAId, score: 9, assessment_id: assessmentAId });
  });

  it('rejects an attempt that has not been submitted yet', async () => {
    const quizId = randomUUID();
    await admin.from('quizzes').insert({ id: quizId, school_id: schoolAId, class_id: classAId, created_by_id: teacherAUserId, title: 'Unsubmitted cascade quiz', is_published: true });
    const attemptId = randomUUID();
    await admin.from('quiz_attempts').insert({ id: attemptId, school_id: schoolAId, quiz_id: quizId, student_id: studentAId, answers: {} });

    const { error } = await clientAs(studentAToken)
      .rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not yet submitted/);
  });
});
