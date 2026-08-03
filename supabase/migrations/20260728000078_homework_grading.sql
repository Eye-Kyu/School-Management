-- ============================================================
-- Bucket 1, PR 2a — homework grading capability
-- ============================================================
-- Per docs/audits/homework-quiz-gradebook-relationship.md, homework had zero
-- grading capability: homework_assignments has no max-score column, and
-- homework_completions (the only per-student homework record) is a bare
-- completion tick with nothing to score. This adds both.
--
-- Grading target is homework_completions directly, not a new
-- "homework_submissions" table — this codebase's homework is explicitly
-- "physical, in-person, no file upload" (see homework_assignments' own
-- comment in 20260526000008_events_homework.sql), so there is no submission
-- content to store or view; grading a roster with no content to review
-- already matches how apps/web/.../teacher/assessments/[id]/GradeEntryClient.tsx
-- grades assessments today.
-- ============================================================

ALTER TABLE public.homework_assignments ADD COLUMN IF NOT EXISTS max_score NUMERIC(6,2) NULL;
ALTER TABLE public.homework_assignments
  ADD CONSTRAINT homework_assignments_max_score_positive CHECK (max_score IS NULL OR max_score > 0);

ALTER TABLE public.homework_completions
  ADD COLUMN IF NOT EXISTS score NUMERIC(6,2) NULL,
  ADD COLUMN IF NOT EXISTS grader_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS graded_by_user_id UUID NULL REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS homework_completions_graded_at_idx
  ON public.homework_completions(graded_at) WHERE graded_at IS NOT NULL;

-- score <= the parent homework's max_score can't be a plain CHECK (Postgres
-- CHECK constraints can't reference another table) — a trigger is the DB-level
-- equivalent, matching the validate-and-RAISE shape already established by
-- check_report_card_signoff() (20260723000044_report_card_signoff.sql). This
-- is defense-in-depth against a direct-Supabase write; the primary,
-- user-facing check lives in HomeworkService.gradeSubmission().
CREATE OR REPLACE FUNCTION public.check_homework_grade_within_max()
RETURNS TRIGGER AS $$
DECLARE
  v_max_score NUMERIC(6,2);
BEGIN
  IF NEW.score IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_score INTO v_max_score FROM public.homework_assignments WHERE id = NEW.homework_id;

  IF v_max_score IS NOT NULL AND NEW.score > v_max_score THEN
    RAISE EXCEPTION 'score (%) exceeds homework max_score (%)', NEW.score, v_max_score;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS homework_grade_within_max_check ON public.homework_completions;
CREATE TRIGGER homework_grade_within_max_check
  BEFORE INSERT OR UPDATE ON public.homework_completions
  FOR EACH ROW EXECUTE FUNCTION public.check_homework_grade_within_max();

INSERT INTO public._migration_log (filename) VALUES ('20260728000078_homework_grading.sql') ON CONFLICT (filename) DO NOTHING;
