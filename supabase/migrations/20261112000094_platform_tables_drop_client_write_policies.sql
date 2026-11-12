-- ============================================================
-- SA-08: platform-table writes must go through the API's permission checks
-- ============================================================
-- The platform tables below had FOR ALL / INSERT / UPDATE / DELETE RLS
-- policies that checked only current_user_role() = 'SUPER_ADMIN'. The API
-- puts every write behind a specific platform permission
-- (PlatformPermissionGuard: GRANT_PRIVILEGED_ACCESS, MANAGE_BILLING,
-- MANAGE_MODULES, MANAGE_PACKAGES, MANAGE_CURRICULUM) and adds service
-- invariants: grants last at most 24h, are READ_ONLY and owned by the caller;
-- invoice status transitions are restricted; every change writes an
-- audit_logs row. A SUPER_ADMIN whose platform_permissions had been narrowed
-- could skip all of that by sending their own JWT straight to PostgREST:
-- forging or extending privileged-access grants, taking over another admin's
-- grant, marking invoices PAID, or toggling school modules, with no audit
-- trail (security audit 2026-11, SA-08).
--
-- Every legitimate writer is server-side. apps/api writes these tables only
-- through the service-role client (supabase.admin), which bypasses RLS, and
-- apps/web never writes them from the browser (checked with a repo-wide grep
-- for .from('<table>') in apps/web). The authenticated-role write policies
-- are therefore pure bypass surface, so they are dropped. SELECT policies are
-- unchanged, so super-admin read screens keep working.
--
-- Before/after verification (CLAUDE.md §6), against DIRECT_URL:
--   SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN (
--     'privileged_access_grants','privileged_access_logs','platform_invoices','school_modules',
--     'packages','package_modules','school_subscriptions','curricula','curriculum_subjects',
--     'curriculum_grade_levels','curriculum_subject_strands')
--   ORDER BY tablename, cmd;
--   BEFORE: rows with cmd ALL/INSERT/UPDATE/DELETE for the policies dropped below.
--   AFTER:  only SELECT rows remain for these tables.
--   Then exercise one super-admin write per area through the API on a
--   NON-production project (create grant, update invoice, toggle module) and
--   confirm each still succeeds.
-- ============================================================

DROP POLICY IF EXISTS "privileged_access_grants_write_super_admin" ON public.privileged_access_grants;
DROP POLICY IF EXISTS "privileged_access_logs_insert_super_admin"  ON public.privileged_access_logs;
DROP POLICY IF EXISTS "platform_invoices_write_super_admin"        ON public.platform_invoices;
DROP POLICY IF EXISTS "school_modules_insert_super_admin"          ON public.school_modules;
DROP POLICY IF EXISTS "school_modules_update_super_admin"          ON public.school_modules;
DROP POLICY IF EXISTS "school_modules_delete_super_admin"          ON public.school_modules;
DROP POLICY IF EXISTS "packages_write_super_admin"                 ON public.packages;
DROP POLICY IF EXISTS "package_modules_write_super_admin"          ON public.package_modules;
DROP POLICY IF EXISTS "school_subscriptions_write_super_admin"     ON public.school_subscriptions;
DROP POLICY IF EXISTS "curricula_write_super_admin"                ON public.curricula;
DROP POLICY IF EXISTS "curriculum_subjects_write_super_admin"      ON public.curriculum_subjects;
DROP POLICY IF EXISTS "curriculum_grade_levels_write_super_admin"  ON public.curriculum_grade_levels;
DROP POLICY IF EXISTS "curriculum_subject_strands_write_super_admin" ON public.curriculum_subject_strands;

INSERT INTO public._migration_log (filename) VALUES ('20261112000094_platform_tables_drop_client_write_policies.sql') ON CONFLICT (filename) DO NOTHING;
