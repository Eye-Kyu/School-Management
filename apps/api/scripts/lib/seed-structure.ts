// =============================================================================
// School structure: school, term, classes, subjects, subject_assignments,
// departments, class-teacher and department-head assignment.
// =============================================================================

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SuperAdminService } from '../../src/super-admin/super-admin.service';
import { SupabaseService } from '../../src/supabase/supabase.service';
import type { SeedLogger } from './seed-logger';
import type { SeededClass, SeededSubject, SeededSubjectAssignment, SeededDepartment, SeededTeacher, SeededTerm, SeededSchool } from './types';

// -----------------------------------------------------------------------------
// School
// -----------------------------------------------------------------------------

/**
 * Uses SuperAdminService.createSchool() directly rather than a raw insert +
 * manually-duplicated prefect_powers seed. Confirmed safe to instantiate
 * standalone: its only dependency, SupabaseService, takes zero constructor
 * args (reads SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY
 * straight from process.env) — no NestJS app bootstrap needed. Seeds
 * `schools` + the 8 default `prefect_powers` rows + one `audit_logs` row in
 * one call. `school_modules` needs no seeding at all: module_enabled()
 * COALESCEs a missing row to `true` (supabase/migrations/
 * 20260721000023_module_registry.sql:41-47) — a brand-new school already
 * has every module (quizzes, document_library, ...) reading as enabled.
 */
export async function seedSchool(logger: SeedLogger, schoolName: string): Promise<{ school: SeededSchool; admin: SupabaseClient }> {
  const supabaseService = new SupabaseService();
  const superAdmin = new SuperAdminService(supabaseService);

  const slug = schoolName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50)
    .replace(/^-+|-+$/g, '');

  const school = await superAdmin.createSchool(
    { name: schoolName, slug, timezone: 'Africa/Nairobi' },
    randomUUID(), // placeholder caller auth id — resolveCaller() gracefully returns null if unmatched, audit_logs.user_id becomes null
  );

  logger.insert('schools', 1, school.id);
  logger.insert('prefect_powers', 8, school.id);

  return { school: { id: school.id, name: school.name, slug: school.slug }, admin: supabaseService.admin };
}

// -----------------------------------------------------------------------------
// Term — one current term. "Clear then set" replicated even with a single
// term (defensive — terms.is_current has no DB-level single-current
// constraint, only the app's own two-statement sequence enforces it).
// -----------------------------------------------------------------------------

export async function seedTerm(admin: SupabaseClient, logger: SeedLogger, schoolId: string): Promise<SeededTerm> {
  await admin.from('terms').update({ is_current: false }).eq('school_id', schoolId).eq('is_current', true);

  const id = randomUUID();
  const startDate = '2026-05-04';
  const endDate = '2026-07-24';
  const { error } = await admin.from('terms').insert({
    id, school_id: schoolId, name: 'Term 2, 2026', start_date: startDate, end_date: endDate, is_current: true,
  });
  if (error) throw new Error(`Insert term failed: ${error.message}`);

  logger.insert('terms', 1, schoolId);
  return { id, name: 'Term 2, 2026', startDate, endDate };
}

// -----------------------------------------------------------------------------
// Classes — 8 grades x 2 streams = 16
// -----------------------------------------------------------------------------

export async function seedClasses(admin: SupabaseClient, logger: SeedLogger, schoolId: string): Promise<SeededClass[]> {
  const classes: SeededClass[] = [];
  for (let grade = 1; grade <= 8; grade++) {
    for (const stream of ['A', 'B'] as const) {
      classes.push({ id: randomUUID(), name: `Grade ${grade}${stream}`, gradeLevel: grade, stream });
    }
  }
  const { error } = await admin.from('classes').insert(
    classes.map((c) => ({ id: c.id, school_id: schoolId, name: c.name, grade_level: c.gradeLevel, stream: c.stream, updated_at: new Date().toISOString() })),
  );
  if (error) throw new Error(`Insert classes failed: ${error.message}`);
  logger.insert('classes', classes.length, schoolId);
  return classes;
}

