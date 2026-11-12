-- ============================================================
-- Security audit 2026-11, V2: quiz integrity and authoring ownership
-- ============================================================
--   SA-30  quiz_attempts.score/max_score came from the student's browser and
--          record_quiz_grade() copied them into the gradebook. The browser
--          never even loaded the answer key, so MCQ auto-grading always gave
--          0; a student could PATCH any score instead.
--   SA-31  qq_select handed students the full quiz_questions row, including
--          correct_option_id (the answer key), before submitting.
--   SA-15  quiz / quiz_questions / assignments / submissions write policies
--          authorized on school + role only. Any teacher could edit or delete
--          another teacher's quizzes, answer keys and assignments, or rewrite
--          created_by_id to take over creator-gated actions.
--
-- Design:
--   * quiz_attempts_server_score() (BEFORE INSERT/UPDATE): for STUDENT
--     callers the score is never client-supplied. While the attempt is open
--     score/max_score stay NULL. On submission they are computed from the
--     answer key (MCQ points, plus total points). Short-answer marks are still
--     added later by teachers, whose updates pass through untouched.
--   * Column privilege: SELECT on quiz_questions.correct_option_id is revoked
--     from anon/authenticated. Staff (and a student reviewing a SUBMITTED
--     attempt) read keys through quiz_answer_keys(quiz_id), a SECURITY DEFINER
--     accessor with its own authorization.
--   * Authoring: TEACHER writes require created_by_id = current_user_id(), for
--     quizzes/assignments and for questions via the parent quiz. Grading
--     updates (submissions, quiz_attempts) are limited to the creator or a
--     teacher of the class. A column allowlist stops a grading teacher
--     rewriting a student's submitted content. ADMIN is unchanged.
--
-- App changes shipped with this migration: QuizTaker no longer computes or
-- sends a score; the teacher quiz page, QuizBuilderClient and the student
-- review page read keys via quiz_answer_keys().
--
-- Before/after verification (CLAUDE.md §6): policies captured before applying
-- (before-v2b snapshot). After: pg_policies shows created_by_id predicates,
-- has_column_privilege('authenticated','public.quiz_questions','correct_option_id','SELECT') = false.
-- Live behaviour: apps/api/test/security-audit-v2.e2e-spec.ts.
-- ============================================================

-- ── SA-30: server-side quiz scoring ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_attempts_server_score()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;                       -- service role / direct
  IF public.current_user_role() IN ('TEACHER', 'ADMIN') THEN RETURN NEW; END IF; -- staff grading

  -- Any other caller (STUDENT): never trust a client-supplied score.
  IF TG_OP = 'UPDATE' AND OLD.submitted_at IS NOT NULL THEN
    NEW.score := OLD.score;
    NEW.max_score := OLD.max_score;
    NEW.submitted_at := OLD.submitted_at;
    NEW.answers := OLD.answers;
    RETURN NEW;
  END IF;

  IF NEW.submitted_at IS NULL THEN
    NEW.score := NULL;
    NEW.max_score := NULL;
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(SUM(q.points) FILTER (
      WHERE q.kind = 'MCQ' AND q.correct_option_id IS NOT NULL
        AND (COALESCE(NEW.answers, '{}'::jsonb) ->> q.id::text) = q.correct_option_id
    ), 0),
    COALESCE(SUM(q.points), 0)
  INTO NEW.score, NEW.max_score
  FROM public.quiz_questions q
  WHERE q.quiz_id = NEW.quiz_id;

  NEW.submitted_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quiz_attempts_server_score ON public.quiz_attempts;
CREATE TRIGGER quiz_attempts_server_score
  BEFORE INSERT OR UPDATE ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public.quiz_attempts_server_score();

-- ── SA-31: answer key is not readable through PostgREST ─────────────────────
REVOKE SELECT ON public.quiz_questions FROM anon, authenticated;
GRANT SELECT (id, quiz_id, school_id, position, kind, body, options, points) ON public.quiz_questions TO authenticated;

CREATE OR REPLACE FUNCTION public.quiz_answer_keys(p_quiz_id uuid)
  RETURNS TABLE (question_id uuid, correct_option_id text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_school uuid;
BEGIN
  SELECT school_id INTO v_school FROM public.quizzes WHERE id = p_quiz_id;
  IF v_school IS NULL OR v_school IS DISTINCT FROM public.current_school_id() THEN
    RAISE EXCEPTION 'Quiz not found';
  END IF;

  IF NOT (
    public.current_user_role() IN ('TEACHER', 'ADMIN')
    OR EXISTS (
      SELECT 1 FROM public.quiz_attempts qa JOIN public.students s ON s.id = qa.student_id
      WHERE qa.quiz_id = p_quiz_id AND qa.submitted_at IS NOT NULL AND s.user_id = public.current_user_id()
    )
  ) THEN
    RAISE EXCEPTION 'Answer keys are available after you submit';
  END IF;

  RETURN QUERY SELECT q.id, q.correct_option_id FROM public.quiz_questions q WHERE q.quiz_id = p_quiz_id;
END;
$$;
REVOKE ALL ON FUNCTION public.quiz_answer_keys(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quiz_answer_keys(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.quiz_answer_keys(uuid) TO authenticated;

-- ── SA-15: quizzes ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "quiz_insert" ON public.quizzes;
CREATE POLICY "quiz_insert" ON public.quizzes FOR INSERT WITH CHECK (
  school_id = public.current_school_id() AND public.module_enabled(school_id, 'quizzes') AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND created_by_id = public.current_user_id())
  )
);
DROP POLICY IF EXISTS "quiz_update" ON public.quizzes;
CREATE POLICY "quiz_update" ON public.quizzes FOR UPDATE
  USING (
    school_id = public.current_school_id() AND public.module_enabled(school_id, 'quizzes') AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND created_by_id = public.current_user_id())
    )
  )
  WITH CHECK (
    school_id = public.current_school_id() AND public.module_enabled(school_id, 'quizzes') AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND created_by_id = public.current_user_id())
    )
  );
