-- ============================================================
-- Phase 0, sub-sprint 1a: SMS via Africa's Talking
-- ============================================================
-- notifications.sms_sent_at has existed since 20260526000009_notifications.sql
-- but was never really used — NotificationsService.queue() pre-filled it on
-- every row with the comment "SMS not implemented; pre-fill so dispatcher
-- skips this column". This migration adds real lifecycle tracking for SMS
-- and backfills existing rows so removing that stub doesn't cause a burst
-- of historical sends on deploy.
--
-- sms_status carries both jobs that would otherwise need two mechanisms:
-- normal PENDING -> SENT/ABANDONED lifecycle (dispatcher retries up to 3
-- times, then abandons), and a one-time SKIPPED_LEGACY_STUB marker for rows
-- that were pre-filled by the old stub before this migration ran. The
-- dispatcher treats both ABANDONED and SKIPPED_LEGACY_STUB as terminal —
-- never retried.
-- ============================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS sms_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (sms_status IN ('PENDING', 'SENT', 'ABANDONED', 'SKIPPED_LEGACY_STUB')),
  ADD COLUMN IF NOT EXISTS sms_send_attempts INT NOT NULL DEFAULT 0;

-- Backfill: every existing row already has sms_sent_at populated by the old
-- stub. Mark them all as skipped (not PENDING) so the dispatcher never
-- reconsiders them once the stub is removed.
UPDATE public.notifications
SET sms_status = 'SKIPPED_LEGACY_STUB'
WHERE sms_sent_at IS NOT NULL;
