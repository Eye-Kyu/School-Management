-- ============================================================
-- Entitlement engine: wire packages + school overrides into the
-- real effective-entitlement computation.
--
-- Resolution priority (see docs on the SuperAdmin control-plane
-- refactor for the full branch-by-branch NULL analysis):
--   1. Explicit school_modules override — always wins.
--   2. Core modules — always enabled.
--   3. Active subscription's package_modules entry, if any
--      (INCLUDED -> true, OPTIONAL_ADD_ON -> false).
--   4. Active subscription exists but module has no entry in the
--      package -> false (NOT_AVAILABLE).
--   5. No active subscription at all -> true. This is today's
--      exact default, preserved verbatim, so every existing
--      school (all of which have zero subscriptions today) sees
--      zero behavior change from this migration.
-- ============================================================

CREATE OR REPLACE FUNCTION public.module_enabled(p_school_id UUID, p_module_key TEXT)
  RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.school_modules WHERE school_id = p_school_id AND module_key = p_module_key),
    (SELECT true FROM public.modules WHERE key = p_module_key AND is_core = true),
    (SELECT pm.entitlement = 'INCLUDED'
       FROM public.school_subscriptions ss
       JOIN public.package_modules pm ON pm.package_id = ss.package_id AND pm.module_key = p_module_key
       WHERE ss.school_id = p_school_id AND ss.status = 'ACTIVE'),
    (SELECT false FROM public.school_subscriptions ss WHERE ss.school_id = p_school_id AND ss.status = 'ACTIVE'),
    true
  );
$$;

-- Single source of truth for "which modules is this school actually
-- entitled to right now" — used by /auth/me (nav filtering) and by
-- the SuperAdmin school-detail module list, replacing two places that
-- previously duplicated the old "no row = enabled" logic in
-- application code instead of calling module_enabled().
CREATE OR REPLACE FUNCTION public.effective_enabled_modules(p_school_id UUID)
  RETURNS TABLE(module_key TEXT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT m.key FROM public.modules m WHERE public.module_enabled(p_school_id, m.key);
$$;
