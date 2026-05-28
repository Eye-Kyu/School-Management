-- Report card comment store — grades come from the assessments/grades tables
CREATE TABLE IF NOT EXISTS public.student_report_cards (
  id                    UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID         NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  student_id            UUID         NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  term_id               UUID         NOT NULL REFERENCES public.terms(id)    ON DELETE CASCADE,
  class_teacher_comment TEXT,
  head_teacher_comment  TEXT,
  is_published          BOOLEAN      NOT NULL DEFAULT false,
  published_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, term_id)
);

ALTER TABLE public.student_report_cards ENABLE ROW LEVEL SECURITY;

-- Teachers & admins can read/write all in school; students & parents read published ones
CREATE POLICY "rc_admin_teacher" ON public.student_report_cards
  FOR ALL USING (
    school_id = current_school_id()
    AND current_user_role() IN ('ADMIN', 'TEACHER')
  );

CREATE POLICY "rc_student_read" ON public.student_report_cards
  FOR SELECT USING (
    school_id = current_school_id()
    AND is_published = true
    AND (
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
      OR EXISTS (
        SELECT 1 FROM public.guardians g
        JOIN public.students s ON s.id = g.student_id
        WHERE g.user_id = current_user_id() AND s.id = student_id
      )
    )
  );
