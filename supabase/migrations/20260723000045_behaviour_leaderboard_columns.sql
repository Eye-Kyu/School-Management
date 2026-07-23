-- ============================================================
-- Behavior leaderboard — schema additions to behaviour_points
-- ============================================================
-- The existing category column (POSITIVE/NEGATIVE) is a polarity flag, a
-- different concept from the leaderboard's topic classification — added as
-- a new column (reason_category) rather than repurposing it, since the
-- existing admin/teacher UI already reads/writes category as polarity.
-- awarded_by_user_id is a direct users.id (teacher_id is teachers.id, one
-- join away) — added and backfilled here rather than reused, since the
-- spec wants a direct column matching the audit_logs.user_id convention.

ALTER TABLE public.behaviour_points
  ADD COLUMN IF NOT EXISTS reason_category TEXT CHECK (reason_category IN ('academic','attendance','citizenship','leadership','other')),
  ADD COLUMN IF NOT EXISTS awarded_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS class_context_id UUID REFERENCES public.classes(id) ON DELETE SET NULL;

UPDATE public.behaviour_points bp
SET awarded_by_user_id = t.user_id
FROM public.teachers t
WHERE t.id = bp.teacher_id AND bp.awarded_by_user_id IS NULL;

-- Leaderboard query indexes, per spec.
CREATE INDEX IF NOT EXISTS bp_school_date_idx ON public.behaviour_points (school_id, date);
CREATE INDEX IF NOT EXISTS bp_school_student_date_idx ON public.behaviour_points (school_id, student_id, date);
