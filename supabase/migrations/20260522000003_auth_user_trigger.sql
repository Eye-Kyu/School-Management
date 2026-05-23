-- =============================================================================
-- Migration: auth_user_trigger
-- =============================================================================
-- Creates a trigger that fires after a new user is inserted into auth.users.
-- It mirrors a minimal row into public.users so the app can look up school_id
-- and role without a Supabase Auth metadata query.
--
-- The trigger only runs for users who were created with user_metadata containing
-- a school_id and role (set by the admin flow). Self-service signups that lack
-- this metadata are left for the onboarding flow to complete.
-- =============================================================================

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
  -- Only mirror if the admin embedded school_id + role in user_metadata.
  v_school_id := (NEW.raw_user_meta_data->>'school_id')::uuid;
  v_role      := NEW.raw_user_meta_data->>'role';

  IF v_school_id IS NOT NULL AND v_role IS NOT NULL THEN
    INSERT INTO public.users (
      id,
      school_id,
      auth_id,
      email,
      phone,
      full_name,
      role,
      updated_at
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

-- Drop and recreate to ensure idempotency.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();
