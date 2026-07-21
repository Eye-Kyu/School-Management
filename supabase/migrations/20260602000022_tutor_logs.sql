-- AI tutor session logs — one row per Q&A turn, grouped by conversation_id,
-- so teachers/admins can review what the tutor told students.
CREATE TABLE IF NOT EXISTS public.tutor_logs (
  id              UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id      UUID         NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  conversation_id UUID         NOT NULL,
  question        TEXT         NOT NULL,
  answer          TEXT         NOT NULL,
  documents_used  TEXT[]       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tutor_logs_conversation_idx ON public.tutor_logs (conversation_id);
CREATE INDEX IF NOT EXISTS tutor_logs_school_idx ON public.tutor_logs (school_id);

ALTER TABLE public.tutor_logs ENABLE ROW LEVEL SECURITY;

-- Teachers/admins review sessions within their own school.
CREATE POLICY "tutor_logs_select" ON public.tutor_logs
  FOR SELECT USING (
    school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER')
  );

-- Writes happen server-side only, via the service-role client (AiService),
-- never directly from a browser client — no INSERT/UPDATE/DELETE policy for
-- authenticated/anon roles, so RLS blocks everything except service-role.
