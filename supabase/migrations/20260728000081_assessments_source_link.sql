-- ============================================================
-- Bucket 1, PR 2b — gradebook linking layer: source_type/source_id
-- ============================================================
-- Lets an assessment be either DIRECT (teacher-entered, the only kind that
-- existed before this PR) or derived from a homework/quiz. The partial
-- unique index ensures a single homework or quiz can only ever be linked to
-- one assessment.
-- ============================================================

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'DIRECT'
    CHECK (source_type IN ('DIRECT', 'HOMEWORK', 'QUIZ'));

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_id UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS assessments_source_unique
  ON public.assessments(source_type, source_id)
  WHERE source_type != 'DIRECT';

INSERT INTO public._migration_log (filename) VALUES ('20260728000081_assessments_source_link.sql') ON CONFLICT (filename) DO NOTHING;
