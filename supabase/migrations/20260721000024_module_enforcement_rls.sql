-- =============================================================================
-- Fold module_enabled() into existing RLS policies
-- =============================================================================
-- These tables have NO NestJS controller — the Next.js frontend talks to them
-- directly via Supabase, so RLS is the only place module entitlement can be
-- enforced (a backend guard can't reach a route that doesn't exist). Each
-- policy below reproduces its existing logic exactly, with one AND clause
-- added — not a rewrite. Deployed with zero school_modules rows in place,
-- this is a functional no-op (module_enabled() defaults to true).
-- =============================================================================

-- ── document_library: documents, document_chunks ────────────────────────────

DROP POLICY IF EXISTS "docs_select" ON public.documents;
CREATE POLICY "docs_select" ON public.documents FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'document_library')
);
DROP POLICY IF EXISTS "docs_insert" ON public.documents;
CREATE POLICY "docs_insert" ON public.documents FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER')
  AND module_enabled(school_id, 'document_library')
);
DROP POLICY IF EXISTS "docs_update" ON public.documents;
CREATE POLICY "docs_update" ON public.documents FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER')
  AND module_enabled(school_id, 'document_library')
);
DROP POLICY IF EXISTS "docs_delete" ON public.documents;
CREATE POLICY "docs_delete" ON public.documents FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER')
  AND module_enabled(school_id, 'document_library')
);

DROP POLICY IF EXISTS "chunks_select" ON public.document_chunks;
CREATE POLICY "chunks_select" ON public.document_chunks FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'document_library')
);
DROP POLICY IF EXISTS "chunks_insert" ON public.document_chunks;
CREATE POLICY "chunks_insert" ON public.document_chunks FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER')
  AND module_enabled(school_id, 'document_library')
);
DROP POLICY IF EXISTS "chunks_delete" ON public.document_chunks;
CREATE POLICY "chunks_delete" ON public.document_chunks FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER')
  AND module_enabled(school_id, 'document_library')
);

-- ── quizzes: quizzes, quiz_questions, quiz_attempts ──────────────────────────

DROP POLICY IF EXISTS "quiz_select" ON public.quizzes;
CREATE POLICY "quiz_select" ON public.quizzes FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'quizzes') AND (
    current_user_role() IN ('TEACHER', 'ADMIN') OR is_published = true
  )
);
DROP POLICY IF EXISTS "quiz_insert" ON public.quizzes;
CREATE POLICY "quiz_insert" ON public.quizzes FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER', 'ADMIN')
  AND module_enabled(school_id, 'quizzes')
);
DROP POLICY IF EXISTS "quiz_update" ON public.quizzes;
CREATE POLICY "quiz_update" ON public.quizzes FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER', 'ADMIN')
  AND module_enabled(school_id, 'quizzes')
);
DROP POLICY IF EXISTS "quiz_delete" ON public.quizzes;
CREATE POLICY "quiz_delete" ON public.quizzes FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER', 'ADMIN')
  AND module_enabled(school_id, 'quizzes')
);

DROP POLICY IF EXISTS "qq_select" ON public.quiz_questions;
CREATE POLICY "qq_select" ON public.quiz_questions FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'quizzes')
);
DROP POLICY IF EXISTS "qq_insert" ON public.quiz_questions;
CREATE POLICY "qq_insert" ON public.quiz_questions FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER', 'ADMIN')
  AND module_enabled(school_id, 'quizzes')
);
DROP POLICY IF EXISTS "qq_update" ON public.quiz_questions;
CREATE POLICY "qq_update" ON public.quiz_questions FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER', 'ADMIN')
  AND module_enabled(school_id, 'quizzes')
);
DROP POLICY IF EXISTS "qq_delete" ON public.quiz_questions;
CREATE POLICY "qq_delete" ON public.quiz_questions FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER', 'ADMIN')
  AND module_enabled(school_id, 'quizzes')
);

DROP POLICY IF EXISTS "qa_select" ON public.quiz_attempts;
CREATE POLICY "qa_select" ON public.quiz_attempts FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'quizzes') AND (
    current_user_role() IN ('TEACHER', 'ADMIN')
    OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
  )
);
DROP POLICY IF EXISTS "qa_insert" ON public.quiz_attempts;
CREATE POLICY "qa_insert" ON public.quiz_attempts FOR INSERT WITH CHECK (
  school_id = current_school_id() AND module_enabled(school_id, 'quizzes') AND
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
);
DROP POLICY IF EXISTS "qa_update" ON public.quiz_attempts;
CREATE POLICY "qa_update" ON public.quiz_attempts FOR UPDATE USING (
  school_id = current_school_id() AND module_enabled(school_id, 'quizzes') AND (
    current_user_role() IN ('TEACHER', 'ADMIN') OR
    EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
  )
);

