-- ============================================================
-- One class teacher per class
-- ============================================================
-- Enforces at the DB level what was previously only a convention:
-- teachers.is_class_teacher_of already existed as a plain nullable FK with
-- no uniqueness constraint, so two teachers could both be set as class
-- teacher of the same class.

CREATE UNIQUE INDEX IF NOT EXISTS teachers_class_teacher_unique
  ON public.teachers (is_class_teacher_of)
  WHERE is_class_teacher_of IS NOT NULL;
