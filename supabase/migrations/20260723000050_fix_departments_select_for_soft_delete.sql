-- ============================================================
-- Fix departments soft-delete — SELECT policy excluded the row PostgREST
-- needs to return
-- ============================================================
-- departments_select_same_school excludes deleted_at IS NOT NULL rows.
-- PostgREST's UPDATE requires the post-update row to satisfy the SELECT
-- policy to build its response (confirmed empirically: the exact same
-- UPDATE succeeds via the service-role client, which bypasses RLS, and
-- fails identically whether or not .select() is explicitly chained on the
-- RLS-scoped client) — so soft-deleting a department made it invisible to
-- its own actor mid-request, which Postgres/PostgREST surfaces as a 42501
-- RLS violation rather than an empty response. This was never about the
-- 20260723000040 trigger (already removed in 20260723000048) — that was a
-- correlated red herring, not the actual cause.
--
-- Fix: let ADMIN see soft-deleted departments too — sensible on its own
-- merits (an admin should be able to see what they just deleted, and this
-- is the natural foundation for an eventual "trash"/undo view), and it
-- directly resolves the RETURNING-visibility problem for the only role
-- that can ever perform this delete.

DROP POLICY IF EXISTS "departments_select_same_school" ON public.departments;
CREATE POLICY "departments_select_same_school" ON public.departments FOR SELECT
  USING (
    school_id = public.current_school_id()
    AND (deleted_at IS NULL OR public.current_user_role() = 'ADMIN')
  );
