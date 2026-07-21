-- =============================================================================
-- SUPER_ADMIN role support
-- =============================================================================
-- Platform-level role, distinct from the tenant-scoped ADMIN/TEACHER/STUDENT/
-- PARENT roles. Has no home school (school_id is null) and is restricted to
-- platform management (schools list, module toggles) — deliberately NOT given
-- access to tenant student/academic/message data. Requires several careful,
-- non-obvious fixes alongside the enum value itself; see comments below.
-- =============================================================================

-- A SUPER_ADMIN has no home school.
ALTER TABLE public.users ALTER COLUMN school_id DROP NOT NULL;

-- Patch the signup trigger: its previous guard required BOTH school_id and role
-- to be non-null, so a schoolless SUPER_ADMIN signup would silently get no
-- public.users row at all — breaking every guard/lookup that resolves identity
-- through that table. Reproduces the original function exactly, plus this one
-- relaxed condition.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_school_id uuid;
  v_role      text;
BEGIN
  v_school_id := (NEW.raw_user_meta_data->>'school_id')::uuid;
  v_role      := NEW.raw_user_meta_data->>'role';

  IF v_role IS NOT NULL AND (v_school_id IS NOT NULL OR v_role = 'SUPER_ADMIN') THEN
    INSERT INTO public.users (
      id, school_id, auth_id, email, phone, full_name, role, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_school_id,
      NEW.id,
      NEW.email,
      NEW.phone,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, NEW.phone, 'Unknown'),
      v_role::"UserRole",
      now()
    )
    ON CONFLICT (auth_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Required for /auth/me: current_school_id() resolves to NULL for a SUPER_ADMIN
-- (they have no school_id), and `school_id = NULL` is never true in SQL, so
-- users_select_same_school naturally returns zero rows for them — including
-- their own row. This is exactly why every OTHER tenant-scoped policy in this
-- database already returns nothing for a SUPER_ADMIN for free (the "no
-- backdoor into tenant data" guarantee comes from RLS that already exists, not
-- something new). This one self-select policy is the one addition needed so
-- they can still read their own row.
CREATE POLICY "users_select_self" ON public.users FOR SELECT
  USING (auth_id = auth.uid() AND deleted_at IS NULL);

-- Required, not optional: the existing users_update_admin_only WITH CHECK only
-- validates the caller's OWN row/role, never restricts what role value they
-- can write into a TARGET row. Adding the SUPER_ADMIN enum value without this
-- fix lets a same-school ADMIN self-promote via a direct PostgREST call (the
-- frontend already talks to Supabase directly with the user's own JWT in
-- several places, bypassing the NestJS API entirely).
DROP POLICY IF EXISTS "users_update_admin_only" ON public.users;
CREATE POLICY "users_update_admin_only" ON public.users FOR UPDATE
  USING (school_id = current_school_id() AND current_user_role() = 'ADMIN')
  WITH CHECK (school_id = current_school_id() AND current_user_role() = 'ADMIN' AND role <> 'SUPER_ADMIN');

-- Standard unique constraints don't dedupe across NULL school_id rows, so
-- SUPER_ADMIN accounts need their own explicit uniqueness guarantee on email.
CREATE UNIQUE INDEX IF NOT EXISTS users_super_admin_email_uidx
  ON public.users (email) WHERE role = 'SUPER_ADMIN';

-- Additive — OR's with the existing schools_select_own policy. A regular
-- ADMIN's current_user_role() is never 'SUPER_ADMIN', so this widens nothing
-- for them; it only grants visibility to the platform role.
CREATE POLICY "schools_select_super_admin" ON public.schools FOR SELECT
  USING (current_user_role() = 'SUPER_ADMIN');
