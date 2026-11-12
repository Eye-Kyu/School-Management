-- ============================================================
-- SA-10: signup trigger must not trust client-supplied role/school
-- ============================================================
-- handle_new_auth_user() (latest: 20260723000053) took role and school_id
-- from auth.users.raw_user_meta_data. That is user_metadata, which any
-- client can set on a public supabase.auth.signUp({ options: { data } })
-- call and change later with auth.updateUser({ data }). A self-signup with
-- {"role":"SUPER_ADMIN"} got a SUPER_ADMIN row with all 18 platform
-- permissions. {"role":"ADMIN","school_id":<uuid>} got admin of that school
-- (security audit 2026-11, SA-10).
--
-- Fix: read role and school_id from raw_app_meta_data, which only the
-- service-role admin API (auth.admin.createUser / updateUserById) can write.
-- Every server-side createUser call site now sets app_metadata.{role,school_id}
-- (apps/api/src/{teachers,students,guardians,platform-users,super-admin} and
-- apps/api/scripts/lib/seed-people.ts). full_name is display-only, so it is
-- still read from user_metadata.
--
-- Signature, SECURITY DEFINER, search_path and the permission list are
-- unchanged from 20260723000053. Only the two source fields move. Existing
-- public.users rows are unaffected (the trigger runs only on auth.users INSERT).
--
-- Before/after verification (CLAUDE.md §6), against DIRECT_URL:
--   SELECT pg_get_functiondef('public.handle_new_auth_user()'::regprocedure) ~ 'raw_app_meta_data';
--   BEFORE: false   AFTER: true
--   Then on a NON-production project: a public signUp with data {role:'SUPER_ADMIN'}
--   must create NO public.users row, and an API-created teacher must still get one.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_school_id   uuid;
  v_role        text;
  v_permissions text[];
BEGIN
  -- app_metadata is service-role-only; user_metadata is client-writable.
  v_school_id := (NEW.raw_app_meta_data->>'school_id')::uuid;
  v_role      := NEW.raw_app_meta_data->>'role';

  IF v_role = 'SUPER_ADMIN' THEN
    v_permissions := ARRAY[
      'VIEW_SCHOOLS', 'MANAGE_SCHOOLS', 'VIEW_MODULES', 'MANAGE_MODULES',
      'VIEW_PACKAGES', 'MANAGE_PACKAGES', 'VIEW_CURRICULUM', 'MANAGE_CURRICULUM',
      'VIEW_PLATFORM_USERS', 'MANAGE_PLATFORM_USERS', 'VIEW_BILLING', 'MANAGE_BILLING',
      'VIEW_PLATFORM_ANALYTICS', 'VIEW_AUDIT_LOGS', 'GRANT_PRIVILEGED_ACCESS',
      'VIEW_SYSTEM_HEALTH', 'MANAGE_PLATFORM_SETTINGS', 'SEND_PLATFORM_MESSAGES'
    ];
  ELSE
    v_permissions := '{}';
  END IF;

  IF v_role IS NOT NULL AND (v_school_id IS NOT NULL OR v_role = 'SUPER_ADMIN') THEN
    INSERT INTO public.users (
      id, school_id, auth_id, email, phone, full_name, role, platform_permissions, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_school_id,
      NEW.id,
      NEW.email,
      NEW.phone,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, NEW.phone, 'Unknown'),
      v_role::"UserRole",
      v_permissions,
      now()
    )
    ON CONFLICT (auth_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

INSERT INTO public._migration_log (filename) VALUES ('20261112000092_signup_trigger_app_metadata.sql') ON CONFLICT (filename) DO NOTHING;
