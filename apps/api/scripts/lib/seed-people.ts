// =============================================================================
// People: auth users (batched, rate-limited) + teachers/students/guardians.
// =============================================================================
// Auth creation is batched GLOBALLY across every role (admin+teachers+
// students+parents together, ~723 total), not per-role — 60 concurrent
// createUser calls per batch, then a 60-second wait before the next batch.
// This exact cadence is this implementation task's own explicit instruction,
// not a documented Supabase rate limit the Phase 1 audit itself established
// (the audit only found "no publicly documented hard limit... confirm
// empirically") — kept as a conservative default, easy to tune down later
// if real runs show it's overly cautious.
// =============================================================================

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeedLogger } from './seed-logger';
import type { StateFile } from './state-file';
import type { SeededClass, SeededTeacher, SeededStudent, SeededParent, SeededGuardianLink } from './types';
import { TEST_PASSWORD, testEmail, randomPhone, randomFullName, type Rng, type Gender } from './kenyan-names';

const AUTH_BATCH_SIZE = 60;
const AUTH_BATCH_WAIT_MS = 60_000;

interface PlannedPerson {
  planIndex: number;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  email: string;
  fullName: string;
  phone: string;
}

interface CreatedAuth {
  authId: string;
  userId: string;
}

/**
 * Creates every auth.users + public.users row for the whole run in one
 * globally rate-limited pass. Returns a map from planIndex -> {authId,
 * userId}. Every created auth id is appended to the state file immediately
 * (Refinement 1), before the batch's users-table upsert even runs — a crash
 * during the upsert still leaves a recoverable trail.
 */
async function createAuthUsersBatched(
  admin: SupabaseClient,
  logger: SeedLogger,
  stateFile: StateFile,
  schoolId: string,
  people: PlannedPerson[],
): Promise<Map<number, CreatedAuth>> {
  const result = new Map<number, CreatedAuth>();
  const batches: PlannedPerson[][] = [];
  for (let i = 0; i < people.length; i += AUTH_BATCH_SIZE) batches.push(people.slice(i, i + AUTH_BATCH_SIZE));

  let created = 0;
  for (const batch of batches) {
    await Promise.all(
      batch.map(async (person) => {
        const { data: authData, error: authErr } = await admin.auth.admin.createUser({
          email: person.email,
          password: TEST_PASSWORD,
          email_confirm: true,
          user_metadata: { school_id: schoolId, role: person.role },
        });
        if (authErr || !authData.user) throw new Error(`createUser failed for ${person.email}: ${authErr?.message}`);
        stateFile.appendAuthUserId(authData.user.id);

        const userId = randomUUID();
        const { error: userErr } = await admin.from('users').upsert(
          {
            id: userId,
            school_id: schoolId,
            auth_id: authData.user.id,
            email: person.email,
            phone: person.phone,
            full_name: person.fullName,
            role: person.role,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'auth_id' },
        );
        if (userErr) throw new Error(`users upsert failed for ${person.email}: ${userErr.message}`);

        result.set(person.planIndex, { authId: authData.user.id, userId });
      }),
    );
    created += batch.length;
    logger.authProgress(created, people.length);
    if (created < people.length) await new Promise((r) => setTimeout(r, AUTH_BATCH_WAIT_MS));
  }
  logger.insert('users', people.length, schoolId);
  return result;
}

// -----------------------------------------------------------------------------
// Planning (pure, in-memory — no DB calls) — builds every person's identity
// and the flat batching plan, before any auth user is created.
// -----------------------------------------------------------------------------

export interface PeoplePlan {
  adminPlan: PlannedPerson;
  teacherPlans: PlannedPerson[];
  teacherGenders: Gender[];
  studentPlans: PlannedPerson[];
  studentMeta: Array<{ classIndex: number; rosterIndex: number; gender: Gender; admissionNo: string }>;
  parentPlans: PlannedPerson[];
  // studentIndex -> list of parent plan-indices (1 or 2 guardians)
  guardianAssignments: Map<number, number[]>;
  flat: PlannedPerson[];
}

