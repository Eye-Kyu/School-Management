-- ============================================================
-- Bucket 1, PR 2a — homework_completions grading RLS
-- ============================================================
-- homework_completions previously had no UPDATE policy at all (only
-- SELECT/INSERT/DELETE, all student-facing for the completion tick itself —
-- see 20260526000008_events_homework.sql). Grading needs a new UPDATE path
-- for the teacher who created the homework, the class teacher of the
-- student's class, or an admin.
--
-- Column-level restriction (this policy must only ever be used to touch
-- score/grader_note/graded_at/graded_by_user_id, never completed_at) is not
-- expressible in RLS — Postgres RLS governs row eligibility, not per-column
-- write scope. That's enforced at the application layer instead
-- (HomeworkService.gradeSubmission() only ever writes those four columns,
-- regardless of what a request body contains) — the same approach already
-- used for the BUG-6 notification/conversation read-state cascade.
-- ============================================================

CREATE POLICY "hw_comp_update" ON public.homework_completions FOR UPDATE USING (
  school_id = current_school_id() AND (
    current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.homework_assignments ha
      JOIN public.teachers t ON t.user_id = current_user_id()
      WHERE ha.id = homework_completions.homework_id
        AND (ha.teacher_id = t.id OR t.is_class_teacher_of = ha.class_id)
    )
  )
);

INSERT INTO public._migration_log (filename) VALUES ('20260728000079_homework_completions_grading_rls.sql') ON CONFLICT (filename) DO NOTHING;
