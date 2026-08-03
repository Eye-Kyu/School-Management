-- ============================================================
-- BUG-8 fix: reconcile assessments.term_id nullability/cascade
-- ============================================================
-- 20260527000012_gradebook.sql's original CREATE TABLE declared term_id
-- nullable (`ON DELETE SET NULL`). packages/db/prisma/schema.prisma has
-- always declared it non-optional with `onDelete: Cascade`. Unlike
-- teacher_id/max_marks, which 20260728000073_fix_assessments_schema_drift.sql
-- explicitly reconciled to NOT NULL, term_id's *name* matched between the
-- buggy original CREATE TABLE and the real Prisma-built table, so it fell
-- outside that migration's column-existence-based detection. No migration
-- has ever asserted NOT NULL/CASCADE for it since — see docs/bug-triage.md
-- BUG-8.
--
-- Live `assessments` has zero rows as of this migration (confirmed via a
-- read-only probe during the Bucket 1 PR 2 audit), so this is risk-free
-- today — the guard below is defensive for any other environment that isn't
-- empty, following the exact same conditional pattern
-- 20260728000073_fix_assessments_schema_drift.sql already established.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.assessments WHERE term_id IS NULL) THEN
    ALTER TABLE public.assessments ALTER COLUMN term_id SET NOT NULL;
  END IF;
END $$;

ALTER TABLE public.assessments DROP CONSTRAINT IF EXISTS assessments_term_id_fkey;
ALTER TABLE public.assessments ADD CONSTRAINT assessments_term_id_fkey
  FOREIGN KEY (term_id) REFERENCES public.terms(id) ON DELETE CASCADE;

INSERT INTO public._migration_log (filename) VALUES ('20260728000076_fix_assessments_term_id_drift.sql') ON CONFLICT (filename) DO NOTHING;
