-- ============================================================
-- Best Student — Term X badge
-- ============================================================
-- One row per school+term (upserted by the nightly recompute job), not a
-- column on students — keeps a natural per-term history in the DB even
-- though no history UI is built in this PR (that's an explicit backlog
-- item, not designed into a corner).

CREATE TABLE IF NOT EXISTS public.best_student_awards (
  id          UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID         NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  term_id     UUID         NOT NULL REFERENCES public.terms(id)    ON DELETE CASCADE,
  student_id  UUID         NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  awarded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, term_id)
);

ALTER TABLE public.best_student_awards ENABLE ROW LEVEL SECURITY;

-- Staff (any role at the school) see every award; a student sees only their
-- own — never exposed on any listing a peer or parent could see, per spec.
CREATE POLICY "bsa_select" ON public.best_student_awards FOR SELECT USING (
  school_id = current_school_id()
  AND (
    current_user_role() IN ('ADMIN', 'TEACHER')
    OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
  )
);

-- Written only by the nightly cron job (service-role client), never by an
-- interactive role — no INSERT/UPDATE policy is needed since RLS defaults
-- to deny, and the scheduler uses supabase.admin (bypasses RLS by design,
-- same as every other cron job in this codebase).
