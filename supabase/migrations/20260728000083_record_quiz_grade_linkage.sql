-- ============================================================
-- Bucket 1, PR 2b — wire record_quiz_grade() to real quiz linkage
-- ============================================================
-- B1-2a's record_quiz_grade(p_quiz_attempt_id, p_assessment_id) was
-- infrastructure-only scaffolding for a caller that didn't yet know how to
-- resolve the real link — nothing existed to call it with a real
-- assessment_id. Now that assessments.source_type/source_id exists, the
-- function resolves the link itself; callers only ever pass the attempt id.
--
-- This changes the parameter list, which CREATE OR REPLACE FUNCTION cannot
-- do in place — the old two-parameter overload is dropped and replaced with
-- a one-parameter version.
--
-- Behavior: if the quiz has no linked assessment, returns NULL and writes
-- nothing — an unlinked quiz is a normal, expected state, not an error.
-- Writes go through write_linked_grade() (20260728000082), never a raw
-- INSERT — same single enforcement point as every other cascade path.
-- ============================================================

DROP FUNCTION IF EXISTS public.record_quiz_grade(uuid, uuid);

CREATE OR REPLACE FUNCTION public.record_quiz_grade(p_quiz_attempt_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempt    RECORD;
  v_assess     RECORD;
  v_caller_id  uuid := public.current_user_id();
  v_role       text := public.current_user_role();
  v_normalized numeric;
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

  SELECT * INTO v_assess FROM public.assessments
    WHERE source_type = 'QUIZ' AND source_id = v_attempt.quiz_id;
  IF NOT FOUND THEN
    RETURN NULL; -- not linked — expected, not an error
  END IF;

  IF v_assess.school_id != v_attempt.attempt_school_id THEN
    RAISE EXCEPTION 'Assessment and quiz attempt are in different schools';
  END IF;

  IF v_attempt.max_score IS NULL OR v_attempt.max_score <= 0 THEN
    RETURN NULL; -- a zero-question quiz has nothing to normalize against
  END IF;

  v_normalized := ROUND((v_attempt.score / v_attempt.max_score) * v_assess.max_marks, 2);

  RETURN public.write_linked_grade(v_assess.id, v_attempt.student_id, v_normalized);
END;
$$;

REVOKE ALL ON FUNCTION public.record_quiz_grade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_quiz_grade(uuid) TO authenticated;

INSERT INTO public._migration_log (filename) VALUES ('20260728000083_record_quiz_grade_linkage.sql') ON CONFLICT (filename) DO NOTHING;
