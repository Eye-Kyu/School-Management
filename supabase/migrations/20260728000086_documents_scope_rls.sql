-- ============================================================
-- Bucket 1, PR 3 — user_can_see_document() + scoped RLS policies
-- ============================================================
-- Corrected against the real schema (verified directly against
-- supabase/migrations/20260522000001_init.sql, not assumed): the task
-- spec's own SQL template referenced students.class_id (real column:
-- current_class_id), a class_teachers table (doesn't exist — the class
-- teacher is teachers.is_class_teacher_of), and a subject_teachers table
-- (doesn't exist — subject_assignments.teacher_id -> teachers.id is the
-- only mechanism for "which teacher/classes teach subject S"). See
-- docs/audits/documents-current-state.md for the verification trail.
--
-- current_user_id() returns public.users.id (fixed in
-- 20260723000047_fix_current_user_id.sql to no longer return the raw
-- Supabase auth id) — every join below relies on this current behavior.
--
-- ADMIN always sees everything at their school, matching the existing
-- docs_insert/update/delete's ADMIN-bypasses-everything shape. Every other
-- role is scope-checked below.
CREATE OR REPLACE FUNCTION public.user_can_see_document(
  p_scope_type TEXT,
  p_scope_subtype TEXT,
  p_scope_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_class_id UUID;
BEGIN
  IF public.current_user_role() = 'ADMIN' THEN
    RETURN true;
  END IF;

  IF p_scope_type = 'SCHOOL_WIDE' THEN
    RETURN true;
  END IF;

  IF p_scope_type = 'CLASS' THEN
    v_class_id := p_scope_id;

  ELSIF p_scope_type = 'SUBJECT' THEN
    -- "Can see this subject's documents" = teaches it anywhere, is a
    -- student in a class where it's taught, or is that student's guardian.
    RETURN EXISTS (
      SELECT 1 FROM public.subject_assignments sa
      JOIN public.teachers t ON t.id = sa.teacher_id
      WHERE sa.subject_id = p_scope_id AND t.user_id = public.current_user_id()
    ) OR EXISTS (
      SELECT 1 FROM public.subject_assignments sa
      JOIN public.students s ON s.current_class_id = sa.class_id
      WHERE sa.subject_id = p_scope_id AND s.user_id = public.current_user_id()
    ) OR EXISTS (
      SELECT 1 FROM public.subject_assignments sa
      JOIN public.students s ON s.current_class_id = sa.class_id
      JOIN public.guardians g ON g.student_id = s.id
      WHERE sa.subject_id = p_scope_id AND g.user_id = public.current_user_id()
    );

  ELSIF p_scope_type = 'ASSIGNMENT' THEN
    -- Resolve to the underlying entity's class, then reuse the CLASS
    -- visibility check below. Deliberately does NOT re-check
    -- creator/teacher_id ownership here — that's an *attach* authorization
    -- concern (validated app-side in DocumentsService, same "validate in
    -- the app layer" precedent as assessments.source_id), not a *view*
    -- concern; a document already attached to a class's assignment should
    -- be visible to that whole class, not just its creator.
    IF p_scope_subtype = 'HOMEWORK' THEN
      SELECT class_id INTO v_class_id FROM public.homework_assignments WHERE id = p_scope_id;
    ELSIF p_scope_subtype = 'QUIZ' THEN
      SELECT class_id INTO v_class_id FROM public.quizzes WHERE id = p_scope_id;
    ELSIF p_scope_subtype = 'ONLINE_ASSIGNMENT' THEN
      SELECT class_id INTO v_class_id FROM public.assignments WHERE id = p_scope_id;
    ELSE
      RETURN false;
    END IF;

    IF v_class_id IS NULL THEN
      RETURN false; -- underlying row was deleted/not found
    END IF;

  ELSE
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.current_class_id = v_class_id AND s.user_id = public.current_user_id()
  ) OR EXISTS (
    SELECT 1 FROM public.guardians g
    JOIN public.students s ON s.id = g.student_id
    WHERE g.user_id = public.current_user_id() AND s.current_class_id = v_class_id
  ) OR EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.user_id = public.current_user_id() AND t.is_class_teacher_of = v_class_id
  ) OR EXISTS (
    SELECT 1 FROM public.subject_assignments sa
    JOIN public.teachers t ON t.id = sa.teacher_id
    WHERE sa.class_id = v_class_id AND t.user_id = public.current_user_id()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.user_can_see_document(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_see_document(TEXT, TEXT, UUID) TO authenticated;

-- ── Rewritten table RLS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "docs_select" ON public.documents;
DROP POLICY IF EXISTS "docs_insert" ON public.documents;
DROP POLICY IF EXISTS "docs_update" ON public.documents;
DROP POLICY IF EXISTS "docs_delete" ON public.documents;

-- deleted_at visibility carve-out applied from the start, not rediscovered
-- the hard way: a plain "deleted_at IS NULL" clause here would make the
-- soft-delete endpoint's own chained .select() (needed to return the
-- updated row) fail with an RLS violation once the row is marked deleted —
-- exactly the bug fixed after-the-fact for departments in
-- 20260723000050_fix_department_soft_delete_select_rls.sql. Let ADMIN and
-- the uploader see their own soft-deleted rows so that .select() succeeds.
CREATE POLICY "docs_select" ON public.documents FOR SELECT USING (
  school_id = public.current_school_id()
  AND public.module_enabled(school_id, 'document_library')
  AND (deleted_at IS NULL OR public.current_user_role() = 'ADMIN' OR uploaded_by_id = public.current_user_id())
  AND public.user_can_see_document(scope_type, scope_subtype, scope_id)
);

CREATE POLICY "docs_insert" ON public.documents FOR INSERT WITH CHECK (
  school_id = public.current_school_id()
  AND public.current_user_role() IN ('ADMIN', 'TEACHER')
  AND public.module_enabled(school_id, 'document_library')
);

-- Tightened from "any ADMIN/TEACHER at the school" (the pre-existing,
-- never-exercised-by-any-UI behavior) to "ADMIN or the uploader" — the
-- previous policy let any teacher edit or delete any other teacher's
-- document. Zero live rows means no behavior change for real data; this is
-- a deliberate tightening bundled into this rewrite (RLS is being fully
-- replaced here regardless), not a silent side effect — see the Phase 2
-- plan's own note on this.
CREATE POLICY "docs_update" ON public.documents FOR UPDATE USING (
  school_id = public.current_school_id()
  AND (public.current_user_role() = 'ADMIN' OR uploaded_by_id = public.current_user_id())
  AND public.module_enabled(school_id, 'document_library')
);

CREATE POLICY "docs_delete" ON public.documents FOR DELETE USING (
  school_id = public.current_school_id()
  AND (public.current_user_role() = 'ADMIN' OR uploaded_by_id = public.current_user_id())
  AND public.module_enabled(school_id, 'document_library')
);
-- Note: DocumentsService.remove() soft-deletes via UPDATE (sets
-- deleted_at), so docs_update's predicate is what actually gates delete
-- requests in practice — docs_delete (a real DELETE) is kept for
-- completeness/defense-in-depth, not expected to be exercised by the app.

INSERT INTO public._migration_log (filename) VALUES ('20260728000086_documents_scope_rls.sql') ON CONFLICT (filename) DO NOTHING;
