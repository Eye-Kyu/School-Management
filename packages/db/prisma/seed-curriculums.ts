// =============================================================================
// Curriculum catalog seed - loads packages/db/prisma/seed-data/curriculums/*.json
// into the platform-level curricula/curriculum_grade_levels/curriculum_subjects/
// curriculum_subject_strands tables. Informational reference data only — never
// touches any school's own subjects/classes/terms.
// =============================================================================
// Run with: pnpm --filter @school-manager/db seed-curriculums
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
// Uses the Supabase JS client directly (same pattern as prisma/seed.ts) — the
// live schema for these tables is managed by supabase/migrations/*.sql via
// `supabase db push`, not by Prisma; packages/db/prisma/schema.prisma does not
// model these tables and is not the source of truth here.
//
// Idempotent: every table is upserted by its natural unique key (curricula.code,
// curriculum_grade_levels(curriculum_id,code), curriculum_subjects(curriculum_id,
// grade_level,name), curriculum_subject_strands(curriculum_subject_id,name)).
// Running this script twice produces the same rows, no duplicates.
// =============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

type SeedGradeLevel = {
  code: string;
  name: string;
  sequence_number: number;
  age_range_from: number | null;
  age_range_to: number | null;
  is_active?: boolean;
};

type SeedSubject = {
  code: string;
  name: string;
  is_core?: boolean;
  pathway?: string | null;
  taught_at_grade_levels: string[];
  strands_per_grade?: Record<string, string[]>;
  verified?: boolean;
  verification_note?: string | null;
};

type SeedFile = {
  curriculum: {
    code: string;
    name: string;
    country_code?: string;
    description?: string;
    source_url?: string;
    source_verified_on?: string;
    active?: boolean;
  };
  grade_levels: SeedGradeLevel[];
  subjects: SeedSubject[];
};

function assertField(condition: unknown, curriculumCode: string, message: string): asserts condition {
  if (!condition) throw new Error(`[${curriculumCode}] schema mismatch — ${message}`);
}

function validate(file: SeedFile, fileName: string) {
  const code = file.curriculum?.code;
  assertField(code, fileName, 'curriculum.code is required');
  assertField(file.curriculum.name, code, 'curriculum.name is required');
  assertField(Array.isArray(file.grade_levels), code, 'grade_levels must be an array');
  assertField(Array.isArray(file.subjects), code, 'subjects must be an array');

  const gradeCodes = new Set(file.grade_levels.map((g) => g.code));
  for (const g of file.grade_levels) {
    assertField(g.code, code, 'every grade level needs a code');
    assertField(g.name, code, `grade level "${g.code}" needs a name`);
    assertField(Number.isInteger(g.sequence_number), code, `grade level "${g.code}" needs an integer sequence_number`);
  }
  for (const s of file.subjects) {
    assertField(s.code, code, 'every subject needs a code');
    assertField(s.name, code, `subject "${s.code}" needs a name`);
    assertField(Array.isArray(s.taught_at_grade_levels) && s.taught_at_grade_levels.length > 0, code, `subject "${s.code}" needs a non-empty taught_at_grade_levels`);
    for (const gc of s.taught_at_grade_levels) {
      assertField(gradeCodes.has(gc), code, `subject "${s.code}" references unknown grade level "${gc}"`);
    }
    if (s.strands_per_grade) {
      for (const gc of Object.keys(s.strands_per_grade)) {
        assertField(gradeCodes.has(gc), code, `subject "${s.code}" has strands for unknown grade level "${gc}"`);
      }
    }
  }
}

async function loadCurriculum(supabase: SupabaseClient, filePath: string, fileName: string) {
  const file = JSON.parse(readFileSync(filePath, 'utf8')) as SeedFile;
  validate(file, fileName);
  const code = file.curriculum.code;

  const { data: curriculum, error: curErr } = await supabase
    .from('curricula')
    .upsert(
      {
        code,
        name: file.curriculum.name,
        country_code: file.curriculum.country_code ?? 'KE',
        description: file.curriculum.description ?? '',
        source_url: file.curriculum.source_url ?? null,
        source_verified_on: file.curriculum.source_verified_on ?? null,
        is_active: file.curriculum.active ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'code' },
    )
    .select('id')
    .single();
  if (curErr) throw new Error(`[${code}] curricula upsert failed: ${curErr.message}`);

  const gradeLevelIdByCode = new Map<string, string>();
  const sequenceByCode = new Map<string, number>();
  for (const g of file.grade_levels) {
    const { data: row, error } = await supabase
      .from('curriculum_grade_levels')
      .upsert(
        {
          curriculum_id: curriculum.id,
          code: g.code,
          name: g.name,
          sequence_number: g.sequence_number,
          age_range_from: g.age_range_from ?? null,
          age_range_to: g.age_range_to ?? null,
          is_active: g.is_active ?? true,
        },
        { onConflict: 'curriculum_id,code' },
      )
      .select('id')
      .single();
    if (error) throw new Error(`[${code}] curriculum_grade_levels upsert failed for "${g.code}": ${error.message}`);
    gradeLevelIdByCode.set(g.code, row.id);
    sequenceByCode.set(g.code, g.sequence_number);
  }

  let subjectGradeRowCount = 0;
  let strandCount = 0;
  for (const s of file.subjects) {
    for (const gradeCode of s.taught_at_grade_levels) {
      const gradeLevelId = gradeLevelIdByCode.get(gradeCode)!;
      const { data: subjectRow, error } = await supabase
        .from('curriculum_subjects')
        .upsert(
          {
            curriculum_id: curriculum.id,
            grade_level: sequenceByCode.get(gradeCode)!,
            grade_level_id: gradeLevelId,
            name: s.name,
            code: s.code,
            is_core: s.is_core ?? true,
            pathway: s.pathway ?? null,
            verified: s.verified ?? true,
            verification_note: s.verification_note ?? null,
          },
          { onConflict: 'curriculum_id,grade_level,name' },
        )
        .select('id')
        .single();
      if (error) throw new Error(`[${code}] curriculum_subjects upsert failed for "${s.code}" @ ${gradeCode}: ${error.message}`);
      subjectGradeRowCount += 1;

      const strands = s.strands_per_grade?.[gradeCode] ?? [];
      for (let i = 0; i < strands.length; i++) {
        const { error: strandErr } = await supabase
          .from('curriculum_subject_strands')
          .upsert(
            { curriculum_subject_id: subjectRow.id, name: strands[i], display_order: i },
            { onConflict: 'curriculum_subject_id,name' },
          );
        if (strandErr) throw new Error(`[${code}] curriculum_subject_strands upsert failed for "${s.code}" @ ${gradeCode} strand "${strands[i]}": ${strandErr.message}`);
        strandCount += 1;
      }
    }
  }

  const verifiedCount = file.subjects.filter((s) => s.verified ?? true).length;
  const unverifiedCount = file.subjects.length - verifiedCount;
  console.log(
    `  ${file.curriculum.name}: ${file.subjects.length} subjects (${subjectGradeRowCount} subject-grade rows, ${strandCount} strands) across ${file.grade_levels.length} grade levels (${verifiedCount} verified, ${unverifiedCount} unverified)`,
  );
}

async function main() {
  console.log('Seeding curriculum catalog...\n');

  const supabase = createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const dir = join(__dirname, 'seed-data', 'curriculums');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`No curriculum JSON files found in ${dir}`);

  for (const file of files) {
    await loadCurriculum(supabase, join(dir, file), file);
  }

  console.log('\nCurriculum seed complete.\n');
}

main().catch((err) => {
  console.error('Curriculum seed failed:', err);
  process.exit(1);
});
