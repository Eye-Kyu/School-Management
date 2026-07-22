-- ============================================================
-- Announcements: optional expiry date. NULL = never expires.
-- ============================================================

ALTER TABLE public.announcements ADD COLUMN expires_at DATE;
