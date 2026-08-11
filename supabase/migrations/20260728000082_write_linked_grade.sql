-- ============================================================
-- Bucket 1, PR 2b — the sole gateway for writing a grade onto a
-- source-linked assessment, plus the trigger that enforces it
-- ============================================================
-- Grades on a linked (source_type != 'DIRECT') assessment must only ever be
-- written by the legitimate cascade (homework grading, quiz submission,
-- retroactive rollup) — never a direct teacher edit, whether through
-- AssessmentsService.upsertScores() or a raw client write (e.g.
-- GradebookClient.tsx writes to `grades` directly from the browser with no
-- app-layer check today, so API-layer enforcement alone doesn't close the
-- gap — the trigger below is the real backstop).
--
-- Why SET LOCAL + a trigger, not two service methods: every legitimate
-- cascade write and every illegitimate direct write both come from the same
-- `authenticated` role passing the same grade_insert/grade_update RLS check
-- (TEACHER/ADMIN) — RLS and a service-layer split can't tell them apart by
-- role alone, and a service-layer-only split would only protect the one
-- NestJS route it's applied to, not GradebookClient.tsx's existing raw
-- write path or any other client issuing a valid request directly. SET
-- LOCAL correctly scopes to one transaction — exactly what a SECURITY
-- DEFINER function call already is — so every cascade path funneling
-- through this one function sets it atomically with its own write, and
-- every direct-edit path (which never calls this function) never does.
-- ============================================================

CREATE OR REPLACE FUNCTION public.write_linked_grade(p_assessment_id uuid, p_student_id uuid, p_score numeric)
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

  PERFORM set_config('app.grade_source', 'cascade', true); -- true = LOCAL (this transaction only)

  INSERT INTO public.grades (id, school_id, assessment_id, student_id, score, graded_at)
    VALUES (gen_random_uuid(), v_school_id, p_assessment_id, p_student_id, p_score, NOW())
    ON CONFLICT (assessment_id, student_id) DO UPDATE SET score = EXCLUDED.score, graded_at = EXCLUDED.graded_at
    RETURNING id INTO v_grade_id;

  RETURN v_grade_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_linked_grade(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_linked_grade(uuid, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_linked_grade_direct_edit()
RETURNS TRIGGER AS $$
DECLARE
  v_source_type TEXT;
BEGIN
  SELECT source_type INTO v_source_type FROM public.assessments WHERE id = NEW.assessment_id;

  IF v_source_type IS NOT NULL AND v_source_type != 'DIRECT'
     AND current_setting('app.grade_source', true) IS DISTINCT FROM 'cascade' THEN
    RAISE EXCEPTION 'This grade is derived from %. Update the source instead.', v_source_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS grades_block_direct_edit_on_linked ON public.grades;
CREATE TRIGGER grades_block_direct_edit_on_linked
  BEFORE INSERT OR UPDATE ON public.grades
  FOR EACH ROW EXECUTE FUNCTION public.check_linked_grade_direct_edit();

INSERT INTO public._migration_log (filename) VALUES ('20260728000082_write_linked_grade.sql') ON CONFLICT (filename) DO NOTHING;
