-- ============================================================
-- Fix profile update PGRST116 — users had no self-update RLS policy
-- ============================================================
-- users_update_admin_only (20260522000002_enable_rls.sql, replaced in
-- 20260721000026_super_admin_role.sql) is the ONLY UPDATE policy on
-- public.users, and it requires current_user_role() = 'ADMIN'. A non-admin
-- calling PATCH /users/me to update their own profile was silently
-- filtered to zero rows by RLS, and .select().single() in
-- users.service.ts's updateMe() threw PGRST116 as a result. Admin
-- self-updates happened to work by coincidence (their own role check
-- passes), which is why this wasn't caught earlier.
--
-- Row-identity only, matching the trust level every other self-scoped
-- policy in this codebase already uses (e.g. notification_preferences'
-- user_id = current_user_id()) — column-level safety (which fields can be
-- changed) is the API layer's job: UpdateProfileInput has no role/school_id
-- fields at all, so this policy being row-scoped only isn't a new gap.

CREATE POLICY "users_update_self" ON public.users FOR UPDATE
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());
