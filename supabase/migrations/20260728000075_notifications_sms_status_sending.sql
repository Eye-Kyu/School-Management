-- ============================================================
-- Fix BUG-4 (docs/bug-triage.md): dispatcher concurrency race
-- ============================================================
-- NotificationsService.dispatch() previously called the paid, external
-- Africa's Talking sendSms() BEFORE marking a row as claimed — two
-- overlapping dispatch() runs (verified real: NotificationsScheduler's
-- @Cron(EVERY_MINUTE) has no overlap guard, so a tick taking >60s runs
-- concurrently with the next one, on the same process, no horizontal
-- scaling required) could both select and both send the same row.
--
-- Fix: dispatch() now atomically claims a row (sms_status PENDING ->
-- SENDING, via a single conditional UPDATE ... RETURNING) before ever
-- calling sendSms() — a genuine no-op for any second concurrent claim
-- attempt, which sees 0 rows affected and skips. This new transitional
-- value needs a slot in the CHECK constraint.
-- ============================================================

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_sms_status_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_sms_status_check
  CHECK (sms_status IN ('PENDING', 'SENDING', 'SENT', 'ABANDONED', 'SKIPPED_LEGACY_STUB'));

INSERT INTO public._migration_log (filename) VALUES ('20260728000075_notifications_sms_status_sending.sql') ON CONFLICT (filename) DO NOTHING;
