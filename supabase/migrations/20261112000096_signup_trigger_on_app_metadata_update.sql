-- ============================================================
-- SA-10 follow-up: provision public.users when app_metadata is written
-- ============================================================
-- 20261112000092 moved handle_new_auth_user() to read role/school_id from
-- raw_app_meta_data, which only the service-role admin API can set. Live
-- verification (apps/api/test/security-audit-v1.e2e-spec.ts) showed GoTrue's
-- admin createUser({ app_metadata }) INSERTs auth.users with only the default
-- provider metadata, then writes the caller's app_metadata in a separate
-- UPDATE. The existing AFTER INSERT trigger (on_auth_user_created) therefore
-- never sees role/school_id and creates no public.users row. Code paths that
-- rely on the trigger (platform-users.service.ts createSuperAdmin) would
-- break.
--
-- Fix: also run the same function AFTER UPDATE on auth.users when
-- raw_app_meta_data changes. The function is idempotent: INSERT ... ON
-- CONFLICT (auth_id) DO NOTHING, so existing users are never modified and a
-- re-run on later app_metadata edits is a no-op. user_metadata changes
-- (client-writable) do not fire it, and app_metadata is service-role-only, so
-- this adds no client-reachable path.
--
-- Before/after verification (CLAUDE.md §6), against DIRECT_URL:
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal ORDER BY tgname;
--   BEFORE: on_auth_user_created
--   AFTER:  on_auth_user_app_metadata_updated, on_auth_user_created
--   Then: admin.createUser({ app_metadata: { role:'TEACHER', school_id:<existing school> } })
--   produces exactly one public.users row (security-audit-v1.e2e-spec.ts, SA-10 cases).
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_app_metadata_updated ON auth.users;
CREATE TRIGGER on_auth_user_app_metadata_updated
  AFTER UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW
  WHEN (NEW.raw_app_meta_data IS DISTINCT FROM OLD.raw_app_meta_data)
  EXECUTE FUNCTION public.handle_new_auth_user();

INSERT INTO public._migration_log (filename) VALUES ('20261112000096_signup_trigger_on_app_metadata_update.sql') ON CONFLICT (filename) DO NOTHING;
