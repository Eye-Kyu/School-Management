-- ============================================================
-- Attendance re-marking approval workflow
-- ============================================================
-- attendance_records itself gets no new column — the gate lives entirely in
-- these two new tables plus the API's mark() method, not a DB trigger.
-- Rationale: apps/api/src/attendance/attendance.controller.ts's POST /attendance
-- is the ONLY write path to attendance_records from this app (confirmed —
-- the frontend never calls Supabase directly for writes here, only reads),
-- so an unbypassable API-layer check gives full coverage without the extra
-- complexity and prior-incident risk of a trigger doing cross-table lookups
-- on an RLS-enabled table (see 20260723000048_fix_department_soft_delete_trigger.sql).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_remark_requests (
  id                   UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            UUID         NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  class_id             UUID         NOT NULL REFERENCES public.classes(id)  ON DELETE CASCADE,
  date                 DATE         NOT NULL,
  requested_by_user_id UUID         NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  reason               TEXT         NOT NULL,
  status               TEXT         NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'DENIED')),
  reviewed_by_user_id  UUID                  REFERENCES public.users(id)    ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  denial_reason        TEXT,
  applied_at           TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS attendance_remark_requests_school_idx ON public.attendance_remark_requests (school_id);
CREATE INDEX IF NOT EXISTS attendance_remark_requests_class_date_idx ON public.attendance_remark_requests (class_id, date);
CREATE INDEX IF NOT EXISTS attendance_remark_requests_requester_idx ON public.attendance_remark_requests (requested_by_user_id);

CREATE TABLE IF NOT EXISTS public.attendance_remark_request_items (
  id               UUID  NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID  NOT NULL REFERENCES public.attendance_remark_requests(id) ON DELETE CASCADE,
  student_id       UUID  NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  current_status   TEXT  NOT NULL,
  proposed_status  TEXT  NOT NULL,
  proposed_note    TEXT
);

CREATE INDEX IF NOT EXISTS attendance_remark_request_items_request_idx ON public.attendance_remark_request_items (request_id);

ALTER TABLE public.attendance_remark_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_remark_request_items  ENABLE ROW LEVEL SECURITY;

-- Teacher sees their own requests; the Department Head they were routed to
-- sees requests from teachers in their department; Admin sees everything at
-- their school. "Routed to them" is resolved via the requesting teacher's
-- own department_id -> that department's department_head_user_id — the same
-- fallback-to-admin semantics the API enforces are mirrored here so a
-- Department-Head-less teacher's request is only independently visible to
-- Admin, never to nobody.
CREATE POLICY "arr_select" ON public.attendance_remark_requests FOR SELECT
  USING (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR requested_by_user_id = public.current_user_id()
      OR EXISTS (
        SELECT 1 FROM public.teachers requester
        JOIN public.departments dept ON dept.id = requester.department_id
        WHERE requester.user_id = attendance_remark_requests.requested_by_user_id
          AND dept.department_head_user_id = public.current_user_id()
      )
    )
  );

CREATE POLICY "arr_insert" ON public.attendance_remark_requests FOR INSERT
  WITH CHECK (
    school_id = public.current_school_id()
    AND requested_by_user_id = public.current_user_id()
    AND public.current_user_role() = 'TEACHER'
  );

-- Review (approve/deny): the Department Head routed to it, or Admin. Never
-- the requester themselves — self-approval is explicitly excluded.
CREATE POLICY "arr_update" ON public.attendance_remark_requests FOR UPDATE
  USING (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR EXISTS (
        SELECT 1 FROM public.teachers requester
        JOIN public.departments dept ON dept.id = requester.department_id
        WHERE requester.user_id = attendance_remark_requests.requested_by_user_id
          AND dept.department_head_user_id = public.current_user_id()
      )
    )
  )
  WITH CHECK (
    school_id = public.current_school_id()
    AND (
      public.current_user_role() = 'ADMIN'
      OR EXISTS (
        SELECT 1 FROM public.teachers requester
        JOIN public.departments dept ON dept.id = requester.department_id
        WHERE requester.user_id = attendance_remark_requests.requested_by_user_id
          AND dept.department_head_user_id = public.current_user_id()
      )
    )
  );

CREATE POLICY "arri_select" ON public.attendance_remark_request_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.attendance_remark_requests r WHERE r.id = attendance_remark_request_items.request_id));

CREATE POLICY "arri_insert" ON public.attendance_remark_request_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendance_remark_requests r
      WHERE r.id = attendance_remark_request_items.request_id AND r.requested_by_user_id = public.current_user_id()
    )
  );
