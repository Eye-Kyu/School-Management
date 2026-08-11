#!/usr/bin/env tsx
// =============================================================================
// Seeds a realistic ~300-student Kenyan primary school (CBC curriculum) into
// the SAME Supabase project used by production/e2e tests, under a school
// whose name is always prefixed "TEST — " so it can never be mistaken for a
// real school in any listing, export, or screenshot.
//
// Usage:
//   pnpm --filter @school-manager/api seed:sample-school -- \
//     --school-name-default --confirm
//
//   pnpm --filter @school-manager/api seed:sample-school -- \
//     --school-name "TEST — Custom Name Primary School" --confirm
//
// Flags:
//   --school-name <name>     Required unless --school-name-default is given.
//                             Must start with "TEST — " (enforced).
//   --school-name-default    Shortcut for "TEST — Kilimani Primary School".
//   --confirm                Required — the script refuses to run without it.
//   --confirm-production     Required in addition to --confirm if NODE_ENV=production.
//
// Safety:
//   - Every notifications row is inserted with sms_status: 'ABANDONED' — see
//     lib/seed-content.ts and lib/kenyan-names.ts for why this structurally
//     guarantees no SMS is ever dispatched for seeded data, regardless of
//     phone number or Africa's Talking configuration.
//   - A checkpoint state file recording every created auth-user id is written
//     to the OS temp dir throughout the run (lib/state-file.ts) — on failure,
//     recover with: pnpm teardown:sample-school -- --state-file <path> --confirm
//   - The state file is NEVER auto-deleted on success — it remains as an
//     audit trail; use it or --school-name with teardown-sample-school.ts.
//
// Measured runtime: ~14-15 minutes (four live runs, all consistent) —
// dominated by the 60-user/60-second auth rate-limit batching for ~723 auth
// users (~12 min alone); every other insert across ~40,000 rows completes
// in under a minute. Far below the Phase 1 audit's original ~90-minute
// estimate, which assumed a more conservative batch cadence.
// =============================================================================

// Standalone tsx execution bypasses NestJS's ConfigModule bootstrap, so env
// vars aren't loaded automatically the way they are for the app itself —
// load apps/api/.env explicitly, before anything below can read
// process.env.SUPABASE_URL etc. (SupabaseService is constructed later in
// main(), but resolving the path via __dirname rather than a bare
// dotenv.config() keeps this correct regardless of the invoking shell's cwd).
import dotenv from 'dotenv';
import { join } from 'path';
dotenv.config({ path: join(__dirname, '..', '.env') });

import { parseArgs, requireFlag } from './lib/cli';
import { SeedLogger } from './lib/seed-logger';
import { StateFile } from './lib/state-file';
import { createSeededRng, DEFAULT_SCHOOL_NAME } from './lib/kenyan-names';
import { seedSchool, seedTerm, seedClasses, seedSubjects, seedDepartments, seedSubjectAssignments, assignClassTeachers, assignDepartmentHeads } from './lib/seed-structure';
import { planPeople, seedPeople } from './lib/seed-people';
import { resolveDemoPatterns, resolveSiblingDemoCase, type DemoPatterns } from './lib/demo-patterns';
import { seedAttendanceAndAbsences, seedAssessmentsAndGrades, seedHomework, seedQuizzes } from './lib/seed-academic';
import { seedClassPrefects, seedBehaviourPoints, seedBehaviorIncidentReports } from './lib/seed-behavior';
import { seedFees } from './lib/seed-fees';
import { seedDocuments, seedMessaging, seedNotifications } from './lib/seed-content';
import type { SeededStudent } from './lib/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Expected row-count ranges per tenant-scoped table, from the Phase 1 audit's
// §5 ("Activity data volume") — checked post-run and logged as warnings
// (never a hard failure) since real RNG-driven variance can legitimately
// land just outside a hand-estimated range.
const EXPECTED_ROW_RANGES: Array<[table: string, min: number, max: number]> = [
  ['schools', 1, 1],
  ['terms', 1, 1],
  ['classes', 16, 16],
  ['subjects', 12, 12],
  ['departments', 4, 4],
  // 'subject_assignments' deliberately omitted here: the table has no
  // school_id column (only class_id/subject_id/teacher_id — confirmed in
  // supabase/migrations/20260522000001_init.sql), so it can't be counted via
  // the same .eq('school_id', ...) pattern as every other table below.
  // seedSubjectAssignments() itself already warns inline if its own count
  // drifts from the expected 148.
  ['teachers', 22, 22],
  ['students', 300, 300],
  // 'guardians' deliberately omitted: the table has no school_id column
  // (confirmed in supabase/migrations/20260522000001_init.sql) — only
  // user_id/student_id — so it can't be counted via the same
  // .eq('school_id', ...) pattern as every other table here.
  ['attendance_records', 16000, 19000],
  ['absence_requests', 40, 90],
  ['assessments', 850, 950],
  ['grades', 13000, 16500],
  ['homework_assignments', 240, 260],
  ['homework_completions', 3000, 4500],
  ['quizzes', 18, 22],
  ['quiz_questions', 100, 180],
  ['quiz_attempts', 250, 400],
  ['prefect_powers', 8, 8],
  ['class_prefects', 3, 6],
  ['behaviour_points', 480, 520],
  ['behavior_incident_reports', 40, 60],
  ['fee_balances', 300, 300],
  ['documents', 30, 30],
  ['conversations', 10, 20],
  ['messages', 60, 120],
  ['notifications', 25, 55],
];