export function planPeople(rng: Rng, classes: SeededClass[]): PeoplePlan {
  let phoneCounter = 0;
  const nextPhone = () => randomPhone(phoneCounter++ % 1000);

  let planIndex = 0;
  const flat: PlannedPerson[] = [];
  const push = (p: Omit<PlannedPerson, 'planIndex'>): PlannedPerson => {
    const full: PlannedPerson = { ...p, planIndex: planIndex++ };
    flat.push(full);
    return full;
  };

  // Admin
  const { fullName: adminName } = randomFullName(rng() < 0.5 ? 'MALE' : 'FEMALE', rng);
  const adminPlan = push({ role: 'ADMIN', email: testEmail('admin', 0), fullName: `${adminName} (Headteacher)`, phone: nextPhone() });

  // Teachers — 22 total: first 16 become class teachers, next 6 specialists (caller decides which is which by array order)
  const teacherPlans: PlannedPerson[] = [];
  const teacherGenders: Gender[] = [];
  for (let i = 0; i < 22; i++) {
    const gender: Gender = i % 2 === 0 ? 'FEMALE' : 'MALE';
    const { fullName } = randomFullName(gender, rng);
    teacherPlans.push(push({ role: 'TEACHER', email: testEmail('teacher', i), fullName, phone: nextPhone() }));
    teacherGenders.push(gender);
  }

  // Students — 300 across 16 classes. Last 4 classes (index 12-15, Grade 7A/7B/8A/8B) get 18; the rest get 19.
  const studentPlans: PlannedPerson[] = [];
  const studentMeta: PeoplePlan['studentMeta'] = [];
  classes.forEach((cls, classIndex) => {
    const rosterSize = classIndex >= 12 ? 18 : 19;
    for (let rosterIndex = 0; rosterIndex < rosterSize; rosterIndex++) {
      const gender: Gender = rng() < 0.5 ? 'MALE' : 'FEMALE';
      const { fullName } = randomFullName(gender, rng);
      const admissionNo = `GRADE${cls.gradeLevel}${cls.stream}${String(rosterIndex + 1).padStart(3, '0')}`;
      const globalIndex = studentPlans.length;
      studentPlans.push(push({ role: 'STUDENT', email: testEmail('student', globalIndex), fullName, phone: nextPhone() }));
      studentMeta.push({ classIndex, rosterIndex, gender, admissionNo });
    }
  });

  // Guardians — 300 students: first 180 (60%) get 1 guardian, remaining 120
  // (40%) get 2. 20 sibling pairs (student i <-> student i+200) share their
  // one/first guardian, bringing 420 total guardian-slots down to exactly
  // 400 unique parent identities (20 shared + 380 fresh).
  const parentPlans: PlannedPerson[] = [];
  const guardianAssignments = new Map<number, number[]>(); // studentIndex -> parent planIndex[]
  const sharedParentPlanIndexFor = new Map<number, number>(); // studentIndex -> shared parent planIndex

  function makeParent(): PlannedPerson {
    const gender: Gender = rng() < 0.5 ? 'MALE' : 'FEMALE';
    const { fullName } = randomFullName(gender, rng);
    const idx = parentPlans.length;
    const plan = push({ role: 'PARENT', email: testEmail('parent', idx), fullName, phone: nextPhone() });
    parentPlans.push(plan);
    return plan;
  }

  for (let i = 0; i < 20; i++) {
    const shared = makeParent();
    sharedParentPlanIndexFor.set(i, shared.planIndex);
    sharedParentPlanIndexFor.set(i + 200, shared.planIndex);
  }

  for (let i = 0; i < studentPlans.length; i++) {
    const guardianCount = i < 180 ? 1 : 2;
    const parentIndices: number[] = [];
    for (let slot = 1; slot <= guardianCount; slot++) {
      if (slot === 1 && sharedParentPlanIndexFor.has(i)) {
        parentIndices.push(sharedParentPlanIndexFor.get(i)!);
      } else {
        parentIndices.push(makeParent().planIndex);
      }
    }
    guardianAssignments.set(i, parentIndices);
  }

  return { adminPlan, teacherPlans, teacherGenders, studentPlans, studentMeta, parentPlans, guardianAssignments, flat };
}

// -----------------------------------------------------------------------------
// Execution — runs the batched auth creation, then writes teachers/students/
// guardians rows referencing the freshly-created users.
// -----------------------------------------------------------------------------

export interface SeededPeople {
  adminUserId: string;
  classTeachers: SeededTeacher[]; // first 16
  specialistTeachers: SeededTeacher[]; // last 6
  students: SeededStudent[];
  parents: SeededParent[];
  guardianLinks: SeededGuardianLink[];
}

