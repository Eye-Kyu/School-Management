-- ============================================================
-- behaviour_points / permission_slips: restore the module gate and scope
-- teacher deletes (security audit 2026-11, SA-42 and SA-43)
-- ============================================================
-- SA-43: 20260723000043_class_teacher_rls rewrote bp_insert and ps_insert to
-- add class-teacher rules but dropped the module_enabled() check that
-- 20260721000024_module_enforcement_rls had folded in. With the module
-- switched off, a teacher could still insert behaviour points and an admin
-- could still insert permission slips (neither then readable, since the
-- SELECT policies keep the gate). Both INSERT policies get the gate back.
-- bp_insert also binds a teacher's row to their own teacher_id (the web
-- page and PrefectsService already insert with the caller's own id), so a
-- teacher can no longer attribute points to a colleague.
--
-- SA-42: bp_delete let any TEACHER delete any behaviour point in the school.
-- It now allows ADMIN, the teacher who awarded the point, or the class
-- teacher of the student's current class. No app path deletes points today.
--
-- Unchanged: bp_select (098), ps_delete, ps_select; the class-teacher and
-- subject-teacher rules inside bp_insert/ps_insert are restated verbatim.
--
-- Before/after verification (CLAUDE.md §6), against DIRECT_URL:
--   SELECT policyname, pg_get_expr(polqual, polrelid) ~ 'module_enabled' AS q_gate,
--          pg_get_expr(polwithcheck, polrelid) ~ 'module_enabled' AS c_gate
--   FROM pg_policy p JOIN pg_policies pp ON pp.policyname = p.polname
--   WHERE pp.tablename IN ('behaviour_points','permission_slips') AND pp.cmd IN ('INSERT','DELETE');
--   BEFORE: bp_insert c_gate=f, ps_insert c_gate=f; bp_delete has no teacher scoping.
--   AFTER:  both INSERT c_gate=t; bp_delete references current_teacher_id().
--   Live behaviour: apps/api/test/security-audit-v3.e2e-spec.ts.
-- ============================================================

DROP POLICY IF EXISTS "bp_insert" ON public.behaviour_points;
CREATE POLICY "bp_insert" ON public.behaviour_points FOR INSERT WITH CHECK (
  school_id = public.current_school_id()
  AND public.module_enabled(school_id, 'behaviour_tracking')
  AND (
    public.current_user_role() = 'ADMIN'
    OR (
      public.current_user_role() = 'TEACHER'
      AND teacher_id = public.current_teacher_id()
      AND EXISTS (
        SELECT 1
        FROM public.teachers t
        JOIN public.users u ON u.id = t.user_id
        JOIN public.students s ON s.id = behaviour_points.student_id
        WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
          AND (
            t.is_class_teacher_of = s.current_class_id
            OR EXISTS (SELECT 1 FROM public.subject_assignments sa
                       WHERE sa.teacher_id = t.id AND sa.class_id = s.current_class_id)
          )
      )
    )
  )
);

DROP POLICY IF EXISTS "bp_delete" ON public.behaviour_points;
CREATE POLICY "bp_delete" ON public.behaviour_points FOR DELETE USING (
  school_id = public.current_school_id()
  AND public.module_enabled(school_id, 'behaviour_tracking')
  AND (
    public.current_user_role() = 'ADMIN'
    OR (
      public.current_user_role() = 'TEACHER'
      AND (
        teacher_id = public.current_teacher_id()
        OR EXISTS (
          SELECT 1 FROM public.students s
          JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
          WHERE s.id = behaviour_points.student_id
            AND s.current_class_id IS NOT NULL
            AND t.id = public.current_teacher_id()
        )
      )
    )
  )
);

DROP POLICY IF EXISTS "ps_insert" ON public.permission_slips;
CREATE POLICY "ps_insert" ON public.permission_slips FOR INSERT WITH CHECK (
  school_id = public.current_school_id()
  AND public.module_enabled(school_id, 'permission_slips')
  AND (
    public.current_user_role() = 'ADMIN'
    OR (
      public.current_user_role() = 'TEACHER'
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

INSERT INTO public._migration_log (filename) VALUES ('20261112000102_behaviour_and_slip_policies_scope_and_module_gate.sql') ON CONFLICT (filename) DO NOTHING;
