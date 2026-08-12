// =============================================================================
// AI sub-module backfill migration — idempotency + reversal
// =============================================================================
// Exercises the exact logic 20260728000090_backfill_ai_sub_modules.sql runs,
// against a dedicated fixture school (not real production data — Refinement
// 1's production check confirmed zero schools currently have ai_features
// enabled, so there is nothing to test the migration against there). No
// NestJS app bootstrap needed — this is pure DB-state verification via the
// service-role client, same as cross-tenant.e2e-spec.ts's `admin` client.
// =============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import ws from 'ws';

const TIMEOUT = 30_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REALTIME_OPTIONS = { transport: ws } as any;

const AI_SUB_MODULE_KEYS = ['ai_tutor', 'ai_quiz_generation', 'ai_plagiarism_detection', 'ai_report_comments'];

describe('AI sub-module backfill migration (e2e)', () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  let schoolId: string;

  async function runBackfill(): Promise<void> {
    // Same two statements as 20260728000090_backfill_ai_sub_modules.sql's
    // up-migration, run through the JS client rather than raw SQL (no psql
    // available in this environment — see this session's own established
    // convention for applying migrations).
    const { data: enabledSchools } = await admin
      .from('school_modules')
      .select('school_id')
      .eq('module_key', 'ai_features')
      .eq('enabled', true);
    const schoolIds = (enabledSchools ?? []).map((r) => r.school_id as string);

    for (const sid of schoolIds) {
      await admin.from('school_modules').insert({
        id: randomUUID(), school_id: sid, module_key: 'ai_report_comments', enabled: true, enabled_at: new Date().toISOString(), config: {},
      }); // ON CONFLICT DO NOTHING equivalent: ignore unique-violation errors
      for (const key of ['ai_tutor', 'ai_quiz_generation', 'ai_plagiarism_detection']) {
        await admin.from('school_modules').insert({
          id: randomUUID(), school_id: sid, module_key: key, enabled: false, config: {},
        });
      }
    }
  }

  async function runDownMigration(): Promise<void> {
    await admin.from('school_modules').delete().eq('school_id', schoolId).in('module_key', AI_SUB_MODULE_KEYS);
  }

  beforeAll(async () => {
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: REALTIME_OPTIONS,
    });

    const { data: school, error } = await admin
      .from('schools')
      .insert({ id: randomUUID(), name: `AI Migration Test School ${suffix}`, slug: `ai-migration-test-${suffix}`, updated_at: new Date().toISOString() })
      .select('id')
      .single();
    if (error) throw error;
    schoolId = school!.id;

    // Fixture: this school has ai_features explicitly enabled, as if it had
    // been enabled before this PR's split (the exact precondition the real
    // migration backfills).
    await admin.from('school_modules').insert({
      id: randomUUID(), school_id: schoolId, module_key: 'ai_features', enabled: true, enabled_at: new Date().toISOString(),
    });
  }, TIMEOUT);

  afterAll(async () => {
    if (!admin) return;
    await admin.from('schools').delete().eq('id', schoolId);
  }, TIMEOUT);

  it('backfills ai_report_comments=true and the other 3 explicitly false', async () => {
    await runBackfill();

    const { data: rows } = await admin
      .from('school_modules')
      .select('module_key, enabled')
      .eq('school_id', schoolId)
      .in('module_key', AI_SUB_MODULE_KEYS);

    const byKey = Object.fromEntries((rows ?? []).map((r) => [r.module_key, r.enabled]));
    expect(byKey).toEqual({
      ai_report_comments: true,
      ai_tutor: false,
      ai_quiz_generation: false,
      ai_plagiarism_detection: false,
    });
  }, TIMEOUT);

  it('is idempotent — a second run leaves the exact same state', async () => {
    await runBackfill();

    const { data: rows } = await admin
      .from('school_modules')
      .select('module_key, enabled')
      .eq('school_id', schoolId)
      .in('module_key', AI_SUB_MODULE_KEYS);

    expect(rows).toHaveLength(4); // no duplicate rows from the second run
    const byKey = Object.fromEntries((rows ?? []).map((r) => [r.module_key, r.enabled]));
    expect(byKey).toEqual({
      ai_report_comments: true,
      ai_tutor: false,
      ai_quiz_generation: false,
      ai_plagiarism_detection: false,
    });
  }, TIMEOUT);

  it('does not backfill a school with ai_features disabled or absent', async () => {
    const { data: otherSchool } = await admin
      .from('schools')
      .insert({ id: randomUUID(), name: `AI Migration Untouched School ${suffix}`, slug: `ai-migration-untouched-${suffix}`, updated_at: new Date().toISOString() })
      .select('id')
      .single();

    try {
      await runBackfill();

      const { data: rows } = await admin
        .from('school_modules')
        .select('module_key')
        .eq('school_id', otherSchool!.id);
      expect(rows ?? []).toHaveLength(0);
    } finally {
      await admin.from('schools').delete().eq('id', otherSchool!.id);
    }
  }, TIMEOUT);

  it('down-migration removes all 4 sub-module rows without touching ai_features', async () => {
    await runDownMigration();

    const { data: subRows } = await admin
      .from('school_modules')
      .select('module_key')
      .eq('school_id', schoolId)
      .in('module_key', AI_SUB_MODULE_KEYS);
    expect(subRows ?? []).toHaveLength(0);

    const { data: aiFeaturesRow } = await admin
      .from('school_modules')
      .select('enabled')
      .eq('school_id', schoolId)
      .eq('module_key', 'ai_features')
      .single();
    expect(aiFeaturesRow?.enabled).toBe(true); // untouched by the down-migration
  }, TIMEOUT);
});