-- ── behaviour_tracking: behaviour_points ──────────────────────────────────────

DROP POLICY IF EXISTS "bp_select" ON public.behaviour_points;
CREATE POLICY "bp_select" ON public.behaviour_points FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'behaviour_tracking')
);
DROP POLICY IF EXISTS "bp_insert" ON public.behaviour_points;
CREATE POLICY "bp_insert" ON public.behaviour_points FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER', 'ADMIN')
  AND module_enabled(school_id, 'behaviour_tracking')
);
DROP POLICY IF EXISTS "bp_delete" ON public.behaviour_points;
CREATE POLICY "bp_delete" ON public.behaviour_points FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER', 'ADMIN')
  AND module_enabled(school_id, 'behaviour_tracking')
);

-- ── permission_slips: permission_slips, permission_slip_responses ───────────

DROP POLICY IF EXISTS "ps_select" ON public.permission_slips;
CREATE POLICY "ps_select" ON public.permission_slips FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'permission_slips')
);
DROP POLICY IF EXISTS "ps_insert" ON public.permission_slips;
CREATE POLICY "ps_insert" ON public.permission_slips FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'permission_slips')
);
DROP POLICY IF EXISTS "ps_delete" ON public.permission_slips;
CREATE POLICY "ps_delete" ON public.permission_slips FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'permission_slips')
);

DROP POLICY IF EXISTS "psr_select" ON public.permission_slip_responses;
CREATE POLICY "psr_select" ON public.permission_slip_responses FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'permission_slips')
);
DROP POLICY IF EXISTS "psr_insert" ON public.permission_slip_responses;
CREATE POLICY "psr_insert" ON public.permission_slip_responses FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() = 'PARENT'
  AND module_enabled(school_id, 'permission_slips')
);

-- ── safety_tipline: safety_tips ───────────────────────────────────────────────
-- Only the ADMIN-facing read/review side is gated — anonymous tip submission
-- has no authenticated school context to check, and stays unconditionally open.

DROP POLICY IF EXISTS "st_select" ON public.safety_tips;
CREATE POLICY "st_select" ON public.safety_tips FOR SELECT USING (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'safety_tipline')
);
DROP POLICY IF EXISTS "st_update" ON public.safety_tips;
CREATE POLICY "st_update" ON public.safety_tips FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'safety_tipline')
);
-- st_insert intentionally left unchanged (WITH CHECK (true)) — anonymous by design.

-- ── compliance_api: api_tokens, deletion_requests ────────────────────────────

DROP POLICY IF EXISTS "tok_select" ON public.api_tokens;
CREATE POLICY "tok_select" ON public.api_tokens FOR SELECT USING (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'compliance_api')
);
DROP POLICY IF EXISTS "tok_insert" ON public.api_tokens;
CREATE POLICY "tok_insert" ON public.api_tokens FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'compliance_api')
);
DROP POLICY IF EXISTS "tok_delete" ON public.api_tokens;
CREATE POLICY "tok_delete" ON public.api_tokens FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'compliance_api')
);

DROP POLICY IF EXISTS "dr_select" ON public.deletion_requests;
CREATE POLICY "dr_select" ON public.deletion_requests FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'compliance_api')
  AND (current_user_role() = 'ADMIN' OR requested_by_id = current_user_id())
);
DROP POLICY IF EXISTS "dr_insert" ON public.deletion_requests;
CREATE POLICY "dr_insert" ON public.deletion_requests FOR INSERT WITH CHECK (
  school_id = current_school_id() AND module_enabled(school_id, 'compliance_api')
);
DROP POLICY IF EXISTS "dr_update" ON public.deletion_requests;
CREATE POLICY "dr_update" ON public.deletion_requests FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'compliance_api')
);

-- ── substitute_management: substitute_grants ─────────────────────────────────

DROP POLICY IF EXISTS "sub_select" ON public.substitute_grants;
CREATE POLICY "sub_select" ON public.substitute_grants FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'substitute_management')
);
DROP POLICY IF EXISTS "sub_insert" ON public.substitute_grants;
CREATE POLICY "sub_insert" ON public.substitute_grants FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'substitute_management')
);
DROP POLICY IF EXISTS "sub_delete" ON public.substitute_grants;
CREATE POLICY "sub_delete" ON public.substitute_grants FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() = 'ADMIN'
  AND module_enabled(school_id, 'substitute_management')
);
