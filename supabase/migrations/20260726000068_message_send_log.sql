-- ============================================================
-- Phase 0, sub-sprint 1a: per-message cost tracking
-- ============================================================
-- Written exclusively by NotificationsService.dispatch() via the
-- service-role client (same posture as payment_transactions writes) — no
-- INSERT/UPDATE/DELETE RLS policy is needed or granted.
--
-- Deliberately no expression index on date_trunc('month', sent_at):
-- date_trunc(text, timestamptz) is STABLE, not IMMUTABLE (it depends on the
-- session TimeZone GUC), so Postgres rejects it in an index expression. A
-- plain range index on (school_id, sent_at) supports the same "this month /
-- last month / last 30 days" queries via a WHERE range instead.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.message_send_log (
  id                    UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  notification_id       UUID         REFERENCES public.notifications(id) ON DELETE SET NULL,
  channel               TEXT         NOT NULL CHECK (channel IN ('SMS', 'WHATSAPP')),
  provider              TEXT         NOT NULL,
  provider_message_id   TEXT,
  recipient_phone       TEXT         NOT NULL,
  cost_amount           NUMERIC(10, 4),
  cost_currency         TEXT         DEFAULT 'KES',
  cost_raw              TEXT,
  sent_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_send_log_school_sent_idx
  ON public.message_send_log (school_id, sent_at);

ALTER TABLE public.message_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "msl_select_admin" ON public.message_send_log FOR SELECT USING (
  school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN'
);
CREATE POLICY "msl_select_super_admin" ON public.message_send_log FOR SELECT USING (
  public.current_user_role() = 'SUPER_ADMIN'
);
