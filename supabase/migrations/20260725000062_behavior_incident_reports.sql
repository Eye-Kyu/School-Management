-- ============================================================
-- Behavior incident reports — prefect-submitted, Class-Teacher-reviewed
-- ============================================================
-- Never auto-converted into behaviour_points; a Class Teacher must review
-- and explicitly decide (dismiss, or convert via the existing behaviour_points
-- insert path — no new conversion mechanism needed, that table already
-- accepts TEACHER inserts).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.behavior_incident_reports (
  id                   UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            UUID         NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  reported_by_user_id  UUID         NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  student_id           UUID         NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  category             TEXT         NOT NULL,
  description          TEXT         NOT NULL,
  status               TEXT         NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REVIEWED', 'DISMISSED')),
  reviewed_by_user_id  UUID                  REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  class_teacher_notes  TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS behavior_incident_reports_school_idx  ON public.behavior_incident_reports (school_id);
CREATE INDEX IF NOT EXISTS behavior_incident_reports_student_idx ON public.behavior_incident_reports (student_id);

ALTER TABLE public.behavior_incident_reports ENABLE ROW LEVEL SECURITY;

-- Visible to: the reporter, the reported student's Class Teacher, or Admin.
CREATE POLICY "bir_select" ON public.behavior_incident_reports FOR SELECT
  USING (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR reported_by_user_id = public.current_user_id()
      OR EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
        JOIN public.users u ON u.id = t.user_id
        WHERE s.id = behavior_incident_reports.student_id
          AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
      )
    )
  );

-- Insert: caller must be a STUDENT holding an active prefect record with the
-- matching power enabled — a class prefect may only report students in their
-- own class; a school prefect may report any student in the school.
CREATE POLICY "bir_insert" ON public.behavior_incident_reports FOR INSERT
  WITH CHECK (
    school_id = public.current_school_id()
    AND reported_by_user_id = public.current_user_id()
    AND public.current_user_role() = 'STUDENT'
    AND (
      EXISTS (
        SELECT 1 FROM public.class_prefects cp
        JOIN public.students me ON me.id = cp.student_id
        JOIN public.users u ON u.id = me.user_id
        JOIN public.students target ON target.id = behavior_incident_reports.student_id
        WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
          AND cp.revoked_at IS NULL
          AND target.current_class_id = cp.class_id
          AND EXISTS (
            SELECT 1 FROM public.prefect_powers pp
            WHERE pp.school_id = cp.school_id AND pp.power_code = 'report_behavior_incident' AND pp.enabled = true
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.school_prefects sp
        JOIN public.students me ON me.id = sp.student_id
        JOIN public.users u ON u.id = me.user_id
        WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
          AND sp.revoked_at IS NULL
          AND EXISTS (
            SELECT 1 FROM public.prefect_powers pp
            WHERE pp.school_id = sp.school_id AND pp.power_code = 'report_behavior_incident_school_wide' AND pp.enabled = true
          )
      )
    )
  );

-- Review/dismiss: only the reported student's Class Teacher, or Admin.
CREATE POLICY "bir_update" ON public.behavior_incident_reports FOR UPDATE
  USING (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
        JOIN public.users u ON u.id = t.user_id
        WHERE s.id = behavior_incident_reports.student_id
          AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
      )
    )
  )
  WITH CHECK (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
        JOIN public.users u ON u.id = t.user_id
        WHERE s.id = behavior_incident_reports.student_id
          AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
      )
    )
  );
