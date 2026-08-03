-- ============================================================
-- BUG-9 fix: guard assessments.max_marks positivity
-- ============================================================
-- No CHECK constraint has ever existed on max_marks — the only guard is an
-- app-layer Zod `.positive()` check on POST /assessments
-- (packages/types/src/schemas/assessments.ts), which doesn't cover the
-- direct-Supabase write path in apps/web/.../teacher/gradebook/GradebookClient.tsx
-- (fixed alongside this migration). See docs/bug-triage.md BUG-9.
--
-- Live `assessments` has zero rows as of this migration (confirmed via a
-- read-only probe during the Bucket 1 PR 2 audit) — the guard below is
-- defensive for any other environment, not a real backfill concern here.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.assessments WHERE max_marks <= 0) THEN
    ALTER TABLE public.assessments ADD CONSTRAINT assessments_max_marks_positive CHECK (max_marks > 0);
  END IF;
END $$;

INSERT INTO public._migration_log (filename) VALUES ('20260728000077_assessments_max_marks_positive.sql') ON CONFLICT (filename) DO NOTHING;
