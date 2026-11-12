-- ============================================================
-- qa_update: explicit WITH CHECK so a student can submit their own attempt
-- ============================================================
-- qa_update (20260723000052, restated in 20261112000099) has no WITH CHECK,
-- so Postgres applies its USING expression to the NEW row as well. USING only
-- admits a student's row while submitted_at IS NULL, so the UPDATE that sets
-- submitted_at (the submission itself) is rejected with "new row violates
-- row-level security policy". Found by the live V2 e2e
-- (security-audit-v2.e2e-spec.ts, SA-30). The same condition existed under
-- 052, so student submissions were very likely already failing in production.
--
-- Fix: keep USING exactly as in 099 (a student may only touch an OPEN attempt
-- of their own, before the quiz closes; staff per 099), and add a WITH CHECK
-- that allows the resulting row to be submitted. Grade integrity is unaffected:
-- quiz_attempts_server_score() (099) computes score/max_score and stamps
-- submitted_at for student callers, and once submitted the USING clause blocks
-- any further student update.
--
-- Before/after verification (CLAUDE.md §6):
--   SELECT with_check IS NOT NULL FROM pg_policies WHERE tablename='quiz_attempts' AND policyname='qa_update';
--   BEFORE: false   AFTER: true. Live: security-audit-v2.e2e-spec.ts SA-30 case passes.
-- ============================================================

DROP POLICY IF EXISTS "qa_update" ON public.quiz_attempts;
CREATE POLICY "qa_update" ON public.quiz_attempts FOR UPDATE
  USING (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND (
        EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = quiz_attempts.quiz_id AND q.created_by_id = public.current_user_id())
        OR EXISTS (SELECT 1 FROM public.students s JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
                   WHERE s.id = quiz_attempts.student_id AND t.user_id = public.current_user_id())
      ))
      OR (submitted_at IS NULL
          AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = quiz_attempts.student_id AND s.user_id = public.current_user_id())
          AND EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = quiz_attempts.quiz_id AND (q.closes_at IS NULL OR now() <= q.closes_at)))
    )
  )
  WITH CHECK (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND (
        EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = quiz_attempts.quiz_id AND q.created_by_id = public.current_user_id())
        OR EXISTS (SELECT 1 FROM public.students s JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
                   WHERE s.id = quiz_attempts.student_id AND t.user_id = public.current_user_id())
      ))
      OR (EXISTS (SELECT 1 FROM public.students s WHERE s.id = quiz_attempts.student_id AND s.user_id = public.current_user_id())
          AND EXISTS (SELECT 1 FROM public.quizzes q WHERE q.id = quiz_attempts.quiz_id AND (q.closes_at IS NULL OR now() <= q.closes_at)))
    )
  );

INSERT INTO public._migration_log (filename) VALUES ('20261112000101_quiz_attempts_update_with_check.sql') ON CONFLICT (filename) DO NOTHING;
