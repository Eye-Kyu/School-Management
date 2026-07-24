-- ============================================================
-- Security fix: gradebook SELECT policies were school-wide only
-- ============================================================
-- assess_select / assign_select / grade_select / sub_select (added in
-- 20260527000012_gradebook.sql) only ever checked `school_id = current_school_id()`.
-- Their own inline comments already said "students see their own; parents see
-- their child's" / "students/parents in class read" — the SQL never implemented
-- that. Any authenticated STUDENT, PARENT, or TEACHER could read every other
-- student's grades/assessments/assignments/submissions in the school directly
-- via the browser Supabase client (RLS is the only enforcement layer for these
-- tables — the app's own .eq('student_id', ...) filters are UI choices, not a
-- security boundary). Worse: apps/api/src/assessments/assessments.service.ts
-- runs entirely on this.supabase.forUser(accessToken) with little-to-no
-- app-layer scoping of its own (getScores/upsertScores/deleteAssessment trust
-- RLS completely) — this policy is the ONLY protection for that whole module.
--
-- TEACHER visibility mirrors the exact two-way check already established for
-- bp_insert in 20260723000043_class_teacher_rls.sql: a class teacher
-- (teachers.is_class_teacher_of) sees their whole class across every subject
-- (needed by assessments.service.ts's list(classId)/exportClassReport, which
-- explicitly support a class-teacher-only caller with no subject_assignments
-- row — see the "no subject context" test in cross-tenant.e2e-spec.ts), and a
-- subject teacher sees only the classes they have a subject_assignments row
-- for. STUDENT/PARENT get the assessments/assignments class_id patterns
-- already used by attendance_records_select/fee_balances_select.
-- ============================================================

DROP POLICY IF EXISTS "assess_select" ON public.assessments;
CREATE POLICY "assess_select" ON public.assessments FOR SELECT USING (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND EXISTS (
      SELECT 1 FROM public.teachers t JOIN public.users u ON u.id = t.user_id
      WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
        AND (
          t.is_class_teacher_of = assessments.class_id
          OR EXISTS (SELECT 1 FROM public.subject_assignments sa WHERE sa.teacher_id = t.id AND sa.class_id = assessments.class_id)
        )
    ))
    OR (public.current_user_role() = 'STUDENT' AND class_id = (
      SELECT s.current_class_id FROM public.students s
      JOIN public.users u ON u.id = s.user_id
      WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL LIMIT 1
    ))
    OR (public.current_user_role() = 'PARENT' AND class_id IN (
      SELECT current_class_id FROM public.students WHERE id = ANY(public.guardian_student_ids())
    ))
  )
);

DROP POLICY IF EXISTS "assign_select" ON public.assignments;
CREATE POLICY "assign_select" ON public.assignments FOR SELECT USING (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND EXISTS (
      SELECT 1 FROM public.teachers t JOIN public.users u ON u.id = t.user_id
      WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
        AND (
          t.is_class_teacher_of = assignments.class_id
          OR EXISTS (SELECT 1 FROM public.subject_assignments sa WHERE sa.teacher_id = t.id AND sa.class_id = assignments.class_id)
        )
    ))
    OR (public.current_user_role() = 'STUDENT' AND class_id = (
      SELECT s.current_class_id FROM public.students s
      JOIN public.users u ON u.id = s.user_id
      WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL LIMIT 1
    ))
    OR (public.current_user_role() = 'PARENT' AND class_id IN (
      SELECT current_class_id FROM public.students WHERE id = ANY(public.guardian_student_ids())
    ))
  )
);

DROP POLICY IF EXISTS "grade_select" ON public.grades;
CREATE POLICY "grade_select" ON public.grades FOR SELECT USING (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND EXISTS (
      SELECT 1 FROM public.assessments a WHERE a.id = grades.assessment_id AND (
        a.class_id = (
          SELECT t.is_class_teacher_of FROM public.teachers t JOIN public.users u ON u.id = t.user_id
          WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL LIMIT 1
        )
        OR EXISTS (
          SELECT 1 FROM public.subject_assignments sa
          JOIN public.teachers t ON t.id = sa.teacher_id
          JOIN public.users u ON u.id = t.user_id
          WHERE sa.class_id = a.class_id AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
        )
      )
    ))
    OR (public.current_user_role() = 'STUDENT' AND student_id = (
      SELECT s.id FROM public.students s
      JOIN public.users u ON u.id = s.user_id
      WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL LIMIT 1
    ))
    OR (public.current_user_role() = 'PARENT' AND student_id = ANY(public.guardian_student_ids()))
  )
);

DROP POLICY IF EXISTS "sub_select" ON public.submissions;
CREATE POLICY "sub_select" ON public.submissions FOR SELECT USING (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND EXISTS (
      SELECT 1 FROM public.assignments asg WHERE asg.id = submissions.assignment_id AND (
        asg.class_id = (
          SELECT t.is_class_teacher_of FROM public.teachers t JOIN public.users u ON u.id = t.user_id
          WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL LIMIT 1
        )
        OR EXISTS (
          SELECT 1 FROM public.subject_assignments sa
          JOIN public.teachers t ON t.id = sa.teacher_id
          JOIN public.users u ON u.id = t.user_id
          WHERE sa.class_id = asg.class_id AND u.auth_id = auth.uid() AND u.deleted_at IS NULL
        )
      )
    ))
    OR (public.current_user_role() = 'STUDENT' AND student_id = (
      SELECT s.id FROM public.students s
      JOIN public.users u ON u.id = s.user_id
      WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL LIMIT 1
    ))
    OR (public.current_user_role() = 'PARENT' AND student_id = ANY(public.guardian_student_ids()))
  )
);

-- ============================================================
-- Safe aggregate for "class average" comparisons
-- ============================================================
-- student/analytics/page.tsx (and teacher/analytics/page.tsx's class-average
-- bars) previously computed a "class average" by fetching every classmate's
-- raw `grades` row and averaging client-side — a read the tightened
-- grade_select policy above now correctly blocks for STUDENT/PARENT. Rather
-- than let that silently return zero rows (and render a misleading "class
-- average" equal to the student's own score), this function returns only the
-- aggregate, never raw per-student rows, so it doesn't reopen the leak.
CREATE OR REPLACE FUNCTION public.class_average_scores(p_assessment_ids uuid[])
  RETURNS TABLE(assessment_id uuid, avg_score numeric, student_count int)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT g.assessment_id, AVG(g.score), COUNT(*)::int
  FROM public.grades g
  JOIN public.assessments a ON a.id = g.assessment_id
  WHERE g.assessment_id = ANY(p_assessment_ids)
    AND a.school_id = public.current_school_id()
    AND g.score IS NOT NULL
  GROUP BY g.assessment_id;
$$;

REVOKE ALL ON FUNCTION public.class_average_scores(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.class_average_scores(uuid[]) TO authenticated;
