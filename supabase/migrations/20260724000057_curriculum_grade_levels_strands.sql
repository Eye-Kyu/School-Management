-- ============================================================
-- Curriculum catalog: named grade levels + CBC strands + source metadata
-- ============================================================
-- Additive extension of 20260722000033_curriculum.sql's `curricula` /
-- `curriculum_subjects` tables. The existing schema can only represent a
-- grade as a bare integer with no name/age range, and has no way to record
-- where the data came from or whether it's been verified against a public
-- source — both required to seed real CBC/8-4-4/Cambridge International
-- data responsibly. Purely additive: no existing column is renamed or
-- dropped, `curriculum_subjects.grade_level` (INTEGER) is left exactly as
-- it was so the current SuperAdmin UI's grouping-by-integer keeps working
-- unchanged; the new `grade_level_id` FK is populated alongside it.
--
-- Same RLS shape as the tables this extends (curricula/curriculum_subjects):
-- platform-wide reference data, not school-scoped. SELECT is open to any
-- authenticated user; INSERT/UPDATE/DELETE is SUPER_ADMIN-only. This is a
-- deliberate deviation from the standard `school_id = current_school_id()`
-- tenant-isolation pattern used everywhere else in this codebase, matching
-- the precedent already set by curricula/curriculum_subjects/modules/packages.
-- ============================================================

ALTER TABLE public.curricula
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT NOT NULL DEFAULT 'KE',
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_verified_on DATE;

CREATE UNIQUE INDEX IF NOT EXISTS curricula_code_uidx ON public.curricula (code) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.curriculum_grade_levels (
  id               UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id    UUID         NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  code             TEXT         NOT NULL,
  name             TEXT         NOT NULL,
  sequence_number  INTEGER      NOT NULL,
  age_range_from   INTEGER,
  age_range_to     INTEGER,
  is_active        BOOLEAN      NOT NULL DEFAULT true,
  UNIQUE (curriculum_id, code)
);
CREATE INDEX IF NOT EXISTS curriculum_grade_levels_curriculum_idx ON public.curriculum_grade_levels (curriculum_id);

ALTER TABLE public.curriculum_subjects
  ADD COLUMN IF NOT EXISTS is_core BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS verification_note TEXT,
  ADD COLUMN IF NOT EXISTS pathway TEXT,
  ADD COLUMN IF NOT EXISTS grade_level_id UUID REFERENCES public.curriculum_grade_levels(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.curriculum_subject_strands (
  id                     UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_subject_id  UUID         NOT NULL REFERENCES public.curriculum_subjects(id) ON DELETE CASCADE,
  name                   TEXT         NOT NULL,
  display_order          INTEGER      NOT NULL DEFAULT 0,
  UNIQUE (curriculum_subject_id, name)
);
CREATE INDEX IF NOT EXISTS curriculum_subject_strands_subject_idx ON public.curriculum_subject_strands (curriculum_subject_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.curriculum_grade_levels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_subject_strands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "curriculum_grade_levels_select_all" ON public.curriculum_grade_levels FOR SELECT USING (true);
CREATE POLICY "curriculum_grade_levels_write_super_admin" ON public.curriculum_grade_levels FOR ALL
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');

CREATE POLICY "curriculum_subject_strands_select_all" ON public.curriculum_subject_strands FOR SELECT USING (true);
CREATE POLICY "curriculum_subject_strands_write_super_admin" ON public.curriculum_subject_strands FOR ALL
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');
