-- ============================================================
-- Curriculum catalog: a global, platform-level reference layer
-- (e.g. "Kenya CBC", "8-4-4") with a grade-level -> subject list
-- per curriculum. Deliberately informational only — schools keep
-- managing their own subjects/classes/terms exactly as before;
-- assigning a curriculum to a school never modifies those tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.curricula (
  id             UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT         NOT NULL,
  description    TEXT         NOT NULL DEFAULT '',
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.curriculum_subjects (
  id             UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id  UUID         NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  grade_level    INTEGER      NOT NULL,
  name           TEXT         NOT NULL,
  code           TEXT,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  UNIQUE (curriculum_id, grade_level, name)
);
CREATE INDEX IF NOT EXISTS curriculum_subjects_curriculum_idx ON public.curriculum_subjects (curriculum_id);

-- A school's assigned curriculum is purely a reference tag — never a
-- driver of that school's actual subjects/classes/terms. SET NULL so
-- deactivating/removing a curriculum can never cascade-delete a school.
ALTER TABLE public.schools ADD COLUMN curriculum_id UUID REFERENCES public.curricula(id) ON DELETE SET NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Same shape as modules/packages: catalogue readable by any authenticated
-- user, writes are SUPER_ADMIN-only (defense-in-depth — real writes go
-- through the service-role client in SuperAdminService, same as everywhere
-- else in this controller).
ALTER TABLE public.curricula ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "curricula_select_all" ON public.curricula FOR SELECT USING (true);
CREATE POLICY "curricula_write_super_admin" ON public.curricula FOR ALL
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');

CREATE POLICY "curriculum_subjects_select_all" ON public.curriculum_subjects FOR SELECT USING (true);
CREATE POLICY "curriculum_subjects_write_super_admin" ON public.curriculum_subjects FOR ALL
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');
