-- ============================================================
-- Bucket 1, PR 2a — quiz grade cascade infrastructure
-- ============================================================
-- Infrastructure only: this function is not called from any live quiz
-- submission flow yet (QuizTaker.tsx is untouched by this PR) — that wiring,
-- plus the score-normalization formula, belongs to B1-2b once the
-- assessments.source_type/source_id linking columns exist.
--
-- Why a SECURITY DEFINER function rather than a NestJS endpoint or a
-- widened grade_insert/grade_update RLS policy: grade_insert/grade_update
-- only allow TEACHER/ADMIN — a STUDENT (who triggers MCQ auto-grading at
-- quiz submission) can never satisfy that policy. A NestJS endpoint using
-- forUser(accessToken) would hit the exact same wall (NestJS doesn't bypass
-- RLS by itself), and widening the RLS policy itself can't be scoped safely
-- within this PR — without B1-2b's source_type/source_id columns, there's no
-- way for an RLS predicate to verify "this assessment is actually linked to
-- a quiz I attempted," only "this is my own student row," which would let a
-- student write an arbitrary grade for themselves on ANY assessment (a real
-- self-grading hole). This function keeps all validation (attempt ownership,
-- submission state, school match) inside one auditable body and never grants
-- STUDENT table-level write access to grades at all — matching how every
-- other "let a role reach something RLS would otherwise block" case in this
-- codebase is solved (class_average_scores(), an aggregate-only, read-only
-- precedent) rather than a new, broader write policy.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_quiz_grade(p_quiz_attempt_id uuid, p_assessment_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempt   RECORD;
  v_assess    RECORD;
  v_caller_id uuid := public.current_user_id();
  v_role      text := public.current_user_role();
  v_grade_id  uuid;
BEGIN
  SELECT qa.*, s.user_id AS student_user_id, s.school_id AS attempt_school_id INTO v_attempt
    FROM public.quiz_attempts qa
    JOIN public.students s ON s.id = qa.student_id
    WHERE qa.id = p_quiz_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quiz attempt not found';
  END IF;

  IF v_attempt.submitted_at IS NULL THEN
    RAISE EXCEPTION 'Quiz attempt not yet submitted';
  END IF;

  IF NOT (v_attempt.student_user_id = v_caller_id OR v_role IN ('TEACHER', 'ADMIN')) THEN
    RAISE EXCEPTION 'Not authorized to record this grade';
  END IF;

  SELECT * INTO v_assess FROM public.assessments WHERE id = p_assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assessment not found';
  END IF;

  IF v_assess.school_id != v_attempt.attempt_school_id THEN
    RAISE EXCEPTION 'Assessment and quiz attempt are in different schools';
  END IF;

  -- Idempotent via grades' own existing UNIQUE(assessment_id, student_id) —
  -- reuses the same upsert idiom already used by AssessmentsService.upsertScores().
  INSERT INTO public.grades (id, school_id, assessment_id, student_id, score, graded_at)
    VALUES (gen_random_uuid(), v_assess.school_id, p_assessment_id, v_attempt.student_id, v_attempt.score, NOW())
    ON CONFLICT (assessment_id, student_id) DO UPDATE SET score = EXCLUDED.score, graded_at = EXCLUDED.graded_at
    RETURNING id INTO v_grade_id;

  INSERT INTO public.audit_logs (id, school_id, user_id, action, entity_type, entity_id, metadata)
    VALUES (gen_random_uuid(), v_assess.school_id, v_caller_id, 'quiz.record_grade', 'grades', v_grade_id,
            jsonb_build_object('quizAttemptId', p_quiz_attempt_id, 'assessmentId', p_assessment_id));

  RETURN v_grade_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_quiz_grade(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_quiz_grade(uuid, uuid) TO authenticated;

INSERT INTO public._migration_log (filename) VALUES ('20260728000080_record_quiz_grade.sql') ON CONFLICT (filename) DO NOTHING;
