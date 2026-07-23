-- ============================================================
-- Fix departments soft-delete — remove the trigger, do it at the app layer
-- ============================================================
-- The AFTER UPDATE trigger added in 20260723000040_departments.sql
-- (departments_soft_delete_null_teachers) performs a nested UPDATE on
-- public.teachers whenever a department is soft-deleted. Confirmed
-- empirically against the live DB: whenever that trigger's condition is
-- true (deleted_at transitioning NULL -> NOT NULL), the OUTER departments
-- UPDATE itself is rejected by RLS ("new row violates row-level security
-- policy for table \"departments\"") — even when the nested UPDATE affects
-- zero rows. A plain deleted_at-unrelated UPDATE, or a deleted_at update
-- with no trigger side effect (condition false), both succeed cleanly, so
-- this is specifically about a trigger-performed nested write during an
-- AFTER trigger on an RLS-enabled table, not about the WITH CHECK
-- expression itself (re-verified correct in isolation).
--
-- Rather than continue chasing the exact interaction without raw SQL
-- introspection access, this switches to a functionally-equivalent
-- application-level approach: DepartmentsService.remove() now performs the
-- "null out affected teachers" step as an explicit second statement, using
-- the same forUser() RLS-scoped client (confirmed working correctly for a
-- real admin session in isolation).

DROP TRIGGER IF EXISTS departments_soft_delete_null_teachers ON public.departments;
DROP FUNCTION IF EXISTS public.null_out_teacher_department_on_soft_delete();
