-- =============================================================================
-- Module registry + per-school entitlements
-- =============================================================================
-- Single source of truth for what "modules" exist (seeded via migration only,
-- no runtime "create module" UI) and which are enabled per school. Disabling a
-- module never deletes data — it's a boolean flip, enforced via RLS everywhere
-- it matters (see the companion 20260721000024 migration), not a schema change.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.modules (
  key           TEXT         NOT NULL PRIMARY KEY,
  name          TEXT         NOT NULL,
  description   TEXT         NOT NULL,
  category      TEXT         NOT NULL,
  is_core       BOOLEAN      NOT NULL DEFAULT false,
  can_disable   BOOLEAN      NOT NULL DEFAULT true,
  status        TEXT         NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMING_SOON', 'DEPRECATED')),
  dependencies  TEXT[]       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.school_modules (
  id           UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  module_key   TEXT         NOT NULL REFERENCES public.modules(key),
  enabled      BOOLEAN      NOT NULL DEFAULT true,
  config       JSONB        NOT NULL DEFAULT '{}',
  enabled_at   TIMESTAMPTZ,
  enabled_by   UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  disabled_at  TIMESTAMPTZ,
  disabled_by  UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, module_key)
);
CREATE INDEX IF NOT EXISTS school_modules_school_idx ON public.school_modules (school_id);

-- ── The enforcement primitive ────────────────────────────────────────────────
-- Same STABLE SECURITY DEFINER pattern as current_school_id()/current_user_role().
-- No row for a given (school, module) means enabled — existing schools need zero
-- backfill and keep working exactly as before this system exists.
CREATE OR REPLACE FUNCTION public.module_enabled(p_school_id UUID, p_module_key TEXT)
  RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.school_modules WHERE school_id = p_school_id AND module_key = p_module_key),
    true
  );
$$;

-- ── Data-integrity trigger ───────────────────────────────────────────────────
-- Enforced at the DB level (not just the SuperAdmin controller) because even a
-- SUPER_ADMIN's direct PostgREST write should never be able to produce an
-- inconsistent state — this is the one place this migration hard-blocks rather
-- than just warns.
CREATE OR REPLACE FUNCTION public.check_school_module_change()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_module RECORD;
  v_missing TEXT;
BEGIN
  SELECT is_core, can_disable, dependencies INTO v_module
  FROM public.modules WHERE key = NEW.module_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown module key: %', NEW.module_key;
  END IF;

  IF NEW.enabled = false AND (v_module.is_core OR NOT v_module.can_disable) THEN
    RAISE EXCEPTION 'Module % is core / cannot be disabled', NEW.module_key;
  END IF;

  IF NEW.enabled = true AND array_length(v_module.dependencies, 1) > 0 THEN
    SELECT dep INTO v_missing
    FROM unnest(v_module.dependencies) AS dep
    WHERE NOT public.module_enabled(NEW.school_id, dep)
    LIMIT 1;

    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'Module % requires % to be enabled first', NEW.module_key, v_missing;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS school_modules_check ON public.school_modules;
CREATE TRIGGER school_modules_check
  BEFORE INSERT OR UPDATE ON public.school_modules
  FOR EACH ROW EXECUTE FUNCTION public.check_school_module_change();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_modules ENABLE ROW LEVEL SECURITY;

-- Catalogue is readable by any authenticated user (everyone needs to check
-- entitlement); no write policy at all — only service-role/migrations write it.
CREATE POLICY "modules_select_all" ON public.modules FOR SELECT USING (true);

CREATE POLICY "school_modules_select_super_admin" ON public.school_modules FOR SELECT
  USING (current_user_role() = 'SUPER_ADMIN');
