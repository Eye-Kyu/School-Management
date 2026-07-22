-- ============================================================
-- Platform permissions — granular, additive layer on top of the
-- SUPER_ADMIN role, so capabilities can later be split across
-- multiple platform-level roles (PLATFORM_SUPPORT, PLATFORM_FINANCE,
-- etc.) without a schema change. Every existing SUPER_ADMIN account
-- is backfilled with every permission below — no behavior change.
-- ============================================================

ALTER TABLE public.users ADD COLUMN platform_permissions TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.users SET platform_permissions = ARRAY[
  'VIEW_SCHOOLS',
  'MANAGE_SCHOOLS',
  'VIEW_MODULES',
  'MANAGE_MODULES',
  'VIEW_PACKAGES',
  'MANAGE_PACKAGES',
  'VIEW_CURRICULUM',
  'MANAGE_CURRICULUM',
  'VIEW_PLATFORM_USERS',
  'MANAGE_PLATFORM_USERS',
  'VIEW_BILLING',
  'MANAGE_BILLING',
  'VIEW_PLATFORM_ANALYTICS',
  'VIEW_AUDIT_LOGS',
  'GRANT_PRIVILEGED_ACCESS',
  'VIEW_SYSTEM_HEALTH',
  'MANAGE_PLATFORM_SETTINGS'
]
WHERE role = 'SUPER_ADMIN';

-- Patch the signup trigger so a NEWLY created SUPER_ADMIN account (manual
-- provisioning, or any future self-service platform-account flow) also gets
-- every permission — otherwise the above backfill only covers accounts that
-- existed before this migration ran, and every SuperAdmin created afterward
-- would silently start with zero permissions. Reproduces the trigger from
-- supabase/migrations/20260721000026_super_admin_role.sql exactly, plus this
-- one addition.
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
  v_school_id := (NEW.raw_user_meta_data->>'school_id')::uuid;
  v_role      := NEW.raw_user_meta_data->>'role';

  IF v_role = 'SUPER_ADMIN' THEN
    v_permissions := ARRAY[
      'VIEW_SCHOOLS', 'MANAGE_SCHOOLS', 'VIEW_MODULES', 'MANAGE_MODULES',
      'VIEW_PACKAGES', 'MANAGE_PACKAGES', 'VIEW_CURRICULUM', 'MANAGE_CURRICULUM',
      'VIEW_PLATFORM_USERS', 'MANAGE_PLATFORM_USERS', 'VIEW_BILLING', 'MANAGE_BILLING',
      'VIEW_PLATFORM_ANALYTICS', 'VIEW_AUDIT_LOGS', 'GRANT_PRIVILEGED_ACCESS',
      'VIEW_SYSTEM_HEALTH', 'MANAGE_PLATFORM_SETTINGS'
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