DROP POLICY IF EXISTS "quiz_delete" ON public.quizzes;
CREATE POLICY "quiz_delete" ON public.quizzes FOR DELETE USING (
  school_id = public.current_school_id() AND public.module_enabled(school_id, 'quizzes') AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND created_by_id = public.current_user_id())
  )
);

-- ── SA-15: quiz_questions (via the parent quiz's creator) ───────────────────
DROP POLICY IF EXISTS "qq_insert" ON public.quiz_questions;
CREATE POLICY "qq_insert" ON public.quiz_questions FOR INSERT WITH CHECK (
  school_id = public.current_school_id() AND public.module_enabled(school_id, 'quizzes') AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND EXISTS (
      SELECT 1 FROM public.quizzes q WHERE q.id = quiz_questions.quiz_id AND q.created_by_id = public.current_user_id()))
  )
);
DROP POLICY IF EXISTS "qq_update" ON public.quiz_questions;
CREATE POLICY "qq_update" ON public.quiz_questions FOR UPDATE
  USING (
    school_id = public.current_school_id() AND public.module_enabled(school_id, 'quizzes') AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND EXISTS (
        SELECT 1 FROM public.quizzes q WHERE q.id = quiz_questions.quiz_id AND q.created_by_id = public.current_user_id()))
    )
  )
  WITH CHECK (
    school_id = public.current_school_id() AND public.module_enabled(school_id, 'quizzes') AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND EXISTS (
        SELECT 1 FROM public.quizzes q WHERE q.id = quiz_questions.quiz_id AND q.created_by_id = public.current_user_id()))
    )
  );
DROP POLICY IF EXISTS "qq_delete" ON public.quiz_questions;
CREATE POLICY "qq_delete" ON public.quiz_questions FOR DELETE USING (
  school_id = public.current_school_id() AND public.module_enabled(school_id, 'quizzes') AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND EXISTS (
      SELECT 1 FROM public.quizzes q WHERE q.id = quiz_questions.quiz_id AND q.created_by_id = public.current_user_id()))
  )
);

-- ── SA-15: quiz_attempts teacher grading limited to creator / class teacher ─
DROP POLICY IF EXISTS "qa_update" ON public.quiz_attempts;
CREATE POLICY "qa_update" ON public.quiz_attempts FOR UPDATE USING (
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
);

-- ── SA-15: assignments ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "assign_insert" ON public.assignments;
CREATE POLICY "assign_insert" ON public.assignments FOR INSERT WITH CHECK (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND created_by_id = public.current_user_id())
  )
);
DROP POLICY IF EXISTS "assign_update" ON public.assignments;
CREATE POLICY "assign_update" ON public.assignments FOR UPDATE
  USING (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND created_by_id = public.current_user_id())
    )
  )
  WITH CHECK (
    school_id = public.current_school_id() AND (
      public.current_user_role() = 'ADMIN'
      OR (public.current_user_role() = 'TEACHER' AND created_by_id = public.current_user_id())
    )
  );
DROP POLICY IF EXISTS "assign_delete" ON public.assignments;
CREATE POLICY "assign_delete" ON public.assignments FOR DELETE USING (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND created_by_id = public.current_user_id())
  )
);

-- ── SA-15: submissions grading (creator or a teacher of the class) ──────────
DROP POLICY IF EXISTS "sub_update" ON public.submissions;
CREATE POLICY "sub_update" ON public.submissions FOR UPDATE USING (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'TEACHER' AND EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id = submissions.assignment_id AND (
        a.created_by_id = public.current_user_id()
        OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = public.current_teacher_id() AND t.is_class_teacher_of = a.class_id)
        OR EXISTS (SELECT 1 FROM public.subject_assignments sa WHERE sa.teacher_id = public.current_teacher_id() AND sa.class_id = a.class_id)
      )
    ))
  )
);
-- A grading teacher may set the grade, not rewrite what the student submitted.
DROP TRIGGER IF EXISTS submissions_update_allowlist ON public.submissions;
CREATE TRIGGER submissions_update_allowlist BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_update_column_allowlist('grade_score,grade_comment,graded_at,graded_by_id', 'ADMIN');

INSERT INTO public._migration_log (filename) VALUES ('20261112000099_quiz_server_grading_and_authoring_binding.sql') ON CONFLICT (filename) DO NOTHING;