// -----------------------------------------------------------------------------
// Subjects — 12, per the audit's CBC-shaped lower/mid/upper-primary split
// -----------------------------------------------------------------------------

export const SUBJECT_DEFS = [
  { name: 'Mathematics', code: 'MATH', tier: 'ALL' },
  { name: 'English', code: 'ENG', tier: 'ALL' },
  { name: 'Kiswahili', code: 'KISW', tier: 'ALL' },
  { name: 'Environmental Activities', code: 'ENVACT', tier: 'LOWER' }, // G1-3 only
  { name: 'Science and Technology', code: 'SCITECH', tier: 'MID_UPPER' }, // G4-8
  { name: 'Social Studies', code: 'SOCST', tier: 'MID_UPPER' },
  { name: 'Christian Religious Education', code: 'CRE', tier: 'ALL' },
  { name: 'Agriculture', code: 'AGRI', tier: 'MID_UPPER' },
  { name: 'Creative Arts', code: 'CARTS', tier: 'ALL' },
  { name: 'Physical and Health Education', code: 'PE', tier: 'ALL' },
  { name: 'Life Skills Education', code: 'LIFESK', tier: 'MID_UPPER' },
  { name: 'Home Science', code: 'HOMESC', tier: 'UPPER' }, // G6-8 only
] as const;

export type SubjectTier = typeof SUBJECT_DEFS[number]['tier'];

function subjectAppliesToGrade(tier: SubjectTier, gradeLevel: number): boolean {
  if (tier === 'ALL') return true;
  if (tier === 'LOWER') return gradeLevel <= 3;
  if (tier === 'MID_UPPER') return gradeLevel >= 4;
  if (tier === 'UPPER') return gradeLevel >= 6;
  return false;
}

export async function seedSubjects(admin: SupabaseClient, logger: SeedLogger, schoolId: string): Promise<SeededSubject[]> {
  const subjects: SeededSubject[] = SUBJECT_DEFS.map((s) => ({ id: randomUUID(), name: s.name, code: s.code }));
  const { error } = await admin.from('subjects').insert(
    subjects.map((s) => ({ id: s.id, school_id: schoolId, name: s.name, code: s.code, updated_at: new Date().toISOString() })),
  );
  if (error) throw new Error(`Insert subjects failed: ${error.message}`);
  logger.insert('subjects', subjects.length, schoolId);
  return subjects;
}

// -----------------------------------------------------------------------------
// Departments — teacher-only grouping (no relationship to subjects at all,
// confirmed in the audit's §1.10). department_head_user_id set later, once
// teachers exist.
// -----------------------------------------------------------------------------

export const DEPARTMENT_NAMES = [
  'Languages',
  'Mathematics & Sciences',
  'Humanities & Religious Education',
  'Creative & Technical',
] as const;

export async function seedDepartments(admin: SupabaseClient, logger: SeedLogger, schoolId: string): Promise<SeededDepartment[]> {
  const departments: SeededDepartment[] = DEPARTMENT_NAMES.map((name) => ({ id: randomUUID(), name }));
  const { error } = await admin.from('departments').insert(
    departments.map((d) => ({ id: d.id, school_id: schoolId, name: d.name })),
  );
  if (error) throw new Error(`Insert departments failed: ${error.message}`);
  logger.insert('departments', departments.length, schoolId);
  return departments;
}

// -----------------------------------------------------------------------------
// Subject assignments — 148 rows: 6 "specialist" subjects (PE, Creative
// Arts, CRE, Agriculture, Life Skills, Home Science) each taught
// school-wide-for-their-tier by one dedicated specialist teacher; 6 "core"
// subjects (Math, English, Kiswahili, Environmental Activities, Science &
// Technology, Social Studies) round-robined across the 16 class teachers —
// deterministically producing several "class teacher also teaches a
// different class" cases (the demo pattern), not hand-picked.
// -----------------------------------------------------------------------------

