-- ============================================================
-- Audit log viewer (Phase 11) support indexes.
--
-- audit_logs already has (school_id, created_at), (user_id, created_at),
-- and (entity_type, entity_id) indexes, but nothing covers filtering by
-- `action` or the unfiltered "most recent N" query the new viewer's
-- default view uses — both become common access patterns once the table
-- is actually read from instead of only written to.
-- ============================================================

CREATE INDEX IF NOT EXISTS audit_logs_action_created_at_idx ON public.audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
