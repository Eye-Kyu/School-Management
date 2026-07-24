-- ============================================================
-- Cleanup: rogue "assessments_school_isolation" policy + temp diagnostic
-- ============================================================
-- Discovered while validating 20260724000054_tighten_gradebook_rls.sql live:
-- `assessments` carried a SECOND, PERMISSIVE, ALL-command policy —
-- "assessments_school_isolation" (USING school_id = (SELECT users.school_id
-- FROM users WHERE users.auth_id = auth.uid())) — that is not defined in any
-- migration file (likely created ad hoc, e.g. via the Studio UI's RLS
-- wizard). Postgres ORs multiple PERMISSIVE policies for the same command
-- together, so this generic school-wide grant was silently undermining the
-- new class/own-row-scoped assess_select from 20260724000054: it was
-- invisible before that migration because it was redundant with the OLD
-- (also school-wide-only) assess_select, and only became the dominant,
-- leak-causing policy once assess_select was tightened. No equivalent rogue
-- policy exists on assignments/grades/submissions — confirmed via the
-- temporary diag_check_policies() introspection function added in
-- 20260724000055_diag_temp.sql, which is also dropped here now that it's
-- served its purpose.
DROP POLICY IF EXISTS "assessments_school_isolation" ON public.assessments;

DROP FUNCTION IF EXISTS public.diag_check_policies();
