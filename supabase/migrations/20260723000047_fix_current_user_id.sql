-- ============================================================
-- Fix current_user_id() — it returned the wrong UUID
-- ============================================================
-- current_user_id(), since it was first defined in 20260522000002_enable_rls.sql,
-- returned `auth.uid()` directly — the Supabase Auth user id (== users.auth_id).
-- Every policy that calls it compares the result against columns typed as
-- public.users(id) (parent_user_id, teacher_user_id, sender_id, students.user_id,
-- guardians.user_id, etc.) — a DIFFERENT, independently-generated UUID (see
-- handle_new_auth_user(): `id` is `gen_random_uuid()`, unrelated to `NEW.id`/auth.uid()).
--
-- Confirmed empirically against the live DB: current_user_id() returned
-- users.auth_id, not users.id, for a fresh real session.
--
-- current_school_id() and current_user_role() (defined right next to this
-- function in the same original migration) already do this correctly —
-- both look up through `public.users WHERE auth_id = auth.uid()`.
-- current_user_id() was the one outlier that skipped that lookup.
--
-- Impact: every RLS policy using current_user_id() against a users.id-typed
-- column has been silently non-functional for real (non-service-role)
-- writes since it was introduced — this was never caught before because
-- every historical write path either used the service-role client (bypasses
-- RLS entirely) or was never covered by an e2e test that inserted as a real
-- authenticated user. This fix does not change any policy text — every
-- policy already expresses the intended rule; only the function's return
-- value was wrong.

CREATE OR REPLACE FUNCTION public.current_user_id()
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT id FROM public.users
  WHERE auth_id = auth.uid() AND deleted_at IS NULL LIMIT 1;
$$;
