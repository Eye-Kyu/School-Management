-- ============================================================
-- School Prefects (Head Boy, Head Girl, Games Captain, etc.)
-- ============================================================
-- Same shape as class_prefects but school-wide, free-text role_title (a
-- school names its own roles), no uniqueness constraint on role_title — a
-- school may have several School Prefects with different titles, and a
-- title may repeat across terms.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.school_prefects (
  id                   UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            UUID         NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  student_id           UUID         NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  role_title           TEXT         NOT NULL,
  term_id              UUID                  REFERENCES public.terms(id)    ON DELETE SET NULL,
  assigned_by_user_id  UUID                  REFERENCES public.users(id)    ON DELETE SET NULL,
  assigned_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at           TIMESTAMPTZ,
  revoked_by_user_id   UUID                  REFERENCES public.users(id)    ON DELETE SET NULL,
  revocation_reason    TEXT
);

CREATE INDEX IF NOT EXISTS school_prefects_school_idx  ON public.school_prefects (school_id);
CREATE INDEX IF NOT EXISTS school_prefects_student_idx ON public.school_prefects (student_id);

ALTER TABLE public.school_prefects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "school_prefects_select" ON public.school_prefects FOR SELECT
  USING (school_id = public.current_school_id());

CREATE POLICY "school_prefects_insert" ON public.school_prefects FOR INSERT
  WITH CHECK (
    school_id = public.current_school_id()
    AND public.current_user_role() = 'ADMIN'
    AND assigned_by_user_id = public.current_user_id()
  );

CREATE POLICY "school_prefects_update" ON public.school_prefects FOR UPDATE
  USING (
    school_id = public.current_school_id()
    AND (public.current_user_role() = 'ADMIN' OR assigned_by_user_id = public.current_user_id())
  )
  WITH CHECK (
    school_id = public.current_school_id()
    AND (public.current_user_role() = 'ADMIN' OR assigned_by_user_id = public.current_user_id())
  );
