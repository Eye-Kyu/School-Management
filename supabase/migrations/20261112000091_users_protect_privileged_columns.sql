-- ============================================================
-- SA-11: block self-escalation through users_update_self
-- ============================================================
-- users_update_self (20260723000051) is a permissive FOR UPDATE policy scoped
-- only by row identity (auth_id = auth.uid()). Permissive policies OR
-- together, so the role <> 'SUPER_ADMIN' WITH CHECK in
-- users_update_admin_only (20260721000026) never constrains a self-update.
-- The browser holds the anon key and the user's JWT, so any STUDENT, PARENT
-- or TEACHER could PATCH /rest/v1/users?auth_id=eq.<own uid> and set role,
-- school_id or platform_permissions. Those are exactly the columns that
-- current_user_role(), current_school_id(), SuperAdminGuard and
-- PlatformPermissionGuard trust. That would be platform or cross-tenant
-- takeover (security audit 2026-11, SA-11).
--
-- RLS cannot restrict columns, so a BEFORE UPDATE trigger enforces it:
-- a caller with a user JWT (auth.uid() IS NOT NULL) may not change the
-- privileged columns of their OWN row. Service-role calls (the NestJS admin
-- client) and direct database connections carry no auth.uid() and are
-- unaffected, so admin and platform flows (createUser upserts,
-- updateUserStatus, platform permission edits, soft deletes) keep working.
-- Profile fields (full_name, phone, avatar_url, email, last_login_at,
-- updated_at) remain self-editable, which is everything
-- UsersService.updateMe writes.
--
-- Note: this deliberately applies to ADMINs editing their OWN row too. An
-- ADMIN changing another user's row is still governed by
-- users_update_admin_only.
--
-- Triggers fire for every caller role (CLAUDE.md §3), which is why the
-- service-role exemption is explicit.
--
-- Before/after verification (CLAUDE.md §6), run against DIRECT_URL:
--   BEFORE:
--     SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.users'::regclass AND NOT tgisinternal;
--     -- expect: no users_block_privileged_self_update row
--   AFTER: the same query returns users_block_privileged_self_update. Then,
--   as a dummy STUDENT JWT on a NON-production project:
--     PATCH /rest/v1/users?auth_id=eq.<uid>  body {"role":"SUPER_ADMIN"}  -> 403 / 42501
--     PATCH /rest/v1/users?auth_id=eq.<uid>  body {"full_name":"x"}       -> 200
-- ============================================================

CREATE OR REPLACE FUNCTION public.users_block_privileged_self_update()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  -- Service role and direct connections: no end-user identity, not restricted here.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.auth_id = auth.uid() AND (
       NEW.role                 IS DISTINCT FROM OLD.role
    OR NEW.school_id            IS DISTINCT FROM OLD.school_id
    OR NEW.platform_permissions IS DISTINCT FROM OLD.platform_permissions
    OR NEW.is_active            IS DISTINCT FROM OLD.is_active
    OR NEW.deleted_at           IS DISTINCT FROM OLD.deleted_at
    OR NEW.auth_id              IS DISTINCT FROM OLD.auth_id
    OR NEW.id                   IS DISTINCT FROM OLD.id
  ) THEN
    RAISE EXCEPTION 'users: role, school, permissions, status and identity columns cannot be changed on your own account'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_block_privileged_self_update ON public.users;
CREATE TRIGGER users_block_privileged_self_update
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_block_privileged_self_update();

INSERT INTO public._migration_log (filename) VALUES ('20261112000091_users_protect_privileged_columns.sql') ON CONFLICT (filename) DO NOTHING;
