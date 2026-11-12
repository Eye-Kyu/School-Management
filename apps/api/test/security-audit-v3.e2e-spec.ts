// =============================================================================
// Security audit 2026-11: live verification of the V3 database fix (migration
// 20261112000102): SA-42 behaviour_points delete scope, SA-43 module gate on
// bp_insert / ps_insert, plus bp_insert's teacher_id binding.
// =============================================================================
// Direct PostgREST as each dummy user, the path an attacker with their own JWT
// would use. Isolated dummy schools/users are created in beforeAll and deleted
// in afterAll (security-audit-v2.e2e-spec.ts pattern).
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

describe('Security audit V3 fixes (e2e)', () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const schoolA = randomUUID(); // modules on (no override)
  const schoolC = randomUUID(); // behaviour_tracking + permission_slips switched off
  const authUserIds: string[] = [];
  const u: Record<string, Seeded> = {};
  const id: Record<string, string> = {};
  const now = () => new Date().toISOString();

  function clientAs(token?: string): SupabaseClient {
    return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
      ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
    });
  }
  const as = (label: string) => clientAs(u[label]!.token);

  async function seedUser(label: string, role: string, schoolId: string) {
    const email = `${label}-${suffix}@test-secaudit3.internal`;
    const password = `TestPass${suffix}!`;
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { role, school_id: schoolId },
    });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    authUserIds.push(data.user.id);
    await admin.from('users').upsert({
      id: randomUUID(), school_id: schoolId, auth_id: data.user.id, email, full_name: `Test ${label}`, role, updated_at: now(),
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

  const point = (teacherId: string, studentId = id.sA, schoolId = schoolA) => ({
    id: randomUUID(), school_id: schoolId, student_id: studentId, teacher_id: teacherId,
    category: 'POSITIVE', points: 1, reason: 'SA3 test',
  });

  beforeAll(async () => {
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME_OPTIONS,
    });
    await must(admin.from('schools').insert([
      { id: schoolA, name: `SecAudit3 A ${suffix}`, slug: `secaudit3-a-${suffix}`, updated_at: now() },
      { id: schoolC, name: `SecAudit3 C ${suffix}`, slug: `secaudit3-c-${suffix}`, updated_at: now() },
    ]), 'schools');
    await must(admin.from('school_modules').insert([
      { school_id: schoolC, module_key: 'behaviour_tracking', enabled: false },
      { school_id: schoolC, module_key: 'permission_slips', enabled: false },
    ]), 'school_modules');

    id.classA1 = randomUUID(); id.classC1 = randomUUID();
    await must(admin.from('classes').insert([
      { id: id.classA1, school_id: schoolA, name: 'SA3 Class A1', grade_level: 1, updated_at: now() },
      { id: id.classC1, school_id: schoolC, name: 'SA3 Class C1', grade_level: 1, updated_at: now() },
    ]), 'classes');
    id.subj = randomUUID();
    await must(admin.from('subjects').insert({ id: id.subj, school_id: schoolA, name: `SA3 Subj ${suffix}`, code: 'S3', updated_at: now() }), 'subjects');

    await seedUser('admin-a', 'ADMIN', schoolA);
    await seedUser('teacher-a', 'TEACHER', schoolA);   // class teacher of A1
    await seedUser('teacher-a2', 'TEACHER', schoolA);  // subject teacher in A1
    await seedUser('teacher-a3', 'TEACHER', schoolA);  // no relation to A1
    await seedUser('student-a', 'STUDENT', schoolA);
    await seedUser('admin-c', 'ADMIN', schoolC);
    await seedUser('teacher-c', 'TEACHER', schoolC);   // class teacher of C1
    await seedUser('student-c', 'STUDENT', schoolC);

    id.tA = randomUUID(); id.tA2 = randomUUID(); id.tA3 = randomUUID(); id.tC = randomUUID();
    await must(admin.from('teachers').insert([
      { id: id.tA, school_id: schoolA, user_id: u['teacher-a']!.userId, staff_no: `SA3T-${suffix}`, is_class_teacher_of: id.classA1, updated_at: now() },
      { id: id.tA2, school_id: schoolA, user_id: u['teacher-a2']!.userId, staff_no: `SA3T2-${suffix}`, updated_at: now() },
      { id: id.tA3, school_id: schoolA, user_id: u['teacher-a3']!.userId, staff_no: `SA3T3-${suffix}`, updated_at: now() },
      { id: id.tC, school_id: schoolC, user_id: u['teacher-c']!.userId, staff_no: `SA3TC-${suffix}`, is_class_teacher_of: id.classC1, updated_at: now() },
    ]), 'teachers');
    await must(admin.from('subject_assignments').insert(
      { id: randomUUID(), class_id: id.classA1, subject_id: id.subj, teacher_id: id.tA2 },
    ), 'subject_assignments');
    id.sA = randomUUID(); id.sC = randomUUID();
    await must(admin.from('students').insert([
      { id: id.sA, school_id: schoolA, user_id: u['student-a']!.userId, current_class_id: id.classA1, admission_no: `SA3-A-${suffix}`, updated_at: now() },
      { id: id.sC, school_id: schoolC, user_id: u['student-c']!.userId, current_class_id: id.classC1, admission_no: `SA3-C-${suffix}`, updated_at: now() },
    ]), 'students');
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('schools').delete().in('id', [schoolA, schoolC]);
    await admin.from('users').delete().in('auth_id', authUserIds);
    for (const a of authUserIds) await admin.auth.admin.deleteUser(a).catch(() => undefined);
  }, 300_000);

  // ── SA-43: module gate on INSERT ──────────────────────────────────────────
  describe('SA-43 module gate', () => {
    it('a class teacher cannot add behaviour points while the module is off', async () => {
      const { error } = await as('teacher-c').from('behaviour_points').insert(point(id.tC, id.sC, schoolC));
      expect(error).not.toBeNull();
    });
    it('an admin cannot create a permission slip while the module is off', async () => {
      const { error } = await as('admin-c').from('permission_slips').insert({
        id: randomUUID(), school_id: schoolC, created_by_id: u['admin-c']!.userId, title: 'Trip', one_time_code: '123456',
      });
      expect(error).not.toBeNull();
    });
    it('both still work when the module is on', async () => {
      const bp = await as('teacher-a').from('behaviour_points').insert(point(id.tA));
      expect(bp.error).toBeNull();
      const ps = await as('admin-a').from('permission_slips').insert({
        id: randomUUID(), school_id: schoolA, created_by_id: u['admin-a']!.userId, title: 'Trip', one_time_code: '123456',
      });
      expect(ps.error).toBeNull();
      const cls = await as('teacher-a').from('permission_slips').insert({
        id: randomUUID(), school_id: schoolA, created_by_id: u['teacher-a']!.userId, title: 'Class trip', one_time_code: '654321',
        audience: 'CLASS', target_class_id: id.classA1,
      });
      expect(cls.error).toBeNull();
    });
  });

  // ── bp_insert teacher_id binding ──────────────────────────────────────────
  describe('bp_insert attribution', () => {
    it('a subject teacher cannot award points in another teacher\'s name', async () => {
      const { error } = await as('teacher-a2').from('behaviour_points').insert(point(id.tA));
      expect(error).not.toBeNull();
    });
    it('a subject teacher can award points in their own name', async () => {
      const { error } = await as('teacher-a2').from('behaviour_points').insert(point(id.tA2));
      expect(error).toBeNull();
    });
  });

  // ── SA-42: delete scope ───────────────────────────────────────────────────
  describe('SA-42 bp_delete', () => {
    it('an unrelated teacher cannot delete a point', async () => {
      const row = point(id.tA2);
      await must(admin.from('behaviour_points').insert(row), 'seed point');
      const del = await as('teacher-a3').from('behaviour_points').delete().eq('id', row.id).select('id');
      expect(del.data ?? []).toHaveLength(0);
      const { data } = await admin.from('behaviour_points').select('id').eq('id', row.id);
      expect(data).toHaveLength(1);
    });
    it('the awarding teacher, the class teacher and an admin can delete', async () => {
      const rows = [point(id.tA2), point(id.tA2), point(id.tA2)];
      await must(admin.from('behaviour_points').insert(rows), 'seed points');
      for (const [label, row] of [['teacher-a2', rows[0]], ['teacher-a', rows[1]], ['admin-a', rows[2]]] as const) {
        const del = await as(label).from('behaviour_points').delete().eq('id', row.id).select('id');
        expect({ label, n: (del.data ?? []).length }).toEqual({ label, n: 1 });
      }
    });
  });
});
