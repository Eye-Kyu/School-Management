-- ============================================================
-- Phase 0, sub-sprint 2: notification dedup + receipt_sent_at fold-in fix
-- ============================================================

-- Notification dedup for the two new payment-related NotifTypes
-- (PAYMENT_RECEIVED, RECEIPT_AVAILABLE — notifications.type has no DB-level
-- enum/CHECK, just a comment convention, so no type-list migration is
-- needed for the values themselves). Reconciliation itself is already
-- required to be idempotent (an already-MATCHED transaction is never
-- re-reconciled), so this is belt-and-suspenders against a race between two
-- near-simultaneous reconciliation attempts, not the primary guard.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_payment_dedup_idx
  ON public.notifications (recipient_id, type, (metadata->>'paymentId'))
  WHERE type IN ('PAYMENT_RECEIVED', 'RECEIPT_AVAILABLE') AND metadata->>'paymentId' IS NOT NULL;

-- Fold-in fix (Task 6a): payment_transactions.receipt_sent_at has existed
-- since 20260529000019_payments.sql but was never written anywhere —
-- reconcilePayment queues a receipt-link notification but never marks this
-- column. One-shot backfill: any SUCCESS payment that already had a
-- dispatched (email_sent_at IS NOT NULL) receipt-link notification queued
-- for it gets receipt_sent_at set retroactively. Guarded by
-- "receipt_sent_at IS NULL" so re-running this file by hand is harmless —
-- it can never re-backfill a row twice or overwrite a value the new
-- code (this same PR) has since started setting for real.
UPDATE public.payment_transactions pt
SET receipt_sent_at = COALESCE(n.email_sent_at, pt.updated_at)
FROM public.notifications n
WHERE pt.receipt_sent_at IS NULL
  AND pt.status = 'SUCCESS'
  AND n.type = 'NEW_ANNOUNCEMENT'
  AND n.metadata->>'paymentId' = pt.id::text
  AND n.email_sent_at IS NOT NULL;
