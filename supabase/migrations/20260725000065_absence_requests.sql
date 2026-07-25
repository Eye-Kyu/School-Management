-- ============================================================
-- Approved absence requests -> auto-EXCUSED attendance
-- ============================================================
-- A parent submits a date-range absence request. School Admin OR the
-- student's Class Teacher can approve/deny (either one, not both required).
-- On approval, every day in [start_date, end_date] is overlaid as EXCUSED
-- in that student's attendance (see AttendanceService.roster()/mark()) —
-- no attendance_records rows are written for these dates; the overlay is
-- computed at read time and direct-write attempts are rejected + audited
-- (attendance.mark() checks absence_requests before allowing a status
-- other than EXCUSED, per the app-layer-gate convention already
-- established for the re-marking workflow in
-- 20260725000064_attendance_remark_requests.sql).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.absence_requests (
  id                   UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            UUID         NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  student_id           UUID         NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  requested_by_user_id UUID         NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  start_date           DATE         NOT NULL,
  end_date             DATE         NOT NULL,
  reason               TEXT         NOT NULL,
  status               TEXT         NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'DENIED')),
  reviewed_by_user_id  UUID                  REFERENCES public.users(id)    ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  denial_reason        TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT absence_requests_date_range_chk CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS absence_requests_school_idx  ON public.absence_requests (school_id);
CREATE INDEX IF NOT EXISTS absence_requests_student_idx ON public.absence_requests (student_id);
CREATE INDEX IF NOT EXISTS absence_requests_range_idx   ON public.absence_requests (student_id, start_date, end_date) WHERE status = 'APPROVED';

ALTER TABLE public.absence_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: Admin, the requesting parent, the student's current Class Teacher
-- (an eligible approver), or any subject teacher assigned to the student's
-- current class — the same visibility boundary attendance_records itself
-- already uses, so a subject teacher can render the "Approved absence"
-- overlay/badge on their own attendance roster (they can already see the
-- student was EXCUSED that day; this just surfaces why). Review (UPDATE)
-- stays narrower — see below.
CREATE POLICY "absence_requests_select" ON public.absence_requests FOR SELECT
  USING (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR requested_by_user_id = public.current_user_id()
      OR EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
        JOIN public.users u ON u.id = t.user_id
        WHERE s.id = absence_requests.student_id
          AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.subject_assignments sa ON sa.class_id = s.current_class_id
        JOIN public.teachers t ON t.id = sa.teacher_id
        JOIN public.users u ON u.id = t.user_id
        WHERE s.id = absence_requests.student_id
          AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
      )
    )
  );

-- INSERT: a parent, for one of their own linked children only.
CREATE POLICY "absence_requests_insert" ON public.absence_requests FOR INSERT
  WITH CHECK (
    school_id = public.current_school_id()
    AND requested_by_user_id = public.current_user_id()
    AND public.current_user_role() = 'PARENT'
    AND student_id = ANY(public.guardian_student_ids())
  );

-- UPDATE (review): Admin or the student's Class Teacher — never the
-- requesting parent.
CREATE POLICY "absence_requests_update" ON public.absence_requests FOR UPDATE
  USING (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR EXISTS (
        SELECT 1 FROM public.students s
        JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
        JOIN public.users u ON u.id = t.user_id
        WHERE s.id = absence_requests.student_id
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
        WHERE s.id = absence_requests.student_id
          AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
      )
    )
  );
