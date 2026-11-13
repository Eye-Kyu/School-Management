-- ============================================================
-- SA-14 / SA-09: caller authorization for the linked-grade RPCs
-- ============================================================
-- write_linked_grade(uuid, uuid, numeric) (20260728000082) is SECURITY
-- DEFINER, EXECUTE is granted to authenticated, and it checked nothing about
-- the caller. It also sets app.grade_source = 'cascade', which disables
-- grades_block_direct_edit_on_linked. Any logged-in user, a student
-- included, could call rpc('write_linked_grade') and upsert any score for
-- any (assessment, student) pair in any school (security audit 2026-11, SA-14).
--
-- record_quiz_grade(uuid) (20260728000083) let any TEACHER or ADMIN through
-- regardless of school, and its authorization predicate was NULL-unsafe
-- (NOT (NULL OR NULL) does not raise), so it failed open for a caller with no
-- users row (SA-09).
--
-- Fix, keeping both public signatures unchanged (CLAUDE.md §6
-- function-overload gotcha):
--   * The raw write moves to public._write_linked_grade_internal(...). EXECUTE
--     is revoked from PUBLIC, anon and authenticated, so only the owner (and
--     therefore SECURITY DEFINER callers) can reach it.
--   * write_linked_grade(...) becomes a guarded wrapper. Allowed callers:
--     service role / direct connections (auth.uid() IS NULL: seed scripts,
--     admin client), or a TEACHER/ADMIN whose current_school_id() equals the
--     assessment's school. The student must belong to that school.
--   * record_quiz_grade(...) gets a NULL-safe check: the attempt's own student,
--     or a TEACHER/ADMIN of the attempt's school. It calls the internal writer
--     directly, because a STUDENT caller would fail the wrapper's role check.
--   * Both public functions get explicit REVOKE ... FROM anon. On Supabase,
--     REVOKE FROM PUBLIC does not remove default privileges granted to anon.
--
-- Known remaining gap (tracked separately, not fixed here): a TEACHER is
-- still not bound to the assessment's class or subject. That matches the
-- existing grade_insert/grade_update RLS (assessments-teacher-write lead).
--
-- Before/after verification (CLAUDE.md §6), against DIRECT_URL:
--   SELECT p.proname, pg_get_functiondef(p.oid) ~ 'current_school_id' AS checks_school,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
--   FROM pg_proc p WHERE p.proname IN ('write_linked_grade','record_quiz_grade','_write_linked_grade_internal');
--   BEFORE: write_linked_grade checks_school=f. AFTER: both public fns checks_school=t, anon_exec=f;
--   _write_linked_grade_internal auth_exec=f. Then on a NON-production project:
--   a STUDENT JWT rpc('write_linked_grade', ...) must fail with "Not authorized".
-- ============================================================

CREATE OR REPLACE FUNCTION public._write_linked_grade_internal(p_assessment_id uuid, p_student_id uuid, p_score numeric)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_school_id uuid;
  v_grade_id  uuid;
BEGIN
  SELECT school_id INTO v_school_id FROM public.assessments WHERE id = p_assessment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assessment not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.students WHERE id = p_student_id AND school_id = v_school_id
  ) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  PERFORM set_config('app.grade_source', 'cascade', true); -- LOCAL: this transaction only

  INSERT INTO public.grades (id, school_id, assessment_id, student_id, score, graded_at)
    VALUES (gen_random_uuid(), v_school_id, p_assessment_id, p_student_id, p_score, NOW())
    ON CONFLICT (assessment_id, student_id) DO UPDATE SET score = EXCLUDED.score, graded_at = EXCLUDED.graded_at
    RETURNING id INTO v_grade_id;

  RETURN v_grade_id;
END;
$$;

REVOKE ALL ON FUNCTION public._write_linked_grade_internal(uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._write_linked_grade_internal(uuid, uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public._write_linked_grade_internal(uuid, uuid, numeric) FROM authenticated;

CREATE OR REPLACE FUNCTION public.write_linked_grade(p_assessment_id uuid, p_student_id uuid, p_score numeric)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_school_id uuid;
BEGIN
  -- End-user callers must be staff of the assessment's own school.
  -- Service role / direct connections (no auth.uid()) are trusted server code.
  IF auth.uid() IS NOT NULL THEN
    SELECT school_id INTO v_school_id FROM public.assessments WHERE id = p_assessment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Assessment not found';
    END IF;

    IF COALESCE(public.current_user_role(), '') NOT IN ('TEACHER', 'ADMIN')
       OR public.current_school_id() IS DISTINCT FROM v_school_id THEN
      RAISE EXCEPTION 'Not authorized to record this grade';
    END IF;
  END IF;

  RETURN public._write_linked_grade_internal(p_assessment_id, p_student_id, p_score);
END;
$$;

REVOKE ALL ON FUNCTION public.write_linked_grade(uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_linked_grade(uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.write_linked_grade(uuid, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_quiz_grade(p_quiz_attempt_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempt    RECORD;
  v_assess     RECORD;
  v_caller_id  uuid := public.current_user_id();
  v_role       text := public.current_user_role();
  v_school     uuid := public.current_school_id();
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

  -- NULL-safe: a caller with no users row (v_caller_id/v_role/v_school NULL) is rejected.
  IF NOT (
       (v_caller_id IS NOT NULL AND v_attempt.student_user_id = v_caller_id)
    OR (COALESCE(v_role, '') IN ('TEACHER', 'ADMIN')
        AND v_school IS NOT NULL AND v_school = v_attempt.attempt_school_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to record this grade';
  END IF;

  SELECT * INTO v_assess FROM public.assessments
    WHERE source_type = 'QUIZ' AND source_id = v_attempt.quiz_id;
  IF NOT FOUND THEN
    RETURN NULL; -- not linked: expected, not an error
  END IF;

  IF v_assess.school_id != v_attempt.attempt_school_id THEN
    RAISE EXCEPTION 'Assessment and quiz attempt are in different schools';
  END IF;

  IF v_attempt.max_score IS NULL OR v_attempt.max_score <= 0 THEN
    RETURN NULL; -- a zero-question quiz has nothing to normalize against
  END IF;

  v_normalized := ROUND((v_attempt.score / v_attempt.max_score) * v_assess.max_marks, 2);

  RETURN public._write_linked_grade_internal(v_assess.id, v_attempt.student_id, v_normalized);
END;
$$;

REVOKE ALL ON FUNCTION public.record_quiz_grade(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_quiz_grade(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_quiz_grade(uuid) TO authenticated;

INSERT INTO public._migration_log (filename) VALUES ('20261112000093_linked_grade_rpc_caller_checks.sql') ON CONFLICT (filename) DO NOTHING;
