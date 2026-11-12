-- ============================================================
-- Security audit 2026-11, V2 batch: column allowlists and owner binding
-- ============================================================
-- Several policies limited WHICH row a user could write, but not which
-- columns or values, and the browser holds the anon key plus the user's JWT
-- (direct PostgREST). This migration closes:
--
--   SA-27  notifications: a recipient could rewrite title/body/channel state
--          so the dispatcher sends attacker-chosen SMS/email at school cost
--   SA-26  conversations/messages: a participant could re-point parties or
--          rewrite/forge message bodies
--   SA-20  classes: a class teacher (classes_update_prefect_by_classteacher)
--          could rewrite any column of their class, school_id included
--   SA-18  audit_logs: any member could insert rows attributed to another user
--          or with a NULL school
--   SA-19  behaviour_points: students/parents read every student's points and
--          reasons (the API leaderboard now aggregates server-side)
--   SA-23  document_chunks: chunks_select ignored per-document scope and soft
--          delete (SA-16's tutor path now reads through this policy)
--   SA-29  permission_slip_responses: any parent could sign for any student
--   SA-32  payment_records: any same-school user could read every family's
--          manual payments
--   SA-33  payment_transactions: any same-school user could INSERT/UPDATE
--          rows that Paystack reconciliation trusts
--
-- Every legitimate writer was mapped first. Column allowlists match exactly
-- what the app writes with a user JWT: notifications {is_read,
-- acknowledged_at}; conversations {*_unread_count}; messages {read_at};
-- classes, for a non-ADMIN class teacher, {prefect_student_id, updated_at}.
-- payment_transactions has no user-JWT writers (all service-role).
--
-- Service-role calls (auth.uid() IS NULL) bypass RLS and are exempt from the
-- allowlist trigger, so API dispatch, reconciliation and cascades keep working.
--
-- Before/after verification (CLAUDE.md §6): pg_policies / pg_trigger for the
-- tables above were captured before applying (before-v2b snapshot). Live
-- behaviour is covered by apps/api/test/security-audit-v2.e2e-spec.ts.
-- ============================================================

-- ── Reusable column allowlist for end-user UPDATEs ──────────────────────────
-- TG_ARGV[0] = comma-separated columns an end user may change.
-- TG_ARGV[1] = optional role exempt from the allowlist (e.g. ADMIN on classes).
CREATE OR REPLACE FUNCTION public.enforce_update_column_allowlist()
  RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  allowed text[] := string_to_array(TG_ARGV[0], ',');
  exempt  text   := NULLIF(COALESCE(TG_ARGV[1], ''), '');
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  col text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service role / direct connection
  IF exempt IS NOT NULL AND public.current_user_role() = exempt THEN RETURN NEW; END IF;
  FOREACH col IN ARRAY allowed LOOP
    o := o - col;
    n := n - col;
  END LOOP;
  IF o IS DISTINCT FROM n THEN
    RAISE EXCEPTION '%: only these columns may be changed here: %', TG_TABLE_NAME, TG_ARGV[0]
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- SA-27
DROP TRIGGER IF EXISTS notifications_update_allowlist ON public.notifications;
CREATE TRIGGER notifications_update_allowlist BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_update_column_allowlist('is_read,acknowledged_at');

-- SA-26
DROP TRIGGER IF EXISTS conversations_update_allowlist ON public.conversations;
CREATE TRIGGER conversations_update_allowlist BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_update_column_allowlist('parent_unread_count,teacher_unread_count,admin_unread_count');

DROP TRIGGER IF EXISTS messages_update_allowlist ON public.messages;
CREATE TRIGGER messages_update_allowlist BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_update_column_allowlist('read_at');

-- SA-20 (ADMIN keeps full classes edits via classes_update_admin_only)
DROP TRIGGER IF EXISTS classes_update_allowlist ON public.classes;
CREATE TRIGGER classes_update_allowlist BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_update_column_allowlist('prefect_student_id,updated_at', 'ADMIN');

-- ── SA-18: audit rows must be attributed to the caller, in their own school ─
DROP POLICY IF EXISTS "audit_logs_insert_own_school" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_own_school" ON public.audit_logs FOR INSERT WITH CHECK (
  school_id = public.current_school_id() AND user_id = public.current_user_id()
);

-- ── SA-19: behaviour_points readable school-wide by staff only ───────────────
DROP POLICY IF EXISTS "bp_select" ON public.behaviour_points;
CREATE POLICY "bp_select" ON public.behaviour_points FOR SELECT USING (
  school_id = public.current_school_id()
  AND public.module_enabled(school_id, 'behaviour_tracking')
  AND (
    public.current_user_role() IN ('ADMIN', 'TEACHER')
    OR (public.current_user_role() = 'STUDENT' AND EXISTS (
      SELECT 1 FROM public.students s WHERE s.id = behaviour_points.student_id AND s.user_id = public.current_user_id()))
    OR (public.current_user_role() = 'PARENT' AND student_id = ANY(public.guardian_student_ids()))
  )
);

-- ── SA-23: chunks inherit their document's visibility ───────────────────────
-- The EXISTS subquery runs under the caller's docs_select RLS (per-document
-- scope via user_can_see_document), and soft-deleted documents are excluded.
DROP POLICY IF EXISTS "chunks_select" ON public.document_chunks;
CREATE POLICY "chunks_select" ON public.document_chunks FOR SELECT USING (
  school_id = public.current_school_id()
  AND public.module_enabled(school_id, 'document_library')
  AND EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_chunks.document_id AND d.deleted_at IS NULL
  )
);

-- ── SA-29: a parent may only sign for their own child, as themselves ────────
DROP POLICY IF EXISTS "psr_insert" ON public.permission_slip_responses;
CREATE POLICY "psr_insert" ON public.permission_slip_responses FOR INSERT WITH CHECK (
  school_id = public.current_school_id()
  AND public.current_user_role() = 'PARENT'
  AND public.module_enabled(school_id, 'permission_slips')
  AND parent_user_id = public.current_user_id()
  AND student_id = ANY(public.guardian_student_ids())
);

-- ── SA-32: manual payment records ───────────────────────────────────────────
DROP POLICY IF EXISTS "payment_records_school_isolation" ON public.payment_records;
CREATE POLICY "payment_records_select" ON public.payment_records FOR SELECT USING (
  school_id = public.current_school_id() AND (
    public.current_user_role() = 'ADMIN'
    OR (public.current_user_role() = 'PARENT' AND student_id = ANY(public.guardian_student_ids()))
    OR (public.current_user_role() = 'STUDENT' AND EXISTS (
      SELECT 1 FROM public.students s WHERE s.id = payment_records.student_id AND s.user_id = public.current_user_id()))
  )
);
CREATE POLICY "payment_records_write_admin" ON public.payment_records FOR ALL
  USING (school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN')
  WITH CHECK (school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN');

-- ── SA-33: payment_transactions are written only by the API (service role) ──
DROP POLICY IF EXISTS "pt_insert" ON public.payment_transactions;
DROP POLICY IF EXISTS "pt_update" ON public.payment_transactions;

INSERT INTO public._migration_log (filename) VALUES ('20261112000098_v2_rls_column_and_owner_binding.sql') ON CONFLICT (filename) DO NOTHING;
