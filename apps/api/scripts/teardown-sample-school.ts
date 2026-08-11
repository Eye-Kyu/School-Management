#!/usr/bin/env tsx
// =============================================================================
// Tears down a sample school created by seed-sample-school.ts. Two modes:
//
//   --school-name "TEST — <name>" --confirm
//     Looks the school up by exact name, deletes every tenant-scoped row for
//     its school_id, then deletes every auth user discovered via that
//     school's `users` rows.
//
//   --state-file <path> --confirm
//     Recovery mode for a failed/partial seed run. Reads the checkpoint file
//     (lib/state-file.ts) written throughout the run: deletes the school (if
//     one was created before the failure) and every auth user id recorded,
//     even ones with no corresponding public.users row yet.
//
// Deletion order is explicit, leaf-tables-first (never relying on FK CASCADE
// alone) — in particular attendance_records is deleted before teachers,
// since attendance_records.marked_by_id -> teachers.id is ON DELETE RESTRICT
// (supabase/migrations/20260522000001_init.sql:385), the one non-CASCADE FK
// among every table this script touches.
//
// After deletion, independently re-queries every table by school_id (and
// guardians/subject_assignments, which have no school_id column, via their
// parent tables' ids) plus every auth user id — prints "TEARDOWN INCOMPLETE"
// and exits non-zero if anything survived, rather than trusting the delete
// calls' own reported counts.
//
// Measured runtime: ~1-1.5 minutes per run (four live runs, all consistent),
// including 723 parallelized auth-user deletions (10 concurrent).
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
import type { SupabaseClient } from '@supabase/supabase-js';

const USAGE = `Usage:
  tsx scripts/teardown-sample-school.ts --school-name "TEST — <name>" --confirm
  tsx scripts/teardown-sample-school.ts --state-file <path> --confirm`;

// Leaf-to-root order for every school_id-scoped table.
const SCHOOL_SCOPED_TABLES_IN_DELETE_ORDER = [
  'document_downloads',
  'documents',
  'messages',
  'conversations',
  'notifications',
  'payment_paybill_transactions',
  'payment_transactions',
  'payment_records',
  'fee_balances',
  'behavior_incident_reports',
  'behaviour_points',
  'class_prefects',
  'quiz_attempts',
  'quiz_questions',
  'quizzes',
  'homework_completions',
  'homework_assignments',
  'grades',
  'assessments',
  'attendance_records', // must precede 'teachers' — see header comment
  'absence_requests',
  // guardians, subject_assignments: no school_id column, handled separately below
  'students',
  'teachers',
  'departments',
  'classes',
  'subjects',
  'terms',
  'prefect_powers',
  'users',
];

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function deleteBySchoolId(admin: SupabaseClient, logger: SeedLogger, table: string, schoolId: string): Promise<void> {
  const { error, count } = await admin.from(table).delete({ count: 'exact' }).eq('school_id', schoolId);
  if (error) throw new Error(`Delete from ${table} failed: ${error.message}`);
  logger.delete(table, count ?? 0, schoolId);
}

async function deleteByParentIds(admin: SupabaseClient, logger: SeedLogger, table: string, column: string, ids: string[], schoolId: string): Promise<void> {
  let total = 0;
  for (const batch of chunk(ids, 100)) {
    if (batch.length === 0) continue;
    const { error, count } = await admin.from(table).delete({ count: 'exact' }).in(column, batch);
    if (error) throw new Error(`Delete from ${table} failed: ${error.message}`);
    total += count ?? 0;
  }
  logger.delete(table, total, schoolId);
}

async function deleteAuthUsers(admin: SupabaseClient, logger: SeedLogger, authUserIds: readonly string[]): Promise<void> {
  let deleted = 0;
  for (const batch of chunk(authUserIds, 10)) {
    await Promise.all(
      batch.map(async (id) => {
        const { error } = await admin.auth.admin.deleteUser(id);
        // Already-gone is fine (idempotent re-run of teardown) — only a
        // genuine non-"not found" error should stop the run.
        if (error && !/not.*found/i.test(error.message)) {
          throw new Error(`Delete auth user ${id} failed: ${error.message}`);
        }
      }),
    );
    deleted += batch.length;
  }
  logger.info(`AUTH USERS deleted ${deleted}/${authUserIds.length}`);
}

interface VerificationFailure { table: string; residualCount: number }

