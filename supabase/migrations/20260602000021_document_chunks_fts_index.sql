-- Full-text search index on document_chunks.content, used by the AI tutor
-- for real retrieval instead of sending Claude just document titles.
CREATE INDEX IF NOT EXISTS doc_chunks_fts_idx
  ON public.document_chunks
  USING GIN (to_tsvector('english', content));
