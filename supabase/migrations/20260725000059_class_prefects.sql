-- ============================================================
-- Class Prefects
-- ============================================================
-- Supersedes the old classes.prefect_student_id label (added in
-- 20260526000006_class_prefect.sql), which has zero derived power anywhere
-- in the app today — nothing but one attendance-roster badge reads it. That
-- column and its PATCH /classes/:id/prefect endpoint are left in place
-- (never drop a merged migration) but go unused going forward; this table is
-- the new source of truth, with assignment history, term-binding, and
-- revocation the old column never had.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.class_prefects (
  id                   UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            UUID         NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  class_id             UUID         NOT NULL REFERENCES public.classes(id)  ON DELETE CASCADE,
  student_id           UUID         NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  term_id              UUID                  REFERENCES public.terms(id)    ON DELETE SET NULL,
  assigned_by_user_id  UUID                  REFERENCES public.users(id)    ON DELETE SET NULL,
  assigned_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at           TIMESTAMPTZ,
  revoked_by_user_id   UUID                  REFERENCES public.users(id)    ON DELETE SET NULL,
  revocation_reason    TEXT
);

CREATE INDEX IF NOT EXISTS class_prefects_school_idx  ON public.class_prefects (school_id);
CREATE INDEX IF NOT EXISTS class_prefects_student_idx ON public.class_prefects (student_id);

-- One active prefect per class per term. A plain UNIQUE(class_id, term_id)
-- would NOT enforce this for term_id IS NULL rows, since NULL <> NULL in a
-- unique index — every NULL is its own distinct value. COALESCE to a
-- sentinel UUID so every "until revoked" (term_id IS NULL) row competes for
-- the same uniqueness slot as every other NULL row for that class.
CREATE UNIQUE INDEX IF NOT EXISTS class_prefects_one_active_uidx
  ON public.class_prefects (class_id, COALESCE(term_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

ALTER TABLE public.class_prefects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "class_prefects_select" ON public.class_prefects FOR SELECT
  USING (school_id = public.current_school_id());

-- Only the Class Teacher of the target class may assign, and only naming
-- themselves as the assigner (mirrors bp_insert's is_class_teacher_of join
-- shape from 20260723000043_class_teacher_rls.sql).
CREATE POLICY "class_prefects_insert" ON public.class_prefects FOR INSERT
  WITH CHECK (
    school_id = public.current_school_id()
    AND assigned_by_user_id = public.current_user_id()
    AND EXISTS (
      SELECT 1 FROM public.teachers t
      JOIN public.users u ON u.id = t.user_id
      WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
        AND t.is_class_teacher_of = class_prefects.class_id
    )
  );

-- Revoke (the only realistic UPDATE): original assigner, any School Admin,
-- or the current Class Teacher of that class (may differ from who assigned
-- it, if the class teacher changed since).
CREATE POLICY "class_prefects_update" ON public.class_prefects FOR UPDATE
  USING (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR assigned_by_user_id = public.current_user_id()
      OR EXISTS (
        SELECT 1 FROM public.teachers t
        JOIN public.users u ON u.id = t.user_id
        WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
          AND t.is_class_teacher_of = class_prefects.class_id
      )
    )
  )
  WITH CHECK (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR assigned_by_user_id = public.current_user_id()
      OR EXISTS (
        SELECT 1 FROM public.teachers t
        JOIN public.users u ON u.id = t.user_id
        WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
          AND t.is_class_teacher_of = class_prefects.class_id
      )
    )
  );
