-- Document chunks for AI tutor RAG
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id          UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID         NOT NULL REFERENCES public.schools(id)    ON DELETE CASCADE,
  document_id UUID         NOT NULL REFERENCES public.documents(id)  ON DELETE CASCADE,
  chunk_index INT          NOT NULL,
  content     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS doc_chunks_doc_idx ON public.document_chunks (document_id);

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chunks_select" ON public.document_chunks FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "chunks_insert" ON public.document_chunks FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() IN ('ADMIN','TEACHER'));
CREATE POLICY "chunks_delete" ON public.document_chunks FOR DELETE USING (school_id = current_school_id() AND current_user_role() IN ('ADMIN','TEACHER'));
