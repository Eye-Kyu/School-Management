-- ============================================================
-- Bucket 1, PR 3 — documents scope_type/scope_subtype/scope_id
-- ============================================================
-- Replaces the unenforced audience/target_grade_level/target_class_id
-- scope mechanism (never read by any RLS policy — see the Phase 1 audit,
-- docs/audits/documents-current-state.md §1.1/§1.7) with
-- scope_type/scope_subtype/scope_id, mirroring
-- assessments.source_type/source_id (20260728000081_assessments_source_link.sql)
-- — no FK on scope_id (it can point into one of four different tables
-- depending on scope_type/scope_subtype; a real FK can't express that),
-- validated in the app layer instead (DocumentsService), same
-- "don't add an FK, validate in the app layer, partial index" pattern
-- that migration already established.
--
-- scope_subtype's third value is 'ONLINE_ASSIGNMENT', not 'ASSIGNMENT' —
-- the latter would collide with the outer scope_type='ASSIGNMENT' value
-- (they'd both read 'ASSIGNMENT', which is nonsensical) since there are
-- three distinct "assignment-like" tables a document can attach to
-- (homework_assignments, quizzes, assignments) and scope_type alone can't
-- disambiguate which one scope_id points into.
--
-- Zero live rows in `documents` as of 2026-08-04 (confirmed via direct REST
-- probe, see audit §1.6) — every change below is risk-free.

ALTER TABLE public.documents
  DROP COLUMN IF EXISTS audience,
  DROP COLUMN IF EXISTS target_grade_level,
  DROP COLUMN IF EXISTS target_class_id,
  -- file_url was a public-CDN URL, meaningless once the bucket is private
  -- (20260728000084). storage_path (the bucket-relative object key) is
  -- what createSignedUrl()/admin.storage.download() actually need.
  DROP COLUMN IF EXISTS file_url,
  ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'SCHOOL_WIDE',
  ADD COLUMN scope_subtype TEXT,
  ADD COLUMN scope_id UUID,
  ADD COLUMN storage_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.documents ALTER COLUMN storage_path DROP DEFAULT;

ALTER TABLE public.documents ADD CONSTRAINT documents_scope_check CHECK (
  scope_type IN ('SCHOOL_WIDE', 'CLASS', 'SUBJECT', 'ASSIGNMENT') AND (
    (scope_type = 'SCHOOL_WIDE' AND scope_id IS NULL AND scope_subtype IS NULL) OR
    (scope_type IN ('CLASS', 'SUBJECT') AND scope_id IS NOT NULL AND scope_subtype IS NULL) OR
    (scope_type = 'ASSIGNMENT' AND scope_id IS NOT NULL
     AND scope_subtype IN ('HOMEWORK', 'QUIZ', 'ONLINE_ASSIGNMENT'))
  )
);

-- Supports "list documents attached to scope X" (the retag flow, and the
-- assignment-attachment section's own query) as well as
-- user_can_see_document()'s lookups.
CREATE INDEX IF NOT EXISTS documents_scope_idx
  ON public.documents (scope_type, scope_subtype, scope_id)
  WHERE scope_type != 'SCHOOL_WIDE';

-- documents_school_idx (school_id, created_at DESC), from the original
-- migration, is untouched and still serves the plain "all documents at my
-- school" listing.

INSERT INTO public._migration_log (filename) VALUES ('20260728000085_documents_scope_schema.sql') ON CONFLICT (filename) DO NOTHING;
