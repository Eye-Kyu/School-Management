-- TEMPORARY diagnostic — will be dropped in a follow-up migration once the
-- gradebook RLS investigation is done. Read-only, SECURITY DEFINER, returns
-- live pg_policies rows as JSON so they can be inspected via a normal RPC
-- call (direct Postgres/pg_catalog access isn't reachable from this
-- environment's network path to the pooler).
DROP FUNCTION IF EXISTS public.diag_check_policies();

CREATE FUNCTION public.diag_check_policies()
  RETURNS TABLE(tablename text, policyname text, permissive text, roles name[], cmd text, qual text)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT tablename, policyname, permissive, roles, cmd, qual
  FROM pg_policies
  WHERE tablename IN ('assessments','assignments','grades','submissions')
  ORDER BY tablename, policyname;
$$;

REVOKE ALL ON FUNCTION public.diag_check_policies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diag_check_policies() TO authenticated, service_role;
