-- ============================================================
-- Bucket 1, PR 3 — document_downloads + aggregated-only visibility
-- ============================================================
-- Mirrors class_average_scores() (20260724000054_tighten_gradebook_rls.sql)
-- exactly: raw per-row download events are visible only to the row's own
-- actor (no teacher/admin can browse "who downloaded what" via a raw
-- SELECT), and a SECURITY DEFINER aggregate function is the only way to
-- get cross-user counts — deliberately restricted to ADMIN/TEACHER callers
-- (download counts read as teacher/admin analytics, not something a
-- student needs visibility into about their peers).

CREATE TABLE public.document_downloads (
  id            UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID        NOT NULL REFERENCES public.schools(id)   ON DELETE CASCADE,
  document_id   UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX document_downloads_document_idx ON public.document_downloads (document_id, downloaded_at DESC);

ALTER TABLE public.document_downloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_downloads_select_own" ON public.document_downloads FOR SELECT USING (
  school_id = public.current_school_id() AND user_id = public.current_user_id()
);

CREATE POLICY "doc_downloads_insert_own" ON public.document_downloads FOR INSERT WITH CHECK (
  school_id = public.current_school_id() AND user_id = public.current_user_id()
);

CREATE OR REPLACE FUNCTION public.document_download_counts(p_document_ids UUID[])
  RETURNS TABLE(document_id UUID, download_count INT, unique_user_count INT)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT dd.document_id, COUNT(*)::int, COUNT(DISTINCT dd.user_id)::int
  FROM public.document_downloads dd
  JOIN public.documents d ON d.id = dd.document_id
  WHERE dd.document_id = ANY(p_document_ids)
    AND d.school_id = public.current_school_id()
    AND public.current_user_role() IN ('ADMIN', 'TEACHER')
  GROUP BY dd.document_id;
$$;

REVOKE ALL ON FUNCTION public.document_download_counts(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_download_counts(UUID[]) TO authenticated;

INSERT INTO public._migration_log (filename) VALUES ('20260728000087_document_downloads.sql') ON CONFLICT (filename) DO NOTHING;
