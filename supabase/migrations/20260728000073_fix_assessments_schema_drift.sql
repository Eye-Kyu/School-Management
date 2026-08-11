-- ============================================================
-- Phase 0, sub-sprint 4: fix assessments schema drift
-- ============================================================
-- 20260527000012_gradebook.sql's CREATE TABLE for `assessments` describes
-- columns (kind, weight, max_score, date, created_by_id) that were never
-- actually applied to this database: an earlier `prisma db push` created
-- the real table first (teacher_id NOT NULL, description, max_marks,
-- assessment_date — matching packages/db/prisma/schema.prisma's Assessment
-- model, which is and always has been correct), so that migration's
-- `CREATE TABLE IF NOT EXISTS` silently no-op'd against the pre-existing
-- table (documented in EXECUTION_PLAN.md's Week 16 correction note).
--
-- Consequence: the *live* database has always had the right shape (every
-- call site in this codebase already queries teacher_id/max_marks/
-- assessment_date/description) — this migration is a no-op against it. The
-- actual bug is that a genuinely fresh bootstrap (running every file in
-- this directory against an empty database) would create the WRONG shape
-- today, since nothing would create the right one first the way `db push`
-- accidentally did historically. Per project convention, 20260527000012's
-- own CREATE TABLE statement is left untouched (migrations are never
-- edited after merge) — this file corrects the resulting state instead,
-- idempotently in both directions so it's a no-op on the current live
-- database and a real fix on a fresh one.
-- ============================================================

ALTER TABLE public.assessments
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS weight,
  DROP COLUMN IF EXISTS max_score,
  DROP COLUMN IF EXISTS date,
  DROP COLUMN IF EXISTS created_by_id;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES public.teachers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS max_marks INT,
  ADD COLUMN IF NOT EXISTS assessment_date DATE;

-- teacher_id/max_marks are NOT NULL in schema.prisma and every real row
-- already satisfies that (confirmed live) — only enforce it if the column
-- was just added empty (a fresh bootstrap) or is already fully populated
-- (the live DB), never leaving an existing populated table half-migrated.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.assessments WHERE teacher_id IS NULL) THEN
    ALTER TABLE public.assessments ALTER COLUMN teacher_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.assessments WHERE max_marks IS NULL) THEN
    ALTER TABLE public.assessments ALTER COLUMN max_marks SET NOT NULL;
  END IF;
END $$;

INSERT INTO public._migration_log (filename) VALUES ('20260728000073_fix_assessments_schema_drift.sql') ON CONFLICT (filename) DO NOTHING;
