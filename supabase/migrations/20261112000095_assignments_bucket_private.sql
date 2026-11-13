-- ============================================================
-- SA-02: make the `assignments` Storage bucket private and tenant-scoped
-- ============================================================
-- 20260527000013 created the bucket with public = true and a SELECT policy of
-- just bucket_id = 'assignments' (no TO clause, so anon too). Every student
-- submission file was therefore readable by anyone with, or able to list,
-- the object path, across schools and unauthenticated (security audit
-- 2026-11, SA-02). The `documents` bucket had the same problem and was fixed
-- in 20260728000084 (BUG-10). This applies the equivalent fix here.
--
-- New model (paired with apps/web changes in the same PR):
--   * bucket is private; files are opened with short-lived signed URLs;
--   * object path = submissions/<assignment_id>/<uploader auth uid>/<file>;
--   * INSERT/UPDATE: only a STUDENT, only into their own auth-uid folder, and
--     only for an assignment in their own school;
--   * SELECT (needed for createSignedUrl): the uploading student, or a
--     TEACHER/ADMIN of the assignment's school.
--
-- Existing objects keep their paths. The previous client uploaded under
-- students.id, not auth.uid(), which the old INSERT policy rejected, so few
-- or no objects are expected. Any that exist stay readable by staff of the
-- assignment's school.
--
-- Before/after verification (CLAUDE.md §6), against DIRECT_URL:
--   SELECT id, public FROM storage.buckets WHERE id = 'assignments';
--   SELECT policyname, roles, cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'assignments%';
--   BEFORE: public = t; assignments_read with roles {public}.
--   AFTER:  public = f; assignments_select_scoped / _insert_own / _update_own with roles {authenticated}.
--   Then on a NON-production project: GET .../object/public/assignments/<path> -> 400/404;
--   a student from another school cannot createSignedUrl for the path.
-- ============================================================

UPDATE storage.buckets SET public = false WHERE id = 'assignments';

DROP POLICY IF EXISTS "assignments_read"   ON storage.objects;
DROP POLICY IF EXISTS "assignments_insert" ON storage.objects;
DROP POLICY IF EXISTS "assignments_update" ON storage.objects;

CREATE POLICY "assignments_select_scoped" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'assignments'
    AND (storage.foldername(name))[1] = 'submissions'
    AND (
      (storage.foldername(name))[3] = auth.uid()::text
      OR (
        public.current_user_role() IN ('TEACHER', 'ADMIN')
        AND EXISTS (
          SELECT 1 FROM public.assignments a
          WHERE a.id::text = (storage.foldername(name))[2]
            AND a.school_id = public.current_school_id()
        )
      )
    )
  );

CREATE POLICY "assignments_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'assignments'
    AND (storage.foldername(name))[1] = 'submissions'
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND public.current_user_role() = 'STUDENT'
    AND EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id::text = (storage.foldername(name))[2]
        AND a.school_id = public.current_school_id()
    )
  );

CREATE POLICY "assignments_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'assignments'
    AND (storage.foldername(name))[1] = 'submissions'
    AND (storage.foldername(name))[3] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'assignments'
    AND (storage.foldername(name))[1] = 'submissions'
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND public.current_user_role() = 'STUDENT'
    AND EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id::text = (storage.foldername(name))[2]
        AND a.school_id = public.current_school_id()
    )
  );

INSERT INTO public._migration_log (filename) VALUES ('20261112000095_assignments_bucket_private.sql') ON CONFLICT (filename) DO NOTHING;
