-- ============================================================
-- Subscription change preview: simulate the effective-entitlement
-- resolution for a hypothetical package, without touching real
-- data. Mirrors module_enabled()/effective_enabled_modules() from
-- the entitlement engine exactly, parameterizing the package
-- instead of looking it up from school_subscriptions, so a
-- preview can never drift from what actually happens on switch.
-- ============================================================

CREATE OR REPLACE FUNCTION public.simulate_module_enabled(p_school_id UUID, p_hypothetical_package_id UUID, p_module_key TEXT)
  RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.school_modules WHERE school_id = p_school_id AND module_key = p_module_key),
    (SELECT true FROM public.modules WHERE key = p_module_key AND is_core = true),
    (SELECT pm.entitlement = 'INCLUDED'
       FROM public.package_modules pm
       WHERE pm.package_id = p_hypothetical_package_id AND pm.module_key = p_module_key),
    (CASE WHEN p_hypothetical_package_id IS NOT NULL THEN false END),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.simulate_effective_modules(p_school_id UUID, p_hypothetical_package_id UUID)
  RETURNS TABLE(module_key TEXT) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT m.key FROM public.modules m WHERE public.simulate_module_enabled(p_school_id, p_hypothetical_package_id, m.key);
$$;