CREATE POLICY "school_modules_select_own_school" ON public.school_modules FOR SELECT
  USING (school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER'));
CREATE POLICY "school_modules_insert_super_admin" ON public.school_modules FOR INSERT
  WITH CHECK (current_user_role() = 'SUPER_ADMIN');
CREATE POLICY "school_modules_update_super_admin" ON public.school_modules FOR UPDATE
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');
CREATE POLICY "school_modules_delete_super_admin" ON public.school_modules FOR DELETE
  USING (current_user_role() = 'SUPER_ADMIN');

-- ── Seed the real catalogue ──────────────────────────────────────────────────
-- Mapped from actual shipped code, not an aspirational feature wishlist.

-- Core — always on, cannot be disabled
INSERT INTO public.modules (key, name, description, category, is_core, can_disable) VALUES
  ('auth',          'Authentication',          'Login, signup, password reset',                 'Core',      true, false),
  ('users',         'User Management',         'Manage user accounts and profiles',              'Core',      true, false),
  ('students',      'Student Management',      'Student records and enrollment',                 'Core',      true, false),
  ('teachers',      'Teacher Management',      'Teacher records and subject assignments',        'Core',      true, false),
  ('guardians',     'Parent Management',       'Parent/guardian accounts and student linking',   'Core',      true, false),
  ('classes',       'Class & Grade Management','Classes, subjects, and grade levels',             'Core',      true, false),
  ('timetable',     'Timetable',               'Class schedules and timetable builder',          'Core',      true, false),
  ('attendance',    'Attendance',              'Daily attendance tracking',                      'Core',      true, false),
  ('announcements', 'School Announcements',    'School-wide and targeted announcements',         'Core',      true, false),
  ('messaging',     'Parent Communication',    'Parent-teacher messaging',                       'Core',      true, false),
  ('notifications', 'Notifications',           'Email and in-app notification delivery',         'Core',      true, false),
  ('fees',          'Fee Management',          'Fee balances, arrears tracking, CSV import',      'Financial', true, false)
ON CONFLICT (key) DO NOTHING;

-- Optional — NestJS-guardable (FeatureGuard + RLS both apply)
INSERT INTO public.modules (key, name, description, category, is_core, can_disable, dependencies) VALUES
  ('payments',     'Online Fee Payment', 'Paystack/M-Pesa online fee collection',                    'Financial',     false, true, ARRAY['fees']),
  ('assessments',  'Academic Performance', 'Assessments, gradebook, and report cards',               'Academic',      false, true, '{}'),
  ('ai_features',  'AI Features', 'AI tutor, quiz generation, plagiarism detection, report comments', 'AI',            false, true, ARRAY['document_library']),
  ('api_webhooks', 'Payment Webhooks', 'Webhook endpoint registry for payment events',               'Integrations',  false, true, ARRAY['payments']),
  ('homework',     'Homework & Assignments', 'Online homework and assignment submission',            'Academic',      false, true, '{}'),
  ('events',       'Events & Calendar', 'School calendar and events with .ics export',               'Communication', false, true, '{}')
ON CONFLICT (key) DO NOTHING;

-- Optional — RLS-only (no NestJS controller exists; RLS is the sole enforcement point)
INSERT INTO public.modules (key, name, description, category, is_core, can_disable, dependencies) VALUES
  ('document_library',     'Document Library', 'Upload and share syllabi, policies, past papers',   'Academic',        false, true, '{}'),
  ('quizzes',               'Quizzes', 'In-app quizzes with auto-grading and anti-cheating',        'Academic',        false, true, '{}'),
  ('behaviour_tracking',    'Behaviour Management', 'Track student behaviour points',                'Student Welfare', false, true, '{}'),
  ('permission_slips',      'Digital Permission Slips', 'Digital permission slip creation and e-signing', 'Student Welfare', false, true, '{}'),
  ('safety_tipline',        'Safety Tip Line', 'Anonymous safety and bullying tip line',              'Student Welfare', false, true, '{}'),
  ('compliance_api',        'Compliance & API Access', 'Data export, deletion requests, scoped API tokens', 'Compliance', false, true, '{}'),
  ('substitute_management', 'Substitute Teacher Mode', 'Day-scoped substitute teacher access grants', 'Academic',        false, true, '{}')
ON CONFLICT (key) DO NOTHING;