async function verifyRowCounts(admin: SupabaseClient, logger: SeedLogger, schoolId: string): Promise<void> {
  logger.info('Verifying row counts against Phase 1 audit §5 expected ranges (drift is logged as a warning, not a failure)...');
  for (const [table, min, max] of EXPECTED_ROW_RANGES) {
    // 'schools' has no school_id column — it IS the school, filtered by id.
    const filterCol = table === 'schools' ? 'id' : 'school_id';
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(filterCol, schoolId);
    if (error) {
      logger.warn(`Row-count check for ${table} failed: ${error.message}`);
      continue;
    }
    const actual = count ?? 0;
    if (actual < min || actual > max) {
      logger.warn(`${table}: ${actual} rows, expected ${min}-${max}`);
    } else {
      logger.info(`${table}: ${actual} rows (within expected ${min}-${max})`);
    }
  }
}

const USAGE = `Usage:
  tsx scripts/seed-sample-school.ts --school-name-default --confirm
  tsx scripts/seed-sample-school.ts --school-name "TEST — <name>" --confirm [--confirm-production]`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  requireFlag(args, 'confirm', USAGE);

  if (process.env.NODE_ENV === 'production') {
    requireFlag(args, 'confirm-production', `NODE_ENV=production — this requires an extra confirmation.\n\n${USAGE}`);
  }

  let schoolName: string;
  if (args['school-name-default']) {
    schoolName = DEFAULT_SCHOOL_NAME;
  } else {
    requireFlag(args, 'school-name', USAGE);
    schoolName = args['school-name'] as string;
  }
  if (!schoolName.startsWith('TEST — ')) {
    console.error(`Refusing to seed: school name must start with "TEST — " (got: ${JSON.stringify(schoolName)})`);
    process.exit(1);
  }

  const logger = new SeedLogger('seed');
  logger.info(`Starting sample-school seed run — school name: ${schoolName}`);
  logger.info(`Log file: ${logger.logPath}`);

  // Pre-run check: refuse if a school with this exact name already exists —
  // avoids accidentally layering a second seed run's data onto an existing one.
  const { SupabaseService } = await import('../src/supabase/supabase.service');
  const precheckService = new SupabaseService();
  const { data: existing, error: existingErr } = await precheckService.admin.from('schools').select('id').eq('name', schoolName).maybeSingle();
  if (existingErr) throw new Error(`Pre-run existence check failed: ${existingErr.message}`);
  if (existing) {
    console.error(`Refusing to seed: a school named ${JSON.stringify(schoolName)} already exists (id: ${existing.id}). Tear it down first or pick a different name.`);
    process.exit(1);
  }

  logger.info('Pre-run checks passed. Starting in 5 seconds — Ctrl+C to abort.');
  await new Promise((r) => setTimeout(r, 5000));

  const stateFile = StateFile.create(schoolName);
  logger.info(`State file: ${stateFile.path}`);

  try {
    const rng = createSeededRng();

    const { school, admin } = await seedSchool(logger, schoolName);
    stateFile.setSchoolId(school.id);

    const term = await seedTerm(admin, logger, school.id);
    const classes = await seedClasses(admin, logger, school.id);
    const subjects = await seedSubjects(admin, logger, school.id);
    const departments = await seedDepartments(admin, logger, school.id);

    const plan = planPeople(rng, classes);
    const people = await seedPeople(admin, logger, stateFile, school.id, classes, plan);
    const { adminUserId, classTeachers, specialistTeachers, students, parents, guardianLinks } = people;

    await assignClassTeachers(admin, logger, school.id, classes, classTeachers);
    await assignDepartmentHeads(admin, logger, school.id, departments, classTeachers.slice(0, departments.length));

    const subjectAssignments = await seedSubjectAssignments(admin, logger, school.id, classes, subjects, classTeachers, specialistTeachers);

    const studentsByClass = new Map<string, SeededStudent[]>();
    for (const student of students) {
      const list = studentsByClass.get(student.classId) ?? [];
      list.push(student);
      studentsByClass.set(student.classId, list);
    }

    const baseDemo = resolveDemoPatterns(classes, students, subjectAssignments, subjects);
    const demo: DemoPatterns = { ...baseDemo, siblingParentStudents: resolveSiblingDemoCase(students) };

    const markedByTeacherId = classTeachers[0]!.teacherId;
    await seedAttendanceAndAbsences(admin, logger, school.id, term, students, guardianLinks, adminUserId, markedByTeacherId, demo, rng);
    await seedAssessmentsAndGrades(admin, logger, school.id, term, subjectAssignments, subjects, studentsByClass, demo, rng);
    const homeworkIds = await seedHomework(admin, logger, school.id, term, subjectAssignments, subjects, studentsByClass, demo, rng);
    const quizIds = await seedQuizzes(admin, logger, school.id, term, subjectAssignments, subjects, studentsByClass, adminUserId, demo, rng);

    const prefects = await seedClassPrefects(admin, logger, school.id, term, classes, studentsByClass, adminUserId, rng);
    await seedBehaviourPoints(admin, logger, school.id, term, students, classTeachers, demo, rng);
    await seedBehaviorIncidentReports(admin, logger, school.id, term, students, prefects, rng);

    await seedFees(admin, logger, school.id, term, students, adminUserId, demo, rng);

    await seedDocuments(admin, logger, school.id, school.name, adminUserId, classes, subjects, homeworkIds, quizIds);
    await seedMessaging(admin, logger, school.id, adminUserId, classTeachers, parents, rng);
    await seedNotifications(admin, logger, school.id, parents, classTeachers, rng);

    await verifyRowCounts(admin, logger, school.id);

    stateFile.markCompleted();

    logger.info('=== SEED COMPLETE ===');
    logger.info(`School: ${school.name} (${school.id})`);
    logger.info(`Students: ${students.length}, Teachers: ${classTeachers.length + specialistTeachers.length}, Parents: ${parents.length}`);
    logger.info(`Declining student: ${demo.decliningStudent.fullName} (${demo.decliningStudent.admissionNo})`);
    logger.info(`Star student: ${demo.starStudent.fullName} (${demo.starStudent.admissionNo})`);
    logger.info(`Approved-absence student: ${demo.approvedAbsenceStudent.fullName} (${demo.approvedAbsenceStudent.admissionNo})`);
    logger.info(`Arrears student: ${demo.arrearsStudent.fullName} (${demo.arrearsStudent.admissionNo})`);
    if (demo.siblingParentStudents) {
      logger.info(`Sibling pair: ${demo.siblingParentStudents[0].fullName} (${demo.siblingParentStudents[0].admissionNo}) & ${demo.siblingParentStudents[1].fullName} (${demo.siblingParentStudents[1].admissionNo})`);
    }
    logger.info(`State file (retained): ${stateFile.path}`);
    logger.info(`Log file: ${logger.logPath}`);
    logger.info(`Teardown: pnpm --filter @school-manager/api teardown:sample-school -- --school-name "${school.name}" --confirm`);
  } catch (err) {
    logger.error(`Seed run failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error(`Recover with: pnpm --filter @school-manager/api teardown:sample-school -- --state-file "${stateFile.path}" --confirm`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
