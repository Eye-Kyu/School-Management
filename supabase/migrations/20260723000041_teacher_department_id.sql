-- ============================================================
-- teachers.department_id — FK to the new departments table
-- ============================================================
-- Coexists with the pre-existing free-text teachers.department column
-- (added by 20260526000005_teacher_department.sql). That column is left
-- untouched (no data loss for schools that already set it); new UI writes
-- department_id instead. Existing free-text values are not auto-linked.

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS teachers_department_idx ON public.teachers (department_id);
