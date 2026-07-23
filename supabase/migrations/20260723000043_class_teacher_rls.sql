-- ============================================================
-- Class Teacher powers — RLS for permission slips + behaviour points
-- ============================================================

-- ── Permission slips: class teacher may create a CLASS-scoped slip for
-- their own class (never SCHOOL_WIDE — that stays admin-only) ──
DROP POLICY IF EXISTS "ps_insert" ON public.permission_slips;
CREATE POLICY "ps_insert" ON public.permission_slips FOR INSERT WITH CHECK (
  school_id = current_school_id()
  AND (
    current_user_role() = 'ADMIN'
    OR (
      current_user_role() = 'TEACHER'
      AND audience = 'CLASS'
      AND target_class_id IN (
        SELECT t.is_class_teacher_of
        FROM public.teachers t
        JOIN public.users u ON u.id = t.user_id
        WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL AND t.is_class_teacher_of IS NOT NULL
      )
    )
  )
);

-- ── Behaviour points: previously any TEACHER/ADMIN could mark a point for
-- any student in the school, with no class/subject scoping at all. This
-- introduces real scoping for the first time — a subject teacher must have
-- a subject_assignments row for the student's class; a class teacher (their
-- "no subject context needed" power) or admin is unrestricted. ──
DROP POLICY IF EXISTS "bp_insert" ON public.behaviour_points;
CREATE POLICY "bp_insert" ON public.behaviour_points FOR INSERT WITH CHECK (
  school_id = current_school_id()
  AND (
    current_user_role() = 'ADMIN'
    OR (
      current_user_role() = 'TEACHER'
      AND EXISTS (
        SELECT 1
        FROM public.teachers t
        JOIN public.users u ON u.id = t.user_id
        JOIN public.students s ON s.id = student_id
        WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
          AND (
            t.is_class_teacher_of = s.current_class_id
            OR EXISTS (
              SELECT 1 FROM public.subject_assignments sa
              WHERE sa.teacher_id = t.id AND sa.class_id = s.current_class_id
            )
          )
      )
    )
  )
);
