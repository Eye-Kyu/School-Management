// =============================================================================
// Documents in context — scope-based visibility, security fixes, download
// tracking — Bucket 1, PR 3 Phase 2
// =============================================================================
// Covers what unit tests (documents.service.spec.ts, mocked Supabase) can't:
// real RLS proof for each of the four scope types via user_can_see_document(),
// cross-tenant isolation, the BUG-10/BUG-11 security fixes (private bucket +
// signed URLs, no direct authenticated-role Storage writes), soft-delete
// visibility, and document_download_counts()'s aggregated-only, role-gated
// visibility. Authorization branch logic (owner/creator checks) already has
// full unit coverage against a mocked client — this file is deliberately not
// a re-test of that (same convention as gradebook-linking.e2e-spec.ts's own
// header comment).
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

describe('Documents in context (e2e)', () => {
  let app: INestApplication;
  let admin: SupabaseClient;

  const suffix = Date.now();
  const schoolAId = randomUUID();
  const schoolBId = randomUUID();
  const authUserIds: string[] = [];
  const documentIds: string[] = [];

  let classA1Id: string;
  let classA2Id: string;
  let subjectAId: string;
  let teacherARowId: string; // teachers.id
  let teacherAUserId: string; // users.id
  let teacherAToken: string;
  let teacherA2Token: string; // unrelated teacher, not assigned to classA1/subjectA
  let adminAToken: string;

  let studentA1Id: string; // in classA1
  let studentA1Token: string;
  let studentA2Id: string; // in classA2
  let studentA2Token: string;
  let parentA1Token: string; // guardian of studentA1

  let homeworkAId: string;
  let quizAId: string;
  let assignmentAId: string;

  // School B — minimal, cross-tenant checks only.
  let classBId: string;
  let adminBToken: string;
  let teacherBToken: string;

  async function seedUser(schoolId: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT', label: string) {
    const email = `${label}-${suffix}@test-docs.internal`;
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

  async function upload(token: string, fields: Record<string, string>) {
    let req = request(app.getHttpServer()).post('/documents').set('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    const res = await req.attach('file', Buffer.from('test document contents'), 'test.txt');
    if (res.body?.id) documentIds.push(res.body.id);
    return res;
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
      { id: schoolAId, name: `Docs Test School A ${suffix}`, slug: `docs-test-a-${suffix}`, updated_at: now },
      { id: schoolBId, name: `Docs Test School B ${suffix}`, slug: `docs-test-b-${suffix}`, updated_at: now },
    ]);

    classA1Id = randomUUID();
    classA2Id = randomUUID();
    await admin.from('classes').insert([
      { id: classA1Id, school_id: schoolAId, name: 'Docs Class A1', grade_level: 1, updated_at: now },
      { id: classA2Id, school_id: schoolAId, name: 'Docs Class A2', grade_level: 2, updated_at: now },
    ]);

    subjectAId = randomUUID();
    await admin.from('subjects').insert({ id: subjectAId, school_id: schoolAId, name: `Docs Subject ${suffix}`, code: 'DOCS', updated_at: now });

    const teacherA = await seedUser(schoolAId, 'TEACHER', 'docs-teacher-a');
    teacherAToken = teacherA.token;
    teacherAUserId = teacherA.userId;
    teacherARowId = randomUUID();
    await admin.from('teachers').insert({ id: teacherARowId, school_id: schoolAId, user_id: teacherAUserId, staff_no: `DOCT-${suffix}`, updated_at: now });
    await admin.from('subject_assignments').insert({ id: randomUUID(), class_id: classA1Id, subject_id: subjectAId, teacher_id: teacherARowId });

    const teacherA2 = await seedUser(schoolAId, 'TEACHER', 'docs-teacher-a2');
    teacherA2Token = teacherA2.token;
    const teacherA2RowId = randomUUID();
    await admin.from('teachers').insert({ id: teacherA2RowId, school_id: schoolAId, user_id: teacherA2.userId, staff_no: `DOCT2-${suffix}`, updated_at: now });

    const adminA = await seedUser(schoolAId, 'ADMIN', 'docs-admin-a');
    adminAToken = adminA.token;

    const studentA1 = await seedUser(schoolAId, 'STUDENT', 'docs-student-a1');
    studentA1Token = studentA1.token;
    studentA1Id = randomUUID();
    await admin.from('students').insert({ id: studentA1Id, school_id: schoolAId, user_id: studentA1.userId, current_class_id: classA1Id, admission_no: `DOCS1-${suffix}`, updated_at: now });

    const studentA2 = await seedUser(schoolAId, 'STUDENT', 'docs-student-a2');
    studentA2Token = studentA2.token;
    studentA2Id = randomUUID();
    await admin.from('students').insert({ id: studentA2Id, school_id: schoolAId, user_id: studentA2.userId, current_class_id: classA2Id, admission_no: `DOCS2-${suffix}`, updated_at: now });

    const parentA1 = await seedUser(schoolAId, 'PARENT', 'docs-parent-a1');
    parentA1Token = parentA1.token;
    await admin.from('guardians').insert({ id: randomUUID(), user_id: parentA1.userId, student_id: studentA1Id, relationship: 'PARENT' });

    homeworkAId = randomUUID();
    await admin.from('homework_assignments').insert({
      id: homeworkAId, school_id: schoolAId, class_id: classA1Id, subject_id: subjectAId, teacher_id: teacherARowId,
      title: 'Docs test homework', due_date: '2026-01-01', updated_at: now,
    });

    quizAId = randomUUID();
    await admin.from('quizzes').insert({
      id: quizAId, school_id: schoolAId, class_id: classA1Id, subject_id: subjectAId, created_by_id: teacherAUserId, title: 'Docs test quiz', is_published: true,
    });

    assignmentAId = randomUUID();
    await admin.from('assignments').insert({
      id: assignmentAId, school_id: schoolAId, class_id: classA1Id, subject_id: subjectAId, created_by_id: teacherAUserId,
      title: 'Docs test assignment', due_date: '2026-01-01',
    });

    // School B — minimal.
    classBId = randomUUID();
    await admin.from('classes').insert({ id: classBId, school_id: schoolBId, name: 'Docs Class B', grade_level: 1, updated_at: now });
    const adminB = await seedUser(schoolBId, 'ADMIN', 'docs-admin-b');
    adminBToken = adminB.token;
    const teacherB = await seedUser(schoolBId, 'TEACHER', 'docs-teacher-b');
    teacherBToken = teacherB.token;
    const teacherBRowId = randomUUID();
    await admin.from('teachers').insert({ id: teacherBRowId, school_id: schoolBId, user_id: teacherB.userId, staff_no: `DOCTB-${suffix}`, updated_at: now });
  });

  afterAll(async () => {
    await admin.from('document_downloads').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('documents').delete().in('id', documentIds.length ? documentIds : ['00000000-0000-0000-0000-000000000000']);
    await admin.from('audit_logs').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('homework_assignments').delete().eq('id', homeworkAId);
    await admin.from('quizzes').delete().eq('id', quizAId);
    await admin.from('assignments').delete().eq('id', assignmentAId);
    await admin.from('subject_assignments').delete().in('class_id', [classA1Id, classA2Id]);
    await admin.from('guardians').delete().eq('student_id', studentA1Id);
    await admin.from('students').delete().in('id', [studentA1Id, studentA2Id]);
    await admin.from('teachers').delete().in('school_id', [schoolAId, schoolBId]);
    await admin.from('subjects').delete().eq('id', subjectAId);
    await admin.from('classes').delete().in('id', [classA1Id, classA2Id, classBId]);
    await admin.from('users').delete().in('auth_id', authUserIds);
    await admin.from('schools').delete().in('id', [schoolAId, schoolBId]);
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    if (app) await app.close();
  });

  describe('SCHOOL_WIDE', () => {
    it('an admin can publish school-wide; every role at the school can then download it', async () => {
      const res = await upload(adminAToken, { title: 'Handbook', scopeType: 'SCHOOL_WIDE' });
      expect(res.status).toBe(201);
      const docId = res.body.id as string;

      for (const token of [teacherAToken, studentA1Token, studentA2Token, parentA1Token]) {
        const dl = await request(app.getHttpServer())
          .get(`/documents/${docId}/download-url`)
          .set('Authorization', `Bearer ${token}`);
        expect(dl.status).toBe(200);
        expect(dl.body.url).toBeTruthy();
      }
    });

    it('rejects a TEACHER trying to publish school-wide (403)', async () => {
      const res = await upload(teacherAToken, { title: 'Should fail', scopeType: 'SCHOOL_WIDE' });
      expect(res.status).toBe(403);
    });
  });

  describe('CLASS', () => {
    it('a class-scoped document is visible to that class\'s own students and their parents, not to a different class', async () => {
      const res = await upload(teacherAToken, { title: 'Class A1 handout', scopeType: 'CLASS', scopeId: classA1Id });
      expect(res.status).toBe(201);
      const docId = res.body.id as string;

      const own = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA1Token}`);
      expect(own.status).toBe(200);

      const parent = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${parentA1Token}`);
      expect(parent.status).toBe(200);

      const other = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA2Token}`);
      expect(other.status).toBe(404);
    });

    it('rejects a teacher with no subject_assignments row for that class and who isn\'t its class teacher', async () => {
      const res = await upload(teacherA2Token, { title: 'Should fail', scopeType: 'CLASS', scopeId: classA1Id });
      expect(res.status).toBe(403);
    });
  });

  describe('SUBJECT', () => {
    it('a subject-scoped document is visible to students in a class teaching it and to teachers assigned to it', async () => {
      const res = await upload(teacherAToken, { title: 'Subject notes', scopeType: 'SUBJECT', scopeId: subjectAId });
      expect(res.status).toBe(201);
      const docId = res.body.id as string;

      // studentA1 is in classA1, which teaches subjectA (via subject_assignments).
      const student = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA1Token}`);
      expect(student.status).toBe(200);

      // studentA2 is in classA2, which does not teach subjectA.
      const otherStudent = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA2Token}`);
      expect(otherStudent.status).toBe(404);

      // teacherA2 is not assigned to subjectA anywhere.
      const otherTeacher = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${teacherA2Token}`);
      expect(otherTeacher.status).toBe(404);
    });
  });

  describe('ASSIGNMENT', () => {
    it.each([
      ['HOMEWORK', () => homeworkAId],
      ['QUIZ', () => quizAId],
      ['ONLINE_ASSIGNMENT', () => assignmentAId],
    ])('%s: visible to students in the underlying entity\'s class, not a different class', async (subtype, getId) => {
      const res = await upload(teacherAToken, { title: `${subtype} attachment`, scopeType: 'ASSIGNMENT', scopeSubtype: subtype, scopeId: getId() });
      expect(res.status).toBe(201);
      const docId = res.body.id as string;

      const own = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA1Token}`);
      expect(own.status).toBe(200);

      const other = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA2Token}`);
      expect(other.status).toBe(404);
    });

    it('rejects a teacher who is not the homework\'s creator (teachers.id-joined ownership)', async () => {
      const res = await upload(teacherA2Token, { title: 'Should fail', scopeType: 'ASSIGNMENT', scopeSubtype: 'HOMEWORK', scopeId: homeworkAId });
      expect(res.status).toBe(403);
    });
  });

  describe('Retagging changes visibility', () => {
    it('SCHOOL_WIDE retagged to CLASS(A2) becomes visible to A2, no longer to A1', async () => {
      const created = await upload(adminAToken, { title: 'Retag test', scopeType: 'SCHOOL_WIDE' });
      const docId = created.body.id as string;

      // Visible to both before retag (school-wide).
      const beforeA1 = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA1Token}`);
      expect(beforeA1.status).toBe(200);

      const retag = await request(app.getHttpServer())
        .patch(`/documents/${docId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ scopeType: 'CLASS', scopeId: classA2Id });
      expect(retag.status).toBe(200);

      const afterA1 = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA1Token}`);
      expect(afterA1.status).toBe(404);

      const afterA2 = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA2Token}`);
      expect(afterA2.status).toBe(200);
    });
  });

  describe('Soft delete', () => {
    it('a deleted document disappears from list() for other users but stays reachable to the owner/admin directly', async () => {
      const created = await upload(teacherAToken, { title: 'To be deleted', scopeType: 'CLASS', scopeId: classA1Id });
      const docId = created.body.id as string;

      const del = await request(app.getHttpServer()).delete(`/documents/${docId}`).set('Authorization', `Bearer ${teacherAToken}`);
      expect(del.status).toBe(200);

      const listAsStudent = await request(app.getHttpServer())
        .get(`/documents?scopeType=CLASS&scopeId=${classA1Id}`)
        .set('Authorization', `Bearer ${studentA1Token}`);
      expect((listAsStudent.body.rows as { id: string }[]).some((r) => r.id === docId)).toBe(false);

      // Owner can still see their own soft-deleted row directly via RLS (the
      // docs_select carve-out) — proves the soft-delete visibility fix was
      // applied from the start, not discovered the hard way like departments'.
      const { data: ownRow } = await clientAs(teacherAToken).from('documents').select('id, deleted_at').eq('id', docId).maybeSingle();
      expect(ownRow?.deleted_at).toBeTruthy();
    });
  });

  describe('Storage bypass (BUG-11 regression)', () => {
    it('a raw authenticated client cannot write directly to the documents Storage bucket', async () => {
      const { error } = await clientAs(teacherAToken).storage
        .from('documents')
        .upload(`${schoolAId}/bypass-attempt-${randomUUID()}.txt`, Buffer.from('should not be allowed'), { contentType: 'text/plain' });
      expect(error).not.toBeNull();
    });
  });

  describe('Cross-tenant isolation', () => {
    it('a School B admin can never see a School A document via list() or a crafted download-url request', async () => {
      const created = await upload(adminAToken, { title: 'School A only', scopeType: 'SCHOOL_WIDE' });
      const docId = created.body.id as string;

      const list = await request(app.getHttpServer()).get('/documents').set('Authorization', `Bearer ${adminBToken}`);
      expect((list.body.rows as { id: string }[]).some((r) => r.id === docId)).toBe(false);

      const dl = await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${adminBToken}`);
      expect(dl.status).toBe(404);
    });

    it('a School B teacher cannot upload a document scoped to a School A class (RLS hides the class row entirely)', async () => {
      const res = await upload(teacherBToken, { title: 'Should fail', scopeType: 'CLASS', scopeId: classA1Id });
      expect(res.status).toBe(400);
    });
  });

  describe('document_download_counts() — aggregated-only, role-gated', () => {
    it('counts downloads for the caller\'s school, visible to TEACHER/ADMIN, empty for STUDENT', async () => {
      const created = await upload(adminAToken, { title: 'Download count test', scopeType: 'SCHOOL_WIDE' });
      const docId = created.body.id as string;

      await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA1Token}`);
      await request(app.getHttpServer()).get(`/documents/${docId}/download-url`).set('Authorization', `Bearer ${studentA2Token}`);

      const { data: asTeacher } = await clientAs(teacherAToken).rpc('document_download_counts', { p_document_ids: [docId] });
      expect(asTeacher).toEqual([{ document_id: docId, download_count: 2, unique_user_count: 2 }]);

      const { data: asStudent } = await clientAs(studentA1Token).rpc('document_download_counts', { p_document_ids: [docId] });
      expect(asStudent ?? []).toEqual([]); // role-gated inside the function's own WHERE clause — no error, just no rows

      // Cross-school caller gets nothing back for a School A document id either.
      const { data: asOtherSchool } = await clientAs(adminBToken).rpc('document_download_counts', { p_document_ids: [docId] });
      expect(asOtherSchool ?? []).toEqual([]);
    });
  });
});