export async function seedPeople(
  admin: SupabaseClient,
  logger: SeedLogger,
  stateFile: StateFile,
  schoolId: string,
  classes: SeededClass[],
  plan: PeoplePlan,
): Promise<SeededPeople> {
  const created = await createAuthUsersBatched(admin, logger, stateFile, schoolId, plan.flat);

  const adminAuth = created.get(plan.adminPlan.planIndex)!;

  // Teachers
  const allTeachers: SeededTeacher[] = [];
  const teacherRows = plan.teacherPlans.map((p, i) => {
    const auth = created.get(p.planIndex)!;
    const teacherId = randomUUID();
    allTeachers.push({ teacherId, userId: auth.userId, authId: auth.authId, fullName: p.fullName, email: p.email, isClassTeacherOf: null });
    return { id: teacherId, school_id: schoolId, user_id: auth.userId, staff_no: `STAFF${String(i + 1).padStart(3, '0')}`, updated_at: new Date().toISOString() };
  });
  const { error: teacherErr } = await admin.from('teachers').insert(teacherRows);
  if (teacherErr) throw new Error(`Insert teachers failed: ${teacherErr.message}`);
  logger.insert('teachers', teacherRows.length, schoolId);

  const classTeachers = allTeachers.slice(0, 16);
  const specialistTeachers = allTeachers.slice(16, 22);

  // Students
  const students: SeededStudent[] = [];
  const studentRows = plan.studentPlans.map((p, i) => {
    const auth = created.get(p.planIndex)!;
    const meta = plan.studentMeta[i]!;
    const cls = classes[meta.classIndex]!;
    const studentId = randomUUID();
    students.push({
      studentId, userId: auth.userId, authId: auth.authId, fullName: p.fullName, gender: meta.gender,
      admissionNo: meta.admissionNo, classId: cls.id, className: cls.name, gradeLevel: cls.gradeLevel, stream: cls.stream,
      rosterIndex: meta.rosterIndex,
    });
    return {
      id: studentId, school_id: schoolId, user_id: auth.userId, admission_no: meta.admissionNo,
      current_class_id: cls.id, gender: meta.gender === 'MALE' ? 'Male' : 'Female',
      enrollment_date: '2026-01-12', county: 'Nairobi', nationality: 'Kenyan', updated_at: new Date().toISOString(),
    };
  });
  const { error: studentErr } = await admin.from('students').insert(studentRows);
  if (studentErr) throw new Error(`Insert students failed: ${studentErr.message}`);
  logger.insert('students', studentRows.length, schoolId);

  // Parents (as SeededParent aggregates — one per unique parent plan entry)
  const parents: SeededParent[] = plan.parentPlans.map((p) => {
    const auth = created.get(p.planIndex)!;
    return { userId: auth.userId, authId: auth.authId, fullName: p.fullName, email: p.email, studentIds: [] };
  });
  const parentByPlanIndex = new Map(plan.parentPlans.map((p, i) => [p.planIndex, parents[i]!]));

  // Guardian links
  const guardianLinks: SeededGuardianLink[] = [];
  const guardianRows: Array<{ id: string; user_id: string; student_id: string; relationship: string; is_primary: boolean }> = [];
  for (let i = 0; i < students.length; i++) {
    const student = students[i]!;
    const parentPlanIndices = plan.guardianAssignments.get(i) ?? [];
    parentPlanIndices.forEach((parentPlanIndex, slot) => {
      const parent = parentByPlanIndex.get(parentPlanIndex)!;
      parent.studentIds.push(student.studentId);
      const id = randomUUID();
      guardianLinks.push({ id, userId: parent.userId, studentId: student.studentId });
      guardianRows.push({
        id, user_id: parent.userId, student_id: student.studentId,
        relationship: slot === 0 ? 'Mother' : 'Father', is_primary: slot === 0,
      });
    });
  }
  const { error: guardianErr } = await admin.from('guardians').insert(guardianRows);
  if (guardianErr) throw new Error(`Insert guardians failed: ${guardianErr.message}`);
  logger.insert('guardians', guardianRows.length, schoolId);

  return { adminUserId: adminAuth.userId, classTeachers, specialistTeachers, students, parents, guardianLinks };
}
