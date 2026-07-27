-- ============================================================
-- Phase 0, sub-sprint 2: M-Pesa Paybill reconciliation
-- ============================================================
-- Per-school Safaricom Paybill shortcodes (confirmed with the project
-- owner: each school registers its own shortcode with Safaricom, not a
-- shared platform-wide one). A Daraja C2B callback's BusinessShortCode is
-- the primary way a transaction is attributed to a school — admission
-- number matching (see payment_paybill_transactions) only ever happens
-- *within* that already-attributed school, since students.admission_no is
-- only unique per-school (students_school_id_admission_no_key), not
-- globally: two different schools can legitimately have the same
-- admission number.
--
-- Registering the shortcode's validation/confirmation URLs with Safaricom
-- (Daraja's registerurl API/portal) is a one-time manual step per school,
-- outside this migration's or this PR's scope.
-- ============================================================

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS paybill_shortcode TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS schools_paybill_shortcode_key
  ON public.schools (paybill_shortcode)
  WHERE paybill_shortcode IS NOT NULL;