const SPECIALIST_SUBJECT_CODES = ['PE', 'CARTS', 'CRE', 'AGRI', 'LIFESK', 'HOMESC'];
const CORE_SUBJECT_CODES = ['MATH', 'ENG', 'KISW', 'ENVACT', 'SCITECH', 'SOCST'];

export async function seedSubjectAssignments(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string,
  classes: SeededClass[],
  subjects: SeededSubject[],
  classTeachers: SeededTeacher[], // exactly 16, index i -> classes[i]
  specialistTeachers: SeededTeacher[], // exactly 6, index matches SPECIALIST_SUBJECT_CODES
): Promise<SeededSubjectAssignment[]> {
  const subjectByCode = new Map(subjects.map((s) => [s.code, s]));
  const tierByCode = new Map<string, SubjectTier>(SUBJECT_DEFS.map((s) => [s.code, s.tier]));
  const assignments: SeededSubjectAssignment[] = [];

  classes.forEach((cls, classIndex) => {
    for (const code of CORE_SUBJECT_CODES) {
      const tier = tierByCode.get(code)!;
      if (!subjectAppliesToGrade(tier, cls.gradeLevel)) continue;
      const subject = subjectByCode.get(code)!;
      const subjectIndex = CORE_SUBJECT_CODES.indexOf(code);
      const teacher = classTeachers[(classIndex + subjectIndex) % classTeachers.length]!;
      assignments.push({ id: randomUUID(), classId: cls.id, subjectId: subject.id, teacherId: teacher.teacherId });
    }
    SPECIALIST_SUBJECT_CODES.forEach((code, specialistIndex) => {
      const tier = tierByCode.get(code)!;
      if (!subjectAppliesToGrade(tier, cls.gradeLevel)) return;
      const subject = subjectByCode.get(code)!;
      const teacher = specialistTeachers[specialistIndex]!;
      assignments.push({ id: randomUUID(), classId: cls.id, subjectId: subject.id, teacherId: teacher.teacherId });
    });
  });

  const { error } = await admin.from('subject_assignments').insert(
    assignments.map((a) => ({ id: a.id, class_id: a.classId, subject_id: a.subjectId, teacher_id: a.teacherId })),
  );
  if (error) throw new Error(`Insert subject_assignments failed: ${error.message}`);
  logger.insert('subject_assignments', assignments.length, schoolId);
  if (assignments.length !== 148) {
    logger.warn(`subject_assignments generated ${assignments.length} rows, audit expected 148 — check SUBJECT_DEFS tiers if this drifts significantly`);
  }
  return assignments;
}

// -----------------------------------------------------------------------------
// Class-teacher and department-head assignment — plain UPDATEs, not inserts
// into a junction table (no such table exists — teachers.is_class_teacher_of
// and departments.department_head_user_id are both single nullable columns).
// -----------------------------------------------------------------------------

export async function assignClassTeachers(admin: SupabaseClient, logger: SeedLogger, schoolId: string, classes: SeededClass[], classTeachers: SeededTeacher[]): Promise<void> {
  for (let i = 0; i < classes.length; i++) {
    const { error } = await admin.from('teachers').update({ is_class_teacher_of: classes[i]!.id }).eq('id', classTeachers[i]!.teacherId);
    if (error) throw new Error(`Assign class teacher failed: ${error.message}`);
    classTeachers[i]!.isClassTeacherOf = classes[i]!.id;
  }
  logger.info(`UPDATE teachers.is_class_teacher_of -> ${classes.length} rows (school_id: ${schoolId})`);
}

export async function assignDepartmentHeads(admin: SupabaseClient, logger: SeedLogger, schoolId: string, departments: SeededDepartment[], headTeachers: SeededTeacher[]): Promise<void> {
  for (let i = 0; i < departments.length; i++) {
    const { error } = await admin.from('departments').update({ department_head_user_id: headTeachers[i]!.userId }).eq('id', departments[i]!.id);
    if (error) throw new Error(`Assign department head failed: ${error.message}`);
  }
  logger.info(`UPDATE departments.department_head_user_id -> ${departments.length} rows (school_id: ${schoolId})`);
}
