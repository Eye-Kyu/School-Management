-- ============================================================
-- Departments (plain — no department heads yet, see EXECUTION_PLAN.md)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.departments (
  id          UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name        TEXT         NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS departments_school_idx ON public.departments (school_id);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_select_same_school" ON public.departments FOR SELECT
  USING (school_id = public.current_school_id() AND deleted_at IS NULL);

CREATE POLICY "departments_insert_admin_only" ON public.departments FOR INSERT
  WITH CHECK (school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN');

-- "Delete" is a soft delete (UPDATE deleted_at), per spec — there is no
-- separate DELETE policy/path, everything goes through this UPDATE policy.
CREATE POLICY "departments_update_admin_only" ON public.departments FOR UPDATE
  USING (school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN')
  WITH CHECK (school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN');

-- Soft-deleting a department (deleted_at NULL -> NOT NULL) nulls department_id
-- on any teacher that pointed at it. A trigger is used rather than relying on
-- the FK's ON DELETE SET NULL, since the row is never actually DELETEd.
CREATE OR REPLACE FUNCTION public.null_out_teacher_department_on_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.teachers SET department_id = NULL WHERE department_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS departments_soft_delete_null_teachers ON public.departments;
CREATE TRIGGER departments_soft_delete_null_teachers
  AFTER UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.null_out_teacher_department_on_soft_delete();
