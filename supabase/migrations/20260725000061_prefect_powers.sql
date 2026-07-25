-- ============================================================
-- Prefect powers — school-wide, admin-toggleable policy per power
-- ============================================================
-- Not per-prefect. One row per (school, power_code); enabled/disabled
-- applies to every current and future holder of that role at that school.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.prefect_powers (
  id                  UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  power_code          TEXT         NOT NULL,
  applies_to          TEXT         NOT NULL CHECK (applies_to IN ('CLASS', 'SCHOOL')),
  enabled             BOOLEAN      NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by_user_id  UUID                  REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (school_id, power_code)
);

ALTER TABLE public.prefect_powers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prefect_powers_select" ON public.prefect_powers FOR SELECT
  USING (school_id = public.current_school_id());

CREATE POLICY "prefect_powers_write_admin" ON public.prefect_powers FOR ALL
  USING (school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN')
  WITH CHECK (school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN');

-- Backfill every existing school with every power, default enabled. New
-- schools going forward are seeded explicitly by SuperAdminService at
-- creation time (createSchool/onboardSchool) — this INSERT only covers
-- schools that already existed before this migration ran.
INSERT INTO public.prefect_powers (school_id, power_code, applies_to, enabled)
SELECT s.id, p.power_code, p.applies_to, true
FROM public.schools s
CROSS JOIN (VALUES
  ('view_class_behavior_leaderboard',       'CLASS'),
  ('compose_message_to_class_teacher',      'CLASS'),
  ('report_behavior_incident',              'CLASS'),
  ('view_class_attendance_summary',         'CLASS'),
  ('view_class_timetable_detailed',         'CLASS'),
  ('view_school_behavior_leaderboard_full', 'SCHOOL'),
  ('compose_message_to_admin',              'SCHOOL'),
  ('report_behavior_incident_school_wide',  'SCHOOL')
) AS p(power_code, applies_to)
ON CONFLICT (school_id, power_code) DO NOTHING;
