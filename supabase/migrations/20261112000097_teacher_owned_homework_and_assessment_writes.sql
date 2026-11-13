-- ============================================================
-- SA-24 / SA-17: bind teacher writes to the homework/assessment they own
-- ============================================================
-- SA-24: homework_update / homework_delete (20260526000008) allowed ANY
-- teacher in the school, and HomeworkService.remove() did no ownership check.
-- Any teacher could delete another teacher's homework, cascading its graded
-- completions.
--
-- SA-17: assess_update / assess_delete / grade_insert / grade_update
-- (20260527000012) also allowed any teacher in the school. Migration 054 only
-- tightened the SELECT side, so a teacher who can see a class's assessment
-- (e.g. its class teacher) could overwrite scores on, or delete, another
-- subject's DIRECT assessment. AssessmentsService.create() already requires a
-- subject_assignments row; the write paths did not repeat it.
--
-- New rule (ADMIN unchanged). A TEACHER may write a homework / assessment /
-- its grades only when they own it (teacher_id = their teachers row) or hold
-- a subject_assignments row for that exact class + subject. Inserts by a
-- TEACHER must name themselves as teacher_id.
--
-- SECURITY DEFINER cascades (write_linked_grade / _write_linked_grade_internal,
-- record_quiz_grade) run as the function owner, which bypasses RLS, so linked
-- grade writes are unaffected.
--
-- current_teacher_id() is a NEW helper name (no overload of an existing
-- function; CLAUDE.md §6). It follows the current_user_id() pattern from _047.
--
-- Before/after verification (CLAUDE.md §6), against DIRECT_URL:
--   SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename IN ('homework_assignments','assessments','grades') AND cmd <> 'SELECT';
--   BEFORE: every write policy is "school_id = current_school_id() AND role IN (TEACHER, ADMIN)".
--   AFTER:  TEACHER branches reference current_teacher_id(). Live behaviour is
--   covered by apps/api/test/security-audit-v2.e2e-spec.ts.
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_teacher_id()
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id FROM public.teachers t
  WHERE t.user_id = public.current_user_id()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_teacher_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_teacher_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_teacher_id() TO authenticated;

-- ── homework_assignments (SA-24) ────────────────────────────────────────────
DROP POLICY IF EXISTS "homework_insert" ON public.homework_assignments;
CREATE POLICY "homework_insert" ON public.homework_assignments FOR INSERT WITH CHECK (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND teacher_id = public.current_teacher_id())
  )
);

DROP POLICY IF EXISTS "homework_update" ON public.homework_assignments;
CREATE POLICY "homework_update" ON public.homework_assignments FOR UPDATE
  USING (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND teacher_id = public.current_teacher_id())
    )
  )
  WITH CHECK (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND teacher_id = public.current_teacher_id())
    )
  );

DROP POLICY IF EXISTS "homework_delete" ON public.homework_assignments;
CREATE POLICY "homework_delete" ON public.homework_assignments FOR DELETE USING (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND teacher_id = public.current_teacher_id())
  )
);

-- ── assessments (SA-17) ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "assess_insert" ON public.assessments;
CREATE POLICY "assess_insert" ON public.assessments FOR INSERT WITH CHECK (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND teacher_id = public.current_teacher_id())
  )
);

DROP POLICY IF EXISTS "assess_update" ON public.assessments;
CREATE POLICY "assess_update" ON public.assessments FOR UPDATE
  USING (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND (
        teacher_id = public.current_teacher_id()
        OR EXISTS (SELECT 1 FROM public.subject_assignments sa
                   WHERE sa.teacher_id = public.current_teacher_id()
                     AND sa.class_id = assessments.class_id AND sa.subject_id = assessments.subject_id)
      ))
    )
  )
  WITH CHECK (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND (
        teacher_id = public.current_teacher_id()
        OR EXISTS (SELECT 1 FROM public.subject_assignments sa
                   WHERE sa.teacher_id = public.current_teacher_id()
                     AND sa.class_id = assessments.class_id AND sa.subject_id = assessments.subject_id)
      ))
    )
  );

DROP POLICY IF EXISTS "assess_delete" ON public.assessments;
CREATE POLICY "assess_delete" ON public.assessments FOR DELETE USING (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND (
      teacher_id = public.current_teacher_id()
      OR EXISTS (SELECT 1 FROM public.subject_assignments sa
                 WHERE sa.teacher_id = public.current_teacher_id()
                   AND sa.class_id = assessments.class_id AND sa.subject_id = assessments.subject_id)
    ))
  )
);

-- ── grades (SA-17) ──────────────────────────────────────────────────────────
-- The grade's assessment must be one the teacher may write (same rule as above).
DROP POLICY IF EXISTS "grade_insert" ON public.grades;
CREATE POLICY "grade_insert" ON public.grades FOR INSERT WITH CHECK (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND EXISTS (
      SELECT 1 FROM public.assessments a
      WHERE a.id = grades.assessment_id AND a.school_id = grades.school_id AND (
        a.teacher_id = public.current_teacher_id()
        OR EXISTS (SELECT 1 FROM public.subject_assignments sa
                   WHERE sa.teacher_id = public.current_teacher_id()
                     AND sa.class_id = a.class_id AND sa.subject_id = a.subject_id)
      )
    ))
  )
);

DROP POLICY IF EXISTS "grade_update" ON public.grades;
CREATE POLICY "grade_update" ON public.grades FOR UPDATE
  USING (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = grades.assessment_id AND a.school_id = grades.school_id AND (
          a.teacher_id = public.current_teacher_id()
          OR EXISTS (SELECT 1 FROM public.subject_assignments sa
                     WHERE sa.teacher_id = public.current_teacher_id()
                       AND sa.class_id = a.class_id AND sa.subject_id = a.subject_id)
        )
      ))
    )
  )
  WITH CHECK (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = grades.assessment_id AND a.school_id = grades.school_id AND (
          a.teacher_id = public.current_teacher_id()
          OR EXISTS (SELECT 1 FROM public.subject_assignments sa
                     WHERE sa.teacher_id = public.current_teacher_id()
                       AND sa.class_id = a.class_id AND sa.subject_id = a.subject_id)
        )
      ))
    )
  );

INSERT INTO public._migration_log (filename) VALUES ('20261112000097_teacher_owned_homework_and_assessment_writes.sql') ON CONFLICT (filename) DO NOTHING;
