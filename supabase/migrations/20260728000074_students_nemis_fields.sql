-- ============================================================
-- Phase 0, sub-sprint 4: NEMIS export fields
-- ============================================================
-- Nullable/additive — NEMIS (rebranded KEMIS, May 2025) commonly requires
-- these fields but this codebase has never collected them. Admins backfill
-- per-student via the existing edit-student form (extended alongside this
-- migration); the export legitimately shows blanks until they do. See
-- docs/audits/nemis-format-verified.md — the exact field list/order is not
-- independently verified against an official government spec (none is
-- publicly discoverable), flagged verified: false there.
-- ============================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS birth_certificate_no TEXT,
  ADD COLUMN IF NOT EXISTS upi_number TEXT,
  ADD COLUMN IF NOT EXISTS nationality TEXT,
  ADD COLUMN IF NOT EXISTS county TEXT,
  ADD COLUMN IF NOT EXISTS sub_county TEXT,
  ADD COLUMN IF NOT EXISTS special_needs_notes TEXT;

INSERT INTO public._migration_log (filename) VALUES ('20260728000074_students_nemis_fields.sql') ON CONFLICT (filename) DO NOTHING;
