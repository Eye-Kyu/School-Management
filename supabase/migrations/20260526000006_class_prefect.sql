-- Add prefect_student_id to classes table
ALTER TABLE public.classes
  ADD COLUMN prefect_student_id UUID REFERENCES public.students(id) ON DELETE SET NULL;

-- Allow the class teacher to update the prefect on their own class.
-- (Admin can update via the existing admin-only policy.)
CREATE POLICY "classes_update_prefect_by_classteacher" ON public.classes FOR UPDATE
  USING (
    id IN (
      SELECT t.is_class_teacher_of
      FROM public.teachers t
      JOIN public.users u ON u.id = t.user_id
      WHERE u.auth_id = auth.uid()
        AND u.deleted_at IS NULL
        AND t.is_class_teacher_of IS NOT NULL
    )
  )
  WITH CHECK (
    id IN (
      SELECT t.is_class_teacher_of
      FROM public.teachers t
      JOIN public.users u ON u.id = t.user_id
      WHERE u.auth_id = auth.uid()
        AND u.deleted_at IS NULL
        AND t.is_class_teacher_of IS NOT NULL
    )
  );
