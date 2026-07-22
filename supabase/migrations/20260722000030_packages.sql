-- ============================================================
-- Packages: pricing tiers + which modules they entitle a school
-- to, and which package a school is subscribed to.
--
-- Deliberately data-only in this migration — nothing here changes
-- module_enabled() or any existing entitlement enforcement. That
-- wiring (package entitlements + school overrides = effective
-- modules) is a later phase; this just establishes the registry.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.packages (
  id             UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT         NOT NULL,
  description    TEXT         NOT NULL DEFAULT '',
  price          NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency       TEXT         NOT NULL DEFAULT 'KES',
  billing_cycle  TEXT         NOT NULL DEFAULT 'MONTHLY' CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Sparse, same convention as school_modules: no row for a
-- (package, module) pair means NOT_AVAILABLE.
CREATE TABLE IF NOT EXISTS public.package_modules (
  id           UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id   UUID         NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  module_key   TEXT         NOT NULL REFERENCES public.modules(key),
  entitlement  TEXT         NOT NULL CHECK (entitlement IN ('INCLUDED', 'OPTIONAL_ADD_ON')),
  UNIQUE (package_id, module_key)
);

CREATE TABLE IF NOT EXISTS public.school_subscriptions (
  id           UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  package_id   UUID         NOT NULL REFERENCES public.packages(id),
  status       TEXT         NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  started_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS school_subscriptions_school_idx ON public.school_subscriptions (school_id);

-- At most one ACTIVE subscription per school, same partial-unique-index
-- pattern as users_super_admin_email_uidx.
CREATE UNIQUE INDEX IF NOT EXISTS school_subscriptions_one_active_uidx
  ON public.school_subscriptions (school_id) WHERE status = 'ACTIVE';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Same shape as modules/school_modules: catalogue readable by any
-- authenticated user, writes are SUPER_ADMIN-only via RLS (though in
-- practice SuperAdminService writes through the service-role client,
-- same as the rest of this controller — RLS here is defense-in-depth
-- for any direct PostgREST call using a SUPER_ADMIN's own JWT).
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packages_select_all" ON public.packages FOR SELECT USING (true);
CREATE POLICY "packages_write_super_admin" ON public.packages FOR ALL
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');

CREATE POLICY "package_modules_select_all" ON public.package_modules FOR SELECT USING (true);
CREATE POLICY "package_modules_write_super_admin" ON public.package_modules FOR ALL
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');

CREATE POLICY "school_subscriptions_select_super_admin" ON public.school_subscriptions FOR SELECT
  USING (current_user_role() = 'SUPER_ADMIN');
CREATE POLICY "school_subscriptions_select_own_school" ON public.school_subscriptions FOR SELECT
  USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "school_subscriptions_write_super_admin" ON public.school_subscriptions FOR ALL
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');

-- ── Seed 3 starter packages ──────────────────────────────────────────────────
-- Example data, not hardcoded application logic — fully editable via the
-- SuperAdmin UI this migration's companion code builds. Prices are
-- placeholders for the SuperAdmin to adjust.

INSERT INTO public.packages (id, name, description, price, billing_cycle, display_order) VALUES
  ('00000000-0000-0000-0001-000000000001', 'Essential', 'Core school management for small schools getting started.', 9999, 'MONTHLY', 1),
  ('00000000-0000-0000-0001-000000000002', 'Professional', 'Essential plus academic tools, quizzes, and student welfare features.', 24999, 'MONTHLY', 2),
  ('00000000-0000-0000-0001-000000000003', 'Enterprise', 'Everything, including AI features, payments, and integrations.', 49999, 'MONTHLY', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.package_modules (package_id, module_key, entitlement) VALUES
  -- Essential
  ('00000000-0000-0000-0001-000000000001', 'homework', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000001', 'events', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000001', 'document_library', 'OPTIONAL_ADD_ON'),
  ('00000000-0000-0000-0001-000000000001', 'permission_slips', 'OPTIONAL_ADD_ON'),
  ('00000000-0000-0000-0001-000000000001', 'safety_tipline', 'OPTIONAL_ADD_ON'),

  -- Professional
  ('00000000-0000-0000-0001-000000000002', 'homework', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000002', 'events', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000002', 'document_library', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000002', 'assessments', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000002', 'quizzes', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000002', 'permission_slips', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000002', 'safety_tipline', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000002', 'behaviour_tracking', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000002', 'payments', 'OPTIONAL_ADD_ON'),
  ('00000000-0000-0000-0001-000000000002', 'api_webhooks', 'OPTIONAL_ADD_ON'),
  ('00000000-0000-0000-0001-000000000002', 'ai_features', 'OPTIONAL_ADD_ON'),
  ('00000000-0000-0000-0001-000000000002', 'substitute_management', 'OPTIONAL_ADD_ON'),
  ('00000000-0000-0000-0001-000000000002', 'compliance_api', 'OPTIONAL_ADD_ON'),

  -- Enterprise — everything included
  ('00000000-0000-0000-0001-000000000003', 'homework', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'events', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'document_library', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'assessments', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'quizzes', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'permission_slips', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'safety_tipline', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'behaviour_tracking', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'payments', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'api_webhooks', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'ai_features', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'substitute_management', 'INCLUDED'),
  ('00000000-0000-0000-0001-000000000003', 'compliance_api', 'INCLUDED')
ON CONFLICT (package_id, module_key) DO NOTHING;
