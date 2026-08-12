-- ============================================================
-- module_enabled(): recursive dependency enforcement
-- ============================================================
-- Prior versions of this function (20260721000023, 20260722000031) never
-- consulted modules.dependencies when resolving a module's effective state
-- — dependencies were only ever checked write-time, by the
-- check_school_module_change() trigger, which blocks *enabling* a module
-- before its dependency is enabled but does nothing to a module that is
-- already enabled when its dependency is later disabled out from under it.
-- That gap is what this PR's AI sub-modules need closed: a real "parent off
-- implies child off" master-switch requires dependencies to be re-checked
-- on every read, not just at the moment a row is written.
--
-- This also closes the same pre-existing gap in ai_features' own
-- (pre-this-PR) document_library dependency and in payments->fees,
-- api_webhooks->payments — not new risk, a correctness fix to a mechanism
-- that already existed but never actually did what its name implied.
--
-- IMPORTANT — signature must not change. module_enabled(uuid, text) is
-- referenced BY EXACT SIGNATURE from 30+ RLS policies across document_chunks,
-- quizzes, quiz_questions, quiz_attempts, behaviour_points, permission_slips,
-- permission_slip_responses, safety_tips, api_tokens, deletion_requests,
-- substitute_grants, and documents (confirmed live via pg_proc dependency
-- walk before writing this migration). CREATE OR REPLACE only truly
-- replaces a function when the argument list is identical — adding a
-- trailing DEFAULT-valued parameter creates a SECOND overload instead,
-- leaving every existing 2-arg caller (FeatureGuard's RPC call included)
-- ambiguous ("function module_enabled(uuid, text) is not unique") since
-- Postgres can no longer tell which overload a 2-arg call should resolve
-- to. Confirmed this by attempting exactly that during development and
-- immediately reverting once caught by this migration's own before/after
-- verification step — recorded here so the mistake isn't repeated.
--
-- The fix: module_enabled(uuid, text) keeps its exact original signature,
-- staying a trivial one-line `sql` wrapper. The actual recursive,
-- depth-guarded walk lives in a new, separately-named helper function
-- (module_enabled_at_depth) with no existing dependents to break.
-- ============================================================

CREATE OR REPLACE FUNCTION public.module_enabled_at_depth(p_school_id UUID, p_module_key TEXT, p_depth INT)
  RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_own_state BOOLEAN;
  v_deps TEXT[];
  v_dep TEXT;
BEGIN
  -- Defensive cycle guard. The registry should never nest this deep (or at
  -- all, cyclically) — this exists purely so a future data-entry mistake
  -- fails closed instead of exhausting the Postgres call stack.
  IF p_depth > 10 THEN
    RETURN false;
  END IF;

  -- Unchanged priority chain from 20260722000031_entitlement_engine.sql:
  -- (1) explicit school_modules override, (2) core, (3) active
  -- subscription's package entitlement, (4) active subscription but module
  -- absent from package, (5) no active subscription at all -> true.
  v_own_state := COALESCE(
    (SELECT enabled FROM public.school_modules WHERE school_id = p_school_id AND module_key = p_module_key),
    (SELECT true FROM public.modules WHERE key = p_module_key AND is_core = true),
    (SELECT pm.entitlement = 'INCLUDED'
       FROM public.school_subscriptions ss
       JOIN public.package_modules pm ON pm.package_id = ss.package_id AND pm.module_key = p_module_key
       WHERE ss.school_id = p_school_id AND ss.status = 'ACTIVE'),
    (SELECT false FROM public.school_subscriptions ss WHERE ss.school_id = p_school_id AND ss.status = 'ACTIVE'),
    true
  );

  -- Short-circuit: no need to walk dependencies if this module's own state
  -- already resolved to disabled.
  IF v_own_state = false THEN
    RETURN false;
  END IF;

  SELECT dependencies INTO v_deps FROM public.modules WHERE key = p_module_key;
  IF v_deps IS NULL OR array_length(v_deps, 1) IS NULL THEN
    RETURN v_own_state; -- base case: no dependencies to check
  END IF;

  FOREACH v_dep IN ARRAY v_deps LOOP
    IF NOT public.module_enabled_at_depth(p_school_id, v_dep, p_depth + 1) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

-- Same signature as every prior version — every existing RLS policy and
-- .rpc('module_enabled', {p_school_id, p_module_key}) call site keeps
-- working completely unchanged.
CREATE OR REPLACE FUNCTION public.module_enabled(p_school_id UUID, p_module_key TEXT)
  RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.module_enabled_at_depth(p_school_id, p_module_key, 0);
$$;

INSERT INTO public._migration_log (filename) VALUES ('20260728000088_module_enabled_recursive_dependencies.sql') ON CONFLICT (filename) DO NOTHING;
