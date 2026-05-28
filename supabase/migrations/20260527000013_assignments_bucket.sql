-- Supabase Storage bucket for assignment file submissions
INSERT INTO storage.buckets (id, name, public)
VALUES ('assignments', 'assignments', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone authenticated can read (teachers view student files)
CREATE POLICY "assignments_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'assignments');

-- Authenticated users can upload into their own student folder: submissions/{assignment_id}/{student_auth_uid}/...
CREATE POLICY "assignments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'assignments'
    AND (storage.foldername(name))[1] = 'submissions'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );

CREATE POLICY "assignments_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'assignments'
    AND (storage.foldername(name))[3] = auth.uid()::text
  );
