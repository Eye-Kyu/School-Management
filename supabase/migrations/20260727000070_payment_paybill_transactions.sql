-- ============================================================
-- Phase 0, sub-sprint 2: payment_paybill_transactions
-- ============================================================
-- One row per Safaricom Daraja C2B confirmation callback. Written
-- exclusively by MpesaDarajaService via the service-role client (same
-- posture as payment_transactions/message_send_log writes) — there is no
-- session for an inbound, unauthenticated Safaricom callback.
--
-- mpesa_receipt_number (Safaricom's own TransID) is the natural
-- idempotency key — a retried confirmation callback hits the unique
-- constraint and is treated as already-processed, never re-persisted or
-- re-reconciled.
--
-- receipt_sent_at mirrors payment_transactions.receipt_sent_at (wired up
-- in this same PR, see the fold-in-fixes migration) — added here from the
-- start so this new table never has the same dead-column problem.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_paybill_transactions (
  id                      UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id               UUID         REFERENCES public.schools(id) ON DELETE SET NULL,
  mpesa_receipt_number    TEXT         NOT NULL UNIQUE,
  transaction_type        TEXT         NOT NULL,
  transaction_time        TIMESTAMPTZ  NOT NULL,
  amount                  NUMERIC(12, 2) NOT NULL,
  currency                TEXT         NOT NULL DEFAULT 'KES',
  msisdn                  TEXT         NOT NULL,
  bill_reference_number   TEXT         NOT NULL,
  business_shortcode      TEXT         NOT NULL,
  reconciliation_status   TEXT         NOT NULL DEFAULT 'PENDING'
    CHECK (reconciliation_status IN ('PENDING', 'MATCHED', 'UNMATCHED', 'MANUALLY_MATCHED', 'REVERSED')),
  matched_student_id      UUID         REFERENCES public.students(id) ON DELETE SET NULL,
  matched_fee_balance_id  UUID         REFERENCES public.fee_balances(id) ON DELETE SET NULL,
  matched_at              TIMESTAMPTZ,
  matched_by_user_id      UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  reconciliation_notes    TEXT,
  receipt_sent_at         TIMESTAMPTZ,
  raw_callback            JSONB        NOT NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_paybill_transactions_school_status_idx
  ON public.payment_paybill_transactions (school_id, reconciliation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_paybill_transactions_reconcile_idx
  ON public.payment_paybill_transactions (bill_reference_number)
  WHERE reconciliation_status = 'PENDING';

ALTER TABLE public.payment_paybill_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ppt_select_admin" ON public.payment_paybill_transactions FOR SELECT USING (
  school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN'
);
CREATE POLICY "ppt_select_super_admin" ON public.payment_paybill_transactions FOR SELECT USING (
  public.current_user_role() = 'SUPER_ADMIN'
);

-- RLS scopes WHICH rows an admin may update (their own school) — it cannot
-- restrict WHICH COLUMNS, since Postgres RLS operates on rows, not columns
-- (same limitation already documented on pmr_update_own in the sub-sprint 1a
-- migration). The application layer is what actually enforces that only
-- reconciliation_status/matched_*/reconciliation_notes/updated_at are ever
-- written — amount, mpesa_receipt_number, and raw_callback are never
-- included in any UPDATE payload the service issues.
CREATE POLICY "ppt_update_admin" ON public.payment_paybill_transactions FOR UPDATE USING (
  school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN'
) WITH CHECK (
  school_id = public.current_school_id() AND public.current_user_role() = 'ADMIN'
);

-- No INSERT policy for any user role — every row is written by
-- MpesaDarajaService via the service-role client (bypasses RLS), matching
-- the payment_transactions/message_send_log precedent exactly.
