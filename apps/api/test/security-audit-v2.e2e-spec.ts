// =============================================================================
// Security audit 2026-11: live verification of the V2 database fixes
// =============================================================================
// Exercises migrations 20261112000097..100 against the real Supabase project
// through direct PostgREST/RPC, the same paths an attacker with their own JWT
// would use. Isolated dummy schools/users are created in beforeAll and deleted
// in afterAll (cross-tenant.e2e-spec.ts pattern).
// =============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import ws from 'ws';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALTIME_OPTIONS = { transport: ws } as any;
jest.setTimeout(60_000);

type Seeded = { authId: string; userId: string; token: string };

describe('Security audit V2 fixes (e2e)', () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const schoolA = randomUUID();
  const schoolB = randomUUID();
  const authUserIds: string[] = [];
  const u: Record<string, Seeded> = {};
  const id: Record<string, string> = {};

  function clientAs(token?: string): SupabaseClient {
    return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
      ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
    });
  }
  const as = (label: string) => clientAs(u[label]!.token);

  async function seedUser(label: string, role: string, schoolId: string) {
    const email = `${label}-${suffix}@test-secaudit2.internal`;
    const password = `TestPass${suffix}!`;
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { role, school_id: schoolId },
    });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    authUserIds.push(data.user.id);
    await admin.from('users').upsert({
      id: randomUUID(), school_id: schoolId, auth_id: data.user.id, email, full_name: `Test ${label}`, role, updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_id', ignoreDuplicates: true });
    const { data: row } = await admin.from('users').select('id').eq('auth_id', data.user.id).single();
    const { data: s, error: e } = await clientAs().auth.signInWithPassword({ email, password });
    if (e) throw new Error(`signIn ${label}: ${e.message}`);
    u[label] = { authId: data.user.id, userId: row!.id, token: s.session!.access_token };
  }

  async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
    const { data, error } = await p;
    if (error) throw new Error(`${what}: ${error.message}`);
    return data;
  }

  beforeAll(async () => {
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
    });
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    await must(admin.from('schools').insert([
      { id: schoolA, name: `SecAudit2 A ${suffix}`, slug: `secaudit2-a-${suffix}`, updated_at: now },
      { id: schoolB, name: `SecAudit2 B ${suffix}`, slug: `secaudit2-b-${suffix}`, updated_at: now },
    ]), 'schools');

    id.classA1 = randomUUID(); id.classA2 = randomUUID(); id.subj1 = randomUUID(); id.subj2 = randomUUID(); id.term = randomUUID();
    await must(admin.from('classes').insert([
      { id: id.classA1, school_id: schoolA, name: 'SA2 Class 1', grade_level: 1, updated_at: now },
      { id: id.classA2, school_id: schoolA, name: 'SA2 Class 2', grade_level: 1, updated_at: now },
    ]), 'classes');
    await must(admin.from('subjects').insert([
      { id: id.subj1, school_id: schoolA, name: `SA2 Subj1 ${suffix}`, code: 'S1', updated_at: now },
      { id: id.subj2, school_id: schoolA, name: `SA2 Subj2 ${suffix}`, code: 'S2', updated_at: now },
    ]), 'subjects');
    await must(admin.from('terms').insert({ id: id.term, school_id: schoolA, name: `SA2 Term ${suffix}`, start_date: today, end_date: today, is_current: true }), 'terms');

    await seedUser('admin-a', 'ADMIN', schoolA);
    await seedUser('teacher-a', 'TEACHER', schoolA);   // class teacher of A1, teaches Subj1 in A1
    await seedUser('teacher-a2', 'TEACHER', schoolA);  // teaches Subj2 in A1 only
    await seedUser('student-a', 'STUDENT', schoolA);
    await seedUser('student-a2', 'STUDENT', schoolA);
    await seedUser('parent-a', 'PARENT', schoolA);     // guardian of student-a only
    await seedUser('teacher-b', 'TEACHER', schoolB);

    id.tA = randomUUID(); id.tA2 = randomUUID();
    await must(admin.from('teachers').insert([
      { id: id.tA, school_id: schoolA, user_id: u['teacher-a']!.userId, staff_no: `SA2T-${suffix}`, is_class_teacher_of: id.classA1, updated_at: now },
      { id: id.tA2, school_id: schoolA, user_id: u['teacher-a2']!.userId, staff_no: `SA2T2-${suffix}`, updated_at: now },
      { id: randomUUID(), school_id: schoolB, user_id: u['teacher-b']!.userId, staff_no: `SA2TB-${suffix}`, updated_at: now },
    ]), 'teachers');
    await must(admin.from('subject_assignments').insert([
      { id: randomUUID(), class_id: id.classA1, subject_id: id.subj1, teacher_id: id.tA },
      { id: randomUUID(), class_id: id.classA1, subject_id: id.subj2, teacher_id: id.tA2 },
    ]), 'subject_assignments');
    id.sA = randomUUID(); id.sA2 = randomUUID();
    await must(admin.from('students').insert([
      { id: id.sA, school_id: schoolA, user_id: u['student-a']!.userId, current_class_id: id.classA1, admission_no: `SA2-1-${suffix}`, updated_at: now },
      { id: id.sA2, school_id: schoolA, user_id: u['student-a2']!.userId, current_class_id: id.classA1, admission_no: `SA2-2-${suffix}`, updated_at: now },
    ]), 'students');
    await must(admin.from('guardians').insert({ id: randomUUID(), user_id: u['parent-a']!.userId, student_id: id.sA, relationship: 'Mother' }), 'guardians');
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('schools').delete().in('id', [schoolA, schoolB]);
    await admin.from('users').delete().in('auth_id', authUserIds);
    for (const a of authUserIds) await admin.auth.admin.deleteUser(a).catch(() => undefined);
  }, 300_000);

  // ── SA-24 homework ownership ──────────────────────────────────────────────
  describe('SA-24 homework', () => {
    beforeAll(async () => {
      id.hw = randomUUID();
      await must(admin.from('homework_assignments').insert({
        id: id.hw, school_id: schoolA, class_id: id.classA1, subject_id: id.subj1, teacher_id: id.tA, title: 'SA2 HW', due_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString(),
      }), 'homework');
    });
    it('another teacher cannot delete or edit it', async () => {
      const del = await as('teacher-a2').from('homework_assignments').delete().eq('id', id.hw).select('id');
      expect(del.data ?? []).toHaveLength(0);
      const upd = await as('teacher-a2').from('homework_assignments').update({ title: 'hijacked' }).eq('id', id.hw).select('id');
      expect(upd.data ?? []).toHaveLength(0);
    });
    it('a teacher cannot create homework under another teacher id', async () => {
      const { error } = await as('teacher-a2').from('homework_assignments').insert({
        id: randomUUID(), school_id: schoolA, class_id: id.classA1, teacher_id: id.tA, title: 'spoof', due_date: '2030-01-01', updated_at: new Date().toISOString(),
      });
      expect(error).not.toBeNull();
    });
    it('the owner can delete it', async () => {
      const del = await as('teacher-a').from('homework_assignments').delete().eq('id', id.hw).select('id');
      expect(del.data).toHaveLength(1);
    });
  });

  // ── SA-17 assessments / grades bound to subject ───────────────────────────
  describe('SA-17 assessments', () => {
    beforeAll(async () => {
      id.assess = randomUUID();
      await must(admin.from('assessments').insert({
        id: id.assess, school_id: schoolA, class_id: id.classA1, subject_id: id.subj1, term_id: id.term, teacher_id: id.tA, name: 'SA2 Subj1 test', max_marks: 10,
      }), 'assessment');
    });
    it('a teacher of a different subject cannot write grades or edit the assessment', async () => {
      const g = await as('teacher-a2').from('grades').insert({ id: randomUUID(), school_id: schoolA, assessment_id: id.assess, student_id: id.sA, score: 10 });
      expect(g.error).not.toBeNull();
      const upd = await as('teacher-a2').from('assessments').update({ name: 'renamed' }).eq('id', id.assess).select('id');
      expect(upd.data ?? []).toHaveLength(0);
      const del = await as('teacher-a2').from('assessments').delete().eq('id', id.assess).select('id');
      expect(del.data ?? []).toHaveLength(0);
    });
    it('the subject teacher can write grades', async () => {
      const g = await as('teacher-a').from('grades').insert({ id: randomUUID(), school_id: schoolA, assessment_id: id.assess, student_id: id.sA, score: 7 });
      expect(g.error).toBeNull();
    });
  });

  // ── SA-15 authoring ownership; SA-30 server scoring; SA-31 answer keys ────
  describe('SA-15 / SA-30 / SA-31 quizzes', () => {
    beforeAll(async () => {
      id.quiz = randomUUID(); id.qMcq = randomUUID(); id.qSa = randomUUID();
      await must(admin.from('quizzes').insert({ id: id.quiz, school_id: schoolA, class_id: id.classA1, created_by_id: u['teacher-a']!.userId, title: 'SA2 quiz', is_published: true }), 'quiz');
      await must(admin.from('quiz_questions').insert([
        { id: id.qMcq, quiz_id: id.quiz, school_id: schoolA, position: 0, kind: 'MCQ', body: '2+2?', options: [{ id: 'opt-a', text: '3' }, { id: 'opt-b', text: '4' }], correct_option_id: 'opt-b', points: 2 },
        { id: id.qSa, quiz_id: id.quiz, school_id: schoolA, position: 1, kind: 'SHORT_ANSWER', body: 'Explain', points: 3 },
      ]), 'questions');
    });

    it('SA-31: a student cannot select the answer key', async () => {
      const { error } = await as('student-a').from('quiz_questions').select('id, correct_option_id').eq('quiz_id', id.quiz);
      expect(error).not.toBeNull();
      const ok = await as('student-a').from('quiz_questions').select('id, body, options, points').eq('quiz_id', id.quiz);
      expect(ok.error).toBeNull();
      expect(ok.data).toHaveLength(2);
    });

    it('SA-31: keys via RPC: teacher yes, student only after submitting', async () => {
      const t = await as('teacher-a').rpc('quiz_answer_keys', { p_quiz_id: id.quiz });
      expect(t.error).toBeNull();
      expect((t.data as Array<{ question_id: string; correct_option_id: string }>).find((k) => k.question_id === id.qMcq)?.correct_option_id).toBe('opt-b');
      const s = await as('student-a2').rpc('quiz_answer_keys', { p_quiz_id: id.quiz });
      expect(s.error).not.toBeNull();
    });

    it('SA-30: a student cannot set their own score; submission is graded server-side', async () => {
      const start = await as('student-a').from('quiz_attempts').upsert({
        school_id: schoolA, quiz_id: id.quiz, student_id: id.sA, answers: {}, score: 99, max_score: 99,
      }, { onConflict: 'quiz_id,student_id' }).select('id, score, max_score').single();
      expect(start.error).toBeNull();
      expect(start.data!.score).toBeNull();
      id.attempt = start.data!.id;

      const sneaky = await as('student-a').from('quiz_attempts').update({ score: 50 }).eq('id', id.attempt).select('score').single();
      expect(sneaky.data?.score ?? null).toBeNull();

      const sub = await as('student-a').from('quiz_attempts').update({
        submitted_at: new Date().toISOString(), answers: { [id.qMcq]: 'opt-b', [id.qSa]: 'because' }, score: 5, max_score: 5,
      }).eq('id', id.attempt).select('score, max_score, submitted_at').single();
      expect(sub.error).toBeNull();
      expect(Number(sub.data!.score)).toBe(2);       // MCQ points only; short answer awaits a teacher
      expect(Number(sub.data!.max_score)).toBe(5);

      const keys = await as('student-a').rpc('quiz_answer_keys', { p_quiz_id: id.quiz });
      expect(keys.error).toBeNull(); // review after submitting
    });

    it('SA-30: the quiz teacher can still add short-answer marks', async () => {
      const t = await as('teacher-a').from('quiz_attempts').update({ score: 4 }).eq('id', id.attempt).select('score').single();
      expect(t.error).toBeNull();
      expect(Number(t.data!.score)).toBe(4);
    });

    it('SA-15: another teacher cannot edit the quiz, its questions or grade its attempts', async () => {
      const q = await as('teacher-a2').from('quizzes').update({ title: 'hijacked' }).eq('id', id.quiz).select('id');
      expect(q.data ?? []).toHaveLength(0);
      const owner = await as('teacher-a2').from('quizzes').update({ created_by_id: u['teacher-a2']!.userId }).eq('id', id.quiz).select('id');
      expect(owner.data ?? []).toHaveLength(0);
      const qq = await as('teacher-a2').from('quiz_questions').insert({ quiz_id: id.quiz, school_id: schoolA, position: 9, kind: 'MCQ', body: 'x', points: 1 });
      expect(qq.error).not.toBeNull();
      const qa = await as('teacher-a2').from('quiz_attempts').update({ score: 0 }).eq('id', id.attempt).select('id');
      expect(qa.data ?? []).toHaveLength(0);
    });

    it('SA-15: assignments and submission grading', async () => {
      id.asg = randomUUID();
      await must(admin.from('assignments').insert({ id: id.asg, school_id: schoolA, class_id: id.classA1, created_by_id: u['teacher-a']!.userId, title: 'SA2 asg', due_date: '2030-01-01' }), 'assignment');
      const upd = await as('teacher-a2').from('assignments').update({ title: 'hijacked' }).eq('id', id.asg).select('id');
      expect(upd.data ?? []).toHaveLength(0);
      const spoof = await as('teacher-a2').from('assignments').insert({ school_id: schoolA, class_id: id.classA1, created_by_id: u['teacher-a']!.userId, title: 'spoof', due_date: '2030-01-01' });
      expect(spoof.error).not.toBeNull();

      await must(admin.from('submissions').insert({ id: randomUUID(), school_id: schoolA, assignment_id: id.asg, student_id: id.sA, content: 'original answer', submitted_at: new Date().toISOString() }), 'submission');
      const rewrite = await as('teacher-a').from('submissions').update({ content: 'rewritten' }).eq('assignment_id', id.asg).eq('student_id', id.sA);
      expect(rewrite.error?.code).toBe('42501');
      const grade = await as('teacher-a').from('submissions').update({ grade_score: 8, graded_at: new Date().toISOString() }).eq('assignment_id', id.asg).eq('student_id', id.sA).select('id');
      expect(grade.error).toBeNull();
      expect(grade.data).toHaveLength(1);
    });
  });

  // ── SA-19 behaviour points visibility ─────────────────────────────────────
  describe('SA-19 behaviour_points', () => {
    beforeAll(async () => {
      await must(admin.from('behaviour_points').insert([
        { id: randomUUID(), school_id: schoolA, student_id: id.sA, teacher_id: id.tA, category: 'POSITIVE', points: 1, reason: 'mine' },
        { id: randomUUID(), school_id: schoolA, student_id: id.sA2, teacher_id: id.tA, category: 'NEGATIVE', points: 1, reason: 'private to a2' },
      ]), 'behaviour_points');
    });
    it('a student sees only their own rows; a parent only their child; staff see all', async () => {
      const s = await as('student-a').from('behaviour_points').select('student_id');
      expect((s.data ?? []).map((r) => r.student_id)).toEqual([id.sA]);
      const p = await as('parent-a').from('behaviour_points').select('student_id');
      expect((p.data ?? []).map((r) => r.student_id)).toEqual([id.sA]);
      const t = await as('teacher-a').from('behaviour_points').select('student_id');
      expect(t.data ?? []).toHaveLength(2);
    });
  });

  // ── SA-23 document chunks inherit document visibility ─────────────────────
  describe('SA-23 document_chunks', () => {
    beforeAll(async () => {
      id.docWide = randomUUID(); id.docOtherClass = randomUUID(); id.docDeleted = randomUUID();
      const base = { school_id: schoolA, uploaded_by_id: u['teacher-a']!.userId, file_name: 'x.pdf', storage_path: `${schoolA}/x.pdf` };
      await must(admin.from('documents').insert([
        { ...base, id: id.docWide, title: 'Wide', scope_type: 'SCHOOL_WIDE' },
        { ...base, id: id.docOtherClass, title: 'Other class', scope_type: 'CLASS', scope_id: id.classA2 },
        { ...base, id: id.docDeleted, title: 'Deleted', scope_type: 'SCHOOL_WIDE', deleted_at: new Date().toISOString() },
      ]), 'documents');
      await must(admin.from('document_chunks').insert([id.docWide, id.docOtherClass, id.docDeleted].map((d) => ({ id: randomUUID(), school_id: schoolA, document_id: d, chunk_index: 0, content: `chunk of ${d}` }))), 'chunks');
    });
    it('a student reads chunks only of documents they can see', async () => {
      const { data, error } = await as('student-a').from('document_chunks').select('document_id');
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.document_id)).toEqual([id.docWide]);
    });
  });

  // ── SA-27 / SA-26 / SA-20 column allowlists ───────────────────────────────
  describe('column allowlists', () => {
    beforeAll(async () => {
      id.notif = randomUUID(); id.conv = randomUUID(); id.msg = randomUUID();
      await must(admin.from('notifications').insert({ id: id.notif, school_id: schoolA, recipient_id: u['student-a']!.userId, type: 'ANNOUNCEMENT', title: 'Hello', body: 'Body' }), 'notification');
      await must(admin.from('conversations').insert({ id: id.conv, school_id: schoolA, parent_user_id: u['parent-a']!.userId, teacher_user_id: u['teacher-a']!.userId, student_id: id.sA, parent_unread_count: 1 }), 'conversation');
      await must(admin.from('messages').insert({ id: id.msg, school_id: schoolA, conversation_id: id.conv, sender_id: u['teacher-a']!.userId, body: 'Original' }), 'message');
    });
    it('SA-27: a recipient can mark read but not rewrite a notification', async () => {
      const bad = await as('student-a').from('notifications').update({ title: 'Send me SMS', email_sent_at: null }).eq('id', id.notif);
      expect(bad.error?.code).toBe('42501');
      const ok = await as('student-a').from('notifications').update({ is_read: true, acknowledged_at: new Date().toISOString() }).eq('id', id.notif).select('id');
      expect(ok.error).toBeNull();
      expect(ok.data).toHaveLength(1);
    });
    it('SA-26: a participant can mark read but not forge a message or re-point a conversation', async () => {
      const body = await as('parent-a').from('messages').update({ body: 'Forged' }).eq('id', id.msg);
      expect(body.error?.code).toBe('42501');
      const read = await as('parent-a').from('messages').update({ read_at: new Date().toISOString() }).eq('id', id.msg).select('id');
      expect(read.error).toBeNull();
      const repoint = await as('parent-a').from('conversations').update({ teacher_user_id: u['teacher-a2']!.userId }).eq('id', id.conv);
      expect(repoint.error?.code).toBe('42501');
      const counter = await as('parent-a').from('conversations').update({ parent_unread_count: 0 }).eq('id', id.conv).select('id');
      expect(counter.error).toBeNull();
    });
    it('SA-20: a class teacher can set the prefect but not rewrite the class; admin can', async () => {
      const bad = await as('teacher-a').from('classes').update({ name: 'Renamed', is_active: false }).eq('id', id.classA1);
      expect(bad.error?.code).toBe('42501');
      const ok = await as('teacher-a').from('classes').update({ prefect_student_id: id.sA, updated_at: new Date().toISOString() }).eq('id', id.classA1).select('id');
      expect(ok.error).toBeNull();
      expect(ok.data).toHaveLength(1);
      const adminOk = await as('admin-a').from('classes').update({ name: 'SA2 Class 1 renamed', updated_at: new Date().toISOString() }).eq('id', id.classA1).select('id');
      expect(adminOk.error).toBeNull();
      expect(adminOk.data).toHaveLength(1);
    });
  });

  // ── SA-18 audit logs attribution ──────────────────────────────────────────
  describe('SA-18 audit_logs', () => {
    it('cannot insert rows attributed to someone else or with no school', async () => {
      const other = await as('teacher-a').from('audit_logs').insert({ id: randomUUID(), school_id: schoolA, user_id: u['admin-a']!.userId, action: 'forged', entity_type: 'x' });
      expect(other.error).not.toBeNull();
      const noSchool = await as('teacher-a').from('audit_logs').insert({ id: randomUUID(), school_id: null, user_id: u['teacher-a']!.userId, action: 'forged', entity_type: 'x' });
      expect(noSchool.error).not.toBeNull();
      const own = await as('teacher-a').from('audit_logs').insert({ id: randomUUID(), school_id: schoolA, user_id: u['teacher-a']!.userId, action: 'secaudit.test', entity_type: 'x' });
      expect(own.error).toBeNull();
    });
  });

  // ── SA-29 permission slips ────────────────────────────────────────────────
  describe('SA-29 permission_slip_responses', () => {
    beforeAll(async () => {
      id.slip = randomUUID();
      await must(admin.from('permission_slips').insert({ id: id.slip, school_id: schoolA, created_by_id: u['admin-a']!.userId, title: 'Trip', one_time_code: '123456' }), 'slip');
    });
    it('a parent cannot sign for a child that is not theirs, or as someone else', async () => {
      const notMine = await as('parent-a').from('permission_slip_responses').insert({ school_id: schoolA, slip_id: id.slip, student_id: id.sA2, parent_user_id: u['parent-a']!.userId });
      expect(notMine.error).not.toBeNull();
      const spoof = await as('parent-a').from('permission_slip_responses').insert({ school_id: schoolA, slip_id: id.slip, student_id: id.sA, parent_user_id: u['admin-a']!.userId });
      expect(spoof.error).not.toBeNull();
      const ok = await as('parent-a').from('permission_slip_responses').insert({ school_id: schoolA, slip_id: id.slip, student_id: id.sA, parent_user_id: u['parent-a']!.userId });
      expect(ok.error).toBeNull();
    });
  });

  // ── SA-32 / SA-33 payments ────────────────────────────────────────────────
  describe('SA-32 / SA-33 payments', () => {
    beforeAll(async () => {
      id.feeA = randomUUID(); id.feeA2 = randomUUID(); id.txn = randomUUID();
      const now = new Date().toISOString();
      await must(admin.from('fee_balances').insert([
        { id: id.feeA, school_id: schoolA, student_id: id.sA, amount_due: 1000, updated_at: now },
        { id: id.feeA2, school_id: schoolA, student_id: id.sA2, amount_due: 1000, updated_at: now },
      ]), 'fees');
      await must(admin.from('payment_records').insert([
        { id: randomUUID(), school_id: schoolA, fee_balance_id: id.feeA, student_id: id.sA, amount: 100, payment_method: 'cash' },
        { id: randomUUID(), school_id: schoolA, fee_balance_id: id.feeA2, student_id: id.sA2, amount: 200, payment_method: 'cash' },
      ]), 'payment_records');
      await must(admin.from('payment_transactions').insert({ id: id.txn, school_id: schoolA, student_id: id.sA, parent_user_id: u['parent-a']!.userId, fee_balance_id: id.feeA, reference: `sa2-${suffix}`, amount: 100, status: 'PENDING' }), 'txn');
    });
    it('SA-32: a parent sees only their child payment records; a teacher sees none', async () => {
      const p = await as('parent-a').from('payment_records').select('student_id');
      expect((p.data ?? []).map((r) => r.student_id)).toEqual([id.sA]);
      const t = await as('teacher-a').from('payment_records').select('id');
      expect(t.data ?? []).toHaveLength(0);
    });
    it('SA-33: users cannot write payment_transactions directly', async () => {
      const upd = await as('parent-a').from('payment_transactions').update({ status: 'PENDING', amount: 999999 }).eq('id', id.txn).select('id');
      expect(upd.data ?? []).toHaveLength(0);
      const ins = await as('parent-a').from('payment_transactions').insert({ school_id: schoolA, student_id: id.sA, parent_user_id: u['parent-a']!.userId, reference: `forged-${suffix}`, amount: 1 });
      expect(ins.error).not.toBeNull();
      const { data } = await admin.from('payment_transactions').select('amount').eq('id', id.txn).single();
      expect(Number(data!.amount)).toBe(100);
    });
  });

  // ── SA-37 / SA-34 lifecycle (run last: they flip shared fixture state) ─────
  describe('SA-37 / SA-34 lifecycle', () => {
    it('SA-37: a deactivated user loses RLS access immediately, and regains it on reactivation', async () => {
      const before = await as('student-a2').from('classes').select('id');
      expect((before.data ?? []).length).toBeGreaterThan(0);
      await must(admin.from('users').update({ is_active: false }).eq('id', u['student-a2']!.userId), 'deactivate');
      try {
        const during = await as('student-a2').from('classes').select('id');
        expect(during.data ?? []).toHaveLength(0);
      } finally {
        await admin.from('users').update({ is_active: true }).eq('id', u['student-a2']!.userId);
      }
      const after = await as('student-a2').from('classes').select('id');
      expect((after.data ?? []).length).toBeGreaterThan(0);
    });

    it('SA-34: a suspended school loses RLS access; other schools are unaffected', async () => {
      await must(admin.from('schools').update({ status: 'SUSPENDED' }).eq('id', schoolB), 'suspend');
      try {
        const b = await as('teacher-b').from('teachers').select('id');
        expect(b.data ?? []).toHaveLength(0);
        const a = await as('teacher-a').from('classes').select('id');
        expect((a.data ?? []).length).toBeGreaterThan(0);
      } finally {
        await admin.from('schools').update({ status: 'ACTIVE' }).eq('id', schoolB);
      }
      const restored = await as('teacher-b').from('teachers').select('id');
      expect((restored.data ?? []).length).toBeGreaterThan(0);
    });
  });
});
