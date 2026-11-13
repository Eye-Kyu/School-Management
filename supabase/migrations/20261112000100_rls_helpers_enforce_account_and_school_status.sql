-- ============================================================
-- SA-37 / SA-34: deactivated users and non-ACTIVE schools lose access
-- ============================================================
-- updateUserStatus sets users.is_active = false and updateSchoolStatus sets
-- schools.status to INACTIVE/SUSPENDED/ARCHIVED, but no guard or RLS helper
-- ever read either column. Deactivated staff and users of suspended schools
-- kept full API and RLS access until their JWT expired, and could refresh
-- indefinitely (security audit 2026-11, SA-37 / SA-34).
--
-- Fix: the four RLS identity helpers (CREATE OR REPLACE, IDENTICAL zero-arg
-- signatures, so no overload; CLAUDE.md §6) now also require
--   * users.is_active, and
--   * the user's school to be status = 'ACTIVE' (SUPER_ADMIN rows have
--     school_id NULL and are unaffected by school status).
-- When either fails every helper returns NULL, so every RLS policy built on
-- them fails closed in one place. AuthGuard applies the same rule for
-- service-role API paths (apps/api/src/auth/auth.guard.ts).
--
-- current_user_id() is the BUG-13 function (redefined in _047). This is now
-- its latest definition. Grep for the newest CREATE OR REPLACE when tracing it.
-- SET search_path = public is added as hardening; bodies stay schema-qualified.
--
-- Pre-check (2026-11-12, live): schools by status = {ACTIVE: 2}; users =
-- {is_active true, not deleted: 788}. No current account loses access.
--
-- Before/after verification (CLAUDE.md §6), against DIRECT_URL:
--   SELECT p.proname, pg_get_functiondef(p.oid) ~ 'is_active' AS checks_active,
--          pg_get_functiondef(p.oid) ~ 'ACTIVE''' AS checks_school
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname IN ('current_user_id','current_school_id','current_user_role','guardian_student_ids');
--   BEFORE: all false.  AFTER: all true. Live behaviour: security-audit-v2.e2e-spec.ts.
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_user_id()
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.id FROM public.users u
  LEFT JOIN public.schools s ON s.id = u.school_id
  WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL AND u.is_active
    AND (u.school_id IS NULL OR s.status = 'ACTIVE')
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_school_id()
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.school_id FROM public.users u
  LEFT JOIN public.schools s ON s.id = u.school_id
  WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL AND u.is_active
    AND (u.school_id IS NULL OR s.status = 'ACTIVE')
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT u.role::text FROM public.users u
  LEFT JOIN public.schools s ON s.id = u.school_id
  WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL AND u.is_active
    AND (u.school_id IS NULL OR s.status = 'ACTIVE')
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.guardian_student_ids()
  RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(ARRAY(
    SELECT g.student_id FROM public.guardians g
    JOIN public.users u ON u.id = g.user_id
    LEFT JOIN public.schools s ON s.id = u.school_id
    WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL AND u.is_active
      AND (u.school_id IS NULL OR s.status = 'ACTIVE')
  ), '{}'::uuid[]);
$$;

INSERT INTO public._migration_log (filename) VALUES ('20261112000100_rls_helpers_enforce_account_and_school_status.sql') ON CONFLICT (filename) DO NOTHING;
