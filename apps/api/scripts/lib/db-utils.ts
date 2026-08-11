// =============================================================================
// Small shared helpers: chunking + batched inserts + linked-grade writes.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeedLogger } from './seed-logger';

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Inserts `rows` into `table` in batches of `chunkSize` (default 500 — this
 * task's own explicit instruction; the Phase 1 audit's 200-row figure was
 * its own estimate from a different e2e fixture's payload-size comment, not
 * a hard platform limit either way — 500 is used here since it's what this
 * implementation task specifies). Logs one line per batch via `logger`.
 * Throws on the first error rather than continuing partially.
 */
export async function batchInsert<T extends Record<string, unknown>>(
  client: SupabaseClient,
  logger: SeedLogger,
  table: string,
  schoolId: string,
  rows: readonly T[],
  chunkSize = 500,
): Promise<void> {
  if (rows.length === 0) return;
  for (const batch of chunk(rows, chunkSize)) {
    const { error } = await client.from(table).insert(batch as never);
    if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
  }
  logger.insert(table, rows.length, schoolId);
}

/**
 * Writes a grade for a LINKED (source_type != 'DIRECT') assessment via the
 * `write_linked_grade` RPC — never a raw `grades` insert, which the
 * `grades_block_direct_edit_on_linked` trigger rejects regardless of caller
 * role (see docs/audits/sample-school-seed-plan.md §1.15). Deliberately NOT
 * using the `record_quiz_grade` RPC for the linked-quiz case either: that
 * function authorizes internally via `current_user_id()`/`current_user_role()`
 * (both resolve from `auth.uid()`), which is NULL under a service-role
 * client with no real JWT session — every call would hit its "Not
 * authorized to record this grade" branch. `write_linked_grade` has no such
 * check, so it's called directly for both the linked-homework and
 * linked-quiz demo cases, replicating `record_quiz_grade`'s own
 * normalization formula inline for the quiz case (see seed-academic.ts).
 */
export async function writeLinkedGrade(
  client: SupabaseClient,
  assessmentId: string,
  studentId: string,
  score: number,
): Promise<void> {
  const { error } = await client.rpc('write_linked_grade', {
    p_assessment_id: assessmentId,
    p_student_id: studentId,
    p_score: score,
  });
  if (error) throw new Error(`write_linked_grade(${assessmentId}, ${studentId}) failed: ${error.message}`);
}
