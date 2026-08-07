-- ============================================================
-- Bucket 1, PR 3 — BUG-10 + BUG-11: private documents bucket,
-- restrictive Storage-object policies
-- ============================================================
-- BUG-10: the `documents` Storage bucket was `public: true`, so its
-- file_url (a public CDN URL, stored verbatim on the documents row) was
-- downloadable by anyone who knew or guessed the path — authenticated or
-- not, any school or none — completely bypassing the documents table's own
-- RLS (school_id/module_enabled/scope). Fixed by making the bucket
-- private; all reads now go through a NestJS endpoint
-- (DocumentsService.issueDownloadUrl(), 20260728000086's
-- user_can_see_document() is the real check) that issues a short-lived
-- (5 min) signed URL only after re-verifying the caller can see the row.
--
-- BUG-11: documents_insert/update/delete were `TO authenticated` with NO
-- role check at all (bucket_id = 'documents' was the only condition) — any
-- authenticated user, including a STUDENT or PARENT, could write,
-- overwrite, or delete objects in this bucket directly via the Storage
-- API, even though the documents *table* itself already restricted
-- row-level writes to ADMIN/TEACHER. Fixed by removing the write policies
-- entirely: every legitimate write now goes through DocumentsService's
-- service-role client (this.supabase.admin.storage...), after the caller's
-- role and scope have already been verified against the RLS-respecting
-- client — service_role bypasses RLS unconditionally, so the app's own
-- upload/delete calls are unaffected; only direct authenticated-role
-- Storage-API access (the actual bug) is closed.
--
-- Both discovered during the Phase 1 audit of B1-3
-- (docs/audits/documents-current-state.md §1.1) — see docs/bug-triage.md
-- for the BUG-10/BUG-11 entries.
-- ============================================================

UPDATE storage.buckets SET public = false WHERE id = 'documents';

DROP POLICY IF EXISTS "documents_read"   ON storage.objects;
DROP POLICY IF EXISTS "documents_insert" ON storage.objects;
DROP POLICY IF EXISTS "documents_update" ON storage.objects;
DROP POLICY IF EXISTS "documents_delete" ON storage.objects;

-- No replacement authenticated-role policies. RLS is already enabled
-- globally on storage.objects; zero permissive policies for
-- bucket_id = 'documents' means default-deny for anon/authenticated.
-- Signed URLs and server-side uploads (both service-role, which bypasses
-- RLS by design) are the only paths left.

INSERT INTO public._migration_log (filename) VALUES ('20260728000084_documents_bucket_privacy.sql') ON CONFLICT (filename) DO NOTHING;