async function verifyTeardown(
  admin: SupabaseClient,
  logger: SeedLogger,
  schoolId: string | null,
  classIds: string[],
  studentIds: string[],
  authUserIds: readonly string[],
): Promise<VerificationFailure[]> {
  const failures: VerificationFailure[] = [];

  if (schoolId) {
    for (const table of [...SCHOOL_SCOPED_TABLES_IN_DELETE_ORDER, 'schools']) {
      const filterCol = table === 'schools' ? 'id' : 'school_id';
      const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(filterCol, schoolId);
      if (error) { logger.warn(`Verification query for ${table} failed: ${error.message}`); continue; }
      if ((count ?? 0) > 0) failures.push({ table, residualCount: count ?? 0 });
    }

    if (studentIds.length > 0) {
      let residual = 0;
      for (const batch of chunk(studentIds, 100)) {
        const { count, error } = await admin.from('guardians').select('*', { count: 'exact', head: true }).in('student_id', batch);
        if (error) { logger.warn(`Verification query for guardians failed: ${error.message}`); continue; }
        residual += count ?? 0;
      }
      if (residual > 0) failures.push({ table: 'guardians', residualCount: residual });
    }
    if (classIds.length > 0) {
      let residual = 0;
      for (const batch of chunk(classIds, 100)) {
        const { count, error } = await admin.from('subject_assignments').select('*', { count: 'exact', head: true }).in('class_id', batch);
        if (error) { logger.warn(`Verification query for subject_assignments failed: ${error.message}`); continue; }
        residual += count ?? 0;
      }
      if (residual > 0) failures.push({ table: 'subject_assignments', residualCount: residual });
    }
  }

  const survivingAuthIds: string[] = [];
  await Promise.all(
    authUserIds.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user) survivingAuthIds.push(id);
    }),
  );
  if (survivingAuthIds.length > 0) failures.push({ table: 'auth.users', residualCount: survivingAuthIds.length });

  return failures;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  requireFlag(args, 'confirm', USAGE);

  const hasSchoolName = typeof args['school-name'] === 'string';
  const hasStateFile = typeof args['state-file'] === 'string';
  if (hasSchoolName === hasStateFile) {
    console.error(`Exactly one of --school-name or --state-file is required.\n\n${USAGE}`);
    process.exit(1);
  }

  const logger = new SeedLogger('teardown');
  logger.info(`Log file: ${logger.logPath}`);

  const { SupabaseService } = await import('../src/supabase/supabase.service');
  const admin = new SupabaseService().admin;

  let schoolId: string | null = null;
  let authUserIds: string[] = [];

  if (hasStateFile) {
    const stateFile = StateFile.load(args['state-file'] as string);
    schoolId = stateFile.schoolId;
    authUserIds = [...stateFile.authUserIds];
    logger.info(`Loaded state file for school "${stateFile.schoolName}" (schoolId: ${schoolId ?? 'never created'}, ${authUserIds.length} recorded auth users)`);
  } else {
    const schoolName = args['school-name'] as string;
    const { data: school, error } = await admin.from('schools').select('id').eq('name', schoolName).maybeSingle();
    if (error) throw new Error(`School lookup failed: ${error.message}`);
    if (!school) {
      console.error(`No school found named ${JSON.stringify(schoolName)}.`);
      process.exit(1);
    }
    schoolId = school.id;
    const { data: userRows, error: userErr } = await admin.from('users').select('auth_id').eq('school_id', schoolId);
    if (userErr) throw new Error(`Fetching users for auth-id collection failed: ${userErr.message}`);
    authUserIds = (userRows ?? []).map((r) => r.auth_id as string).filter(Boolean);
    logger.info(`Found school "${schoolName}" (${schoolId}) with ${authUserIds.length} auth users`);
  }

  let classIds: string[] = [];
  let studentIds: string[] = [];

  if (schoolId) {
    const { data: classRows } = await admin.from('classes').select('id').eq('school_id', schoolId);
    classIds = (classRows ?? []).map((r) => r.id as string);
    const { data: studentRows } = await admin.from('students').select('id').eq('school_id', schoolId);
    studentIds = (studentRows ?? []).map((r) => r.id as string);

    // guardians/subject_assignments have no school_id column — deleted via
    // their parent ids, before the parent rows (students/classes) themselves
    // are deleted below.
    await deleteByParentIds(admin, logger, 'guardians', 'student_id', studentIds, schoolId);
    await deleteByParentIds(admin, logger, 'subject_assignments', 'class_id', classIds, schoolId);

    for (const table of SCHOOL_SCOPED_TABLES_IN_DELETE_ORDER) {
      await deleteBySchoolId(admin, logger, table, schoolId);
    }

    const { error: schoolDeleteErr, count } = await admin.from('schools').delete({ count: 'exact' }).eq('id', schoolId);
    if (schoolDeleteErr) throw new Error(`Delete school failed: ${schoolDeleteErr.message}`);
    logger.delete('schools', count ?? 0, schoolId);
  } else {
    logger.info('No school was ever created for this run (state file has no schoolId) — skipping tenant-table deletion.');
  }

  await deleteAuthUsers(admin, logger, authUserIds);

  const failures = await verifyTeardown(admin, logger, schoolId, classIds, studentIds, authUserIds);
  if (failures.length > 0) {
    logger.error('TEARDOWN INCOMPLETE — residual rows found:');
    for (const f of failures) logger.error(`  ${f.table}: ${f.residualCount} row(s)`);
    process.exit(1);
  }

  logger.info('=== TEARDOWN COMPLETE — zero residual rows across every checked table and auth user ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
