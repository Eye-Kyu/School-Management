// =============================================================================
// Security audit 2026-11: live verification of the V1 database fixes
// =============================================================================
// Exercises migrations 20261112000091..095 against the real Supabase project,
// through the same direct-PostgREST/Storage paths an attacker would use (the
// browser holds the anon key and the user's JWT). Follows the established
// e2e pattern (cross-tenant.e2e-spec.ts): isolated dummy schools and users
// created in beforeAll, everything deleted in afterAll.
//
//   SA-10  signup trigger ignores client-writable user_metadata role
//   SA-11  users cannot change privileged columns on their own row
//   SA-14  write_linked_grade requires staff of the assessment's school
//   SA-09  record_quiz_grade requires the attempt owner or staff of its school
//   SA-08  platform-table writes are not possible with a user JWT
//   SA-02  assignments bucket is private and tenant-scoped
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

describe('Security audit V1 fixes (e2e)', () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const authUserIds: string[] = [];
  const uploadedPaths: string[] = [];

  let classAId: string;
  let assessmentAId: string;
  let assignmentAId: string;
  let studentAId: string;
  const ids: Record<string, { authId: string; userId: string; token: string }> = {};

  function clientAs(token?: string): SupabaseClient {
    return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
      ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
    });
  }

  /**
   * Creates a user the way the API now does (app_metadata), then upserts the
   * users row explicitly, like every other e2e suite and every API create
   * path except createSuperAdmin. Trigger-based provisioning is asserted
   * separately in the SA-10 block.
   */
  async function seedUser(label: string, role: string, schoolId: string | null) {
    const email = `${label}-${suffix}@test-secaudit.internal`;
    const password = `TestPass${suffix}!`;
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: `Test ${label}` },
      app_metadata: { role, ...(schoolId ? { school_id: schoolId } : {}) },
    });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    authUserIds.push(data.user.id);
    const { error: upErr } = await admin.from('users').upsert({
      id: randomUUID(), school_id: schoolId, auth_id: data.user.id, email, full_name: `Test ${label}`, role, updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_id', ignoreDuplicates: true });
    if (upErr) throw new Error(`users upsert ${label}: ${upErr.message}`);
    const { data: row } = await admin.from('users').select('id, role, school_id').eq('auth_id', data.user.id).maybeSingle();
    if (!row) throw new Error(`no users row for ${label}`);
    const { data: session, error: signErr } = await clientAs().auth.signInWithPassword({ email, password });
    if (signErr) throw new Error(`signIn ${label}: ${signErr.message}`);
    ids[label] = { authId: data.user.id, userId: row.id, token: session.session!.access_token };
    return ids[label]!;
  }

  beforeAll(async () => {
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
    });
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const { error: sErr } = await admin.from('schools').insert([
      { id: schoolAId, name: `SecAudit School A ${suffix}`, slug: `secaudit-a-${suffix}`, updated_at: now },
      { id: schoolBId, name: `SecAudit School B ${suffix}`, slug: `secaudit-b-${suffix}`, updated_at: now },
    ]);
    if (sErr) throw new Error(`schools: ${sErr.message}`);

    classAId = randomUUID();
    const subjectAId = randomUUID();
    const termAId = randomUUID();
    await admin.from('classes').insert({ id: classAId, school_id: schoolAId, name: 'SecAudit Class', grade_level: 1, updated_at: now });
    await admin.from('subjects').insert({ id: subjectAId, school_id: schoolAId, name: `SecAudit Subject ${suffix}`, code: 'SAS', updated_at: now });
    await admin.from('terms').insert({ id: termAId, school_id: schoolAId, name: `SecAudit Term ${suffix}`, start_date: today, end_date: today, is_current: true });

    const teacherA = await seedUser('teacher-a', 'TEACHER', schoolAId);
    await seedUser('teacher-b', 'TEACHER', schoolBId);
    const studentA = await seedUser('student-a', 'STUDENT', schoolAId);
    await seedUser('super-admin', 'SUPER_ADMIN', null);

    const teacherRowId = randomUUID();
    // Class teacher of classA: the assignments SELECT policy (20260724000054)
    // only shows a teacher the assignments of classes they teach, and the
    // assignments Storage policy inherits that through its EXISTS subquery.
    await admin.from('teachers').insert({ id: teacherRowId, school_id: schoolAId, user_id: teacherA.userId, staff_no: `SAT-${suffix}`, is_class_teacher_of: classAId, updated_at: now });
    const teacherA2 = await seedUser('teacher-a2', 'TEACHER', schoolAId);
    await admin.from('teachers').insert({ id: randomUUID(), school_id: schoolAId, user_id: teacherA2.userId, staff_no: `SAT2-${suffix}`, updated_at: now });
    studentAId = randomUUID();
    const { error: stErr } = await admin.from('students').insert({
      id: studentAId, school_id: schoolAId, user_id: studentA.userId, current_class_id: classAId, admission_no: `SECAUDIT-${suffix}`, updated_at: now,
    });
    if (stErr) throw new Error(`students: ${stErr.message}`);

    assessmentAId = randomUUID();
    const { error: aErr } = await admin.from('assessments').insert({
      id: assessmentAId, school_id: schoolAId, class_id: classAId, subject_id: subjectAId, term_id: termAId,
      teacher_id: teacherRowId, name: 'SecAudit Assessment', max_marks: 10,
    });
    if (aErr) throw new Error(`assessments: ${aErr.message}`);

    assignmentAId = randomUUID();
    const { error: asErr } = await admin.from('assignments').insert({
      id: assignmentAId, school_id: schoolAId, class_id: classAId, created_by_id: teacherA.userId, title: 'SecAudit Assignment', due_date: today,
    });
    if (asErr) throw new Error(`assignments: ${asErr.message}`);
  });

  afterAll(async () => {
    if (!admin) return;
    if (uploadedPaths.length) await admin.storage.from('assignments').remove(uploadedPaths);
    await admin.from('grades').delete().eq('assessment_id', assessmentAId);
    await admin.from('quiz_attempts').delete().eq('school_id', schoolAId);
    await admin.from('quizzes').delete().eq('school_id', schoolAId);
    await admin.from('assessments').delete().eq('school_id', schoolAId);
    await admin.from('assignments').delete().eq('school_id', schoolAId);
    await admin.from('privileged_access_grants').delete().in('target_school_id', [schoolAId, schoolBId]);
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('students').delete().eq('school_id', schoolAId);
    await admin.from('teachers').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('terms').delete().eq('school_id', schoolAId);
    await admin.from('subjects').delete().eq('school_id', schoolAId);
    await admin.from('classes').delete().eq('school_id', schoolAId);
    await admin.from('users').delete().in('auth_id', authUserIds);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => undefined);
  });

  // ── SA-10 ───────────────────────────────────────────────────────────────
  describe('SA-10 signup trigger', () => {
    async function createWithUserMetadataOnly(label: string, meta: Record<string, unknown>) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `${label}-${suffix}@test-secaudit.internal`, password: `TestPass${suffix}!`, email_confirm: true, user_metadata: meta,
      });
      if (error) throw new Error(error.message);
      authUserIds.push(data.user.id);
      const { data: row } = await admin.from('users').select('id').eq('auth_id', data.user.id).maybeSingle();
      return row;
    }

    it('creates no users row from a client-style user_metadata role SUPER_ADMIN', async () => {
      expect(await createWithUserMetadataOnly('meta-superadmin', { role: 'SUPER_ADMIN' })).toBeNull();
    });

    it('creates no users row from user_metadata ADMIN of a known school', async () => {
      expect(await createWithUserMetadataOnly('meta-admin', { role: 'ADMIN', school_id: schoolAId })).toBeNull();
    });

    it('provisions a users row via the trigger for app_metadata users (needs migration 096)', async () => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `meta-app-${suffix}@test-secaudit.internal`, password: `TestPass${suffix}!`, email_confirm: true,
        app_metadata: { role: 'TEACHER', school_id: schoolAId },
      });
      if (error) throw new Error(error.message);
      authUserIds.push(data.user.id);
      const { data: row } = await admin.from('users').select('role, school_id').eq('auth_id', data.user.id).maybeSingle();
      expect(row).toEqual({ role: 'TEACHER', school_id: schoolAId });
    });

    it('provisions SUPER_ADMIN with the full permission set via app_metadata (createSuperAdmin path, needs 096)', async () => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `meta-app-sa-${suffix}@test-secaudit.internal`, password: `TestPass${suffix}!`, email_confirm: true,
        app_metadata: { role: 'SUPER_ADMIN' },
      });
      if (error) throw new Error(error.message);
      authUserIds.push(data.user.id);
      const { data: row } = await admin.from('users').select('role, platform_permissions').eq('auth_id', data.user.id).maybeSingle();
      expect(row?.role).toBe('SUPER_ADMIN');
      expect((row?.platform_permissions as string[] | undefined)?.length).toBe(18);
    });
  });

  // ── SA-11 ───────────────────────────────────────────────────────────────
  describe('SA-11 users self-update', () => {
    const tryPatch = (patch: Record<string, unknown>) =>
      clientAs(ids['student-a']!.token).from('users').update(patch).eq('auth_id', ids['student-a']!.authId).select('id');

    it.each([
      ['role', { role: 'SUPER_ADMIN' }],
      ['role (ADMIN)', { role: 'ADMIN' }],
      ['school_id', { school_id: schoolBId }],
      ['platform_permissions', { platform_permissions: ['MANAGE_SCHOOLS'] }],
      ['is_active', { is_active: false }],
    ])('rejects a self-update of %s', async (_label, patch) => {
      const { error } = await tryPatch(patch);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
      const { data } = await admin.from('users').select('role, school_id, platform_permissions, is_active').eq('id', ids['student-a']!.userId).single();
      expect(data).toEqual({ role: 'STUDENT', school_id: schoolAId, platform_permissions: [], is_active: true });
    });

    it('still allows profile edits', async () => {
      const { data, error } = await tryPatch({ full_name: 'Renamed Student' });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('still allows service-role (admin client) changes', async () => {
      const { error } = await admin.from('users').update({ is_active: true }).eq('id', ids['student-a']!.userId);
      expect(error).toBeNull();
    });
  });

  // ── SA-14 ───────────────────────────────────────────────────────────────
  describe('SA-14 write_linked_grade', () => {
    const call = (token: string) => clientAs(token).rpc('write_linked_grade', { p_assessment_id: assessmentAId, p_student_id: studentAId, p_score: 9 });

    it('rejects a student caller', async () => {
      const { error } = await call(ids['student-a']!.token);
      expect(error?.message).toMatch(/Not authorized/);
    });

    it('rejects a teacher of another school', async () => {
      const { error } = await call(ids['teacher-b']!.token);
      expect(error?.message).toMatch(/Not authorized/);
    });

    it('allows a teacher of the assessment school', async () => {
      const { data, error } = await call(ids['teacher-a']!.token);
      expect(error).toBeNull();
      expect(data).toBeTruthy();
    });

    it('does not expose the internal writer to users', async () => {
      const { error } = await clientAs(ids['teacher-a']!.token).rpc('_write_linked_grade_internal', { p_assessment_id: assessmentAId, p_student_id: studentAId, p_score: 1 });
      expect(error).not.toBeNull();
    });

    it('is not callable by anon', async () => {
      const { error } = await clientAs().rpc('write_linked_grade', { p_assessment_id: assessmentAId, p_student_id: studentAId, p_score: 1 });
      expect(error).not.toBeNull();
    });
  });

  // ── SA-09 ───────────────────────────────────────────────────────────────
  describe('SA-09 record_quiz_grade', () => {
    let attemptId: string;
    beforeAll(async () => {
      const quizId = randomUUID();
      await admin.from('quizzes').insert({ id: quizId, school_id: schoolAId, class_id: classAId, created_by_id: ids['teacher-a']!.userId, title: 'SecAudit quiz', is_published: true });
      await admin.from('assessments').update({ source_type: 'QUIZ', source_id: quizId }).eq('id', assessmentAId);
      attemptId = randomUUID();
      const { error } = await admin.from('quiz_attempts').insert({
        id: attemptId, school_id: schoolAId, quiz_id: quizId, student_id: studentAId, submitted_at: new Date().toISOString(), score: 7, max_score: 10, answers: {},
      });
      if (error) throw new Error(`quiz_attempts: ${error.message}`);
    });

    it('rejects a teacher of another school', async () => {
      const { error } = await clientAs(ids['teacher-b']!.token).rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
      expect(error?.message).toMatch(/Not authorized/);
    });

    it('rejects a super-admin with no school (NULL-safe predicate)', async () => {
      const { error } = await clientAs(ids['super-admin']!.token).rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
      expect(error?.message).toMatch(/Not authorized/);
    });

    it('allows the student who owns the attempt', async () => {
      const { error, data } = await clientAs(ids['student-a']!.token).rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
      expect(error).toBeNull();
      expect(data).toBeTruthy();
    });

    it('allows a teacher of the attempt school', async () => {
      const { error } = await clientAs(ids['teacher-a']!.token).rpc('record_quiz_grade', { p_quiz_attempt_id: attemptId });
      expect(error).toBeNull();
    });
  });

  // ── SA-08 ───────────────────────────────────────────────────────────────
  describe('SA-08 platform tables', () => {
    it('a SUPER_ADMIN JWT cannot insert a privileged-access grant directly', async () => {
      const { error } = await clientAs(ids['super-admin']!.token).from('privileged_access_grants').insert({
        super_admin_user_id: ids['super-admin']!.userId, target_school_id: schoolAId, reason: 'direct write test',
        scopes: ['ACADEMIC_DATA'], expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
      });
      expect(error?.code).toBe('42501');
    });

    it('a SUPER_ADMIN JWT cannot write school_modules directly', async () => {
      const { error } = await clientAs(ids['super-admin']!.token).from('school_modules').insert({ school_id: schoolAId, module_key: 'quizzes', enabled: true });
      expect(error).not.toBeNull();
    });

    it('a SUPER_ADMIN JWT can still read platform tables', async () => {
      const { error } = await clientAs(ids['super-admin']!.token).from('privileged_access_grants').select('id').limit(1);
      expect(error).toBeNull();
    });
  });

  // ── SA-02 ───────────────────────────────────────────────────────────────
  describe('SA-02 assignments bucket', () => {
    let ownPath: string;
    beforeAll(async () => {
      ownPath = `submissions/${assignmentAId}/${ids['student-a']!.authId}/${Date.now()}_answer.txt`;
    });

    it('lets a student upload into their own auth-uid folder', async () => {
      const { error } = await clientAs(ids['student-a']!.token).storage.from('assignments')
        .upload(ownPath, new Blob(['dummy answer'], { type: 'text/plain' }), { contentType: 'text/plain' });
      expect(error).toBeNull();
      uploadedPaths.push(ownPath);
    });

    it('rejects an upload into another user folder', async () => {
      const otherPath = `submissions/${assignmentAId}/${ids['teacher-a']!.authId}/${Date.now()}_spoof.txt`;
      const { error } = await clientAs(ids['student-a']!.token).storage.from('assignments')
        .upload(otherPath, new Blob(['x'], { type: 'text/plain' }), { contentType: 'text/plain' });
      expect(error).not.toBeNull();
      if (!error) uploadedPaths.push(otherPath);
    });

    it('does not serve the object publicly', async () => {
      const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/assignments/${ownPath}`);
      expect(res.ok).toBe(false);
    });

    it('refuses a same-school teacher who does not teach the class', async () => {
      const { error } = await clientAs(ids['teacher-a2']!.token).storage.from('assignments').createSignedUrl(ownPath, 60);
      expect(error).not.toBeNull();
    });

    it('lets a teacher of the class sign the file', async () => {
      const { data, error } = await clientAs(ids['teacher-a']!.token).storage.from('assignments').createSignedUrl(ownPath, 60);
      expect(error).toBeNull();
      expect(data?.signedUrl).toBeTruthy();
    });

    it('lets the uploading student sign their own file', async () => {
      const { error } = await clientAs(ids['student-a']!.token).storage.from('assignments').createSignedUrl(ownPath, 60);
      expect(error).toBeNull();
    });

    it('refuses a teacher of another school and anon', async () => {
      const b = await clientAs(ids['teacher-b']!.token).storage.from('assignments').createSignedUrl(ownPath, 60);
      expect(b.error).not.toBeNull();
      const anon = await clientAs().storage.from('assignments').createSignedUrl(ownPath, 60);
      expect(anon.error).not.toBeNull();
    });
  });
});
