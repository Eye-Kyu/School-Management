-- ============================================================
-- v0.2 Week 12 — Online fee payments
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id              UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID         NOT NULL REFERENCES public.schools(id)        ON DELETE CASCADE,
  student_id      UUID         NOT NULL REFERENCES public.students(id)       ON DELETE CASCADE,
  parent_user_id  UUID         NOT NULL REFERENCES public.users(id)          ON DELETE CASCADE,
  fee_balance_id  UUID                  REFERENCES public.fee_balances(id)   ON DELETE SET NULL,
  provider        TEXT         NOT NULL DEFAULT 'PAYSTACK',
  reference       TEXT         NOT NULL UNIQUE,         -- Paystack reference
  amount          NUMERIC(12,2) NOT NULL,               -- in KES (or local currency)
  currency        TEXT         NOT NULL DEFAULT 'KES',
  status          TEXT         NOT NULL DEFAULT 'PENDING'
                               CHECK (status IN ('PENDING','SUCCESS','FAILED','ABANDONED')),
  provider_payload JSONB,                               -- raw webhook/verify response
  receipt_sent_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pt_student_idx ON public.payment_transactions (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pt_reference_idx ON public.payment_transactions (reference);

-- Webhook endpoint registry
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id          UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  url         TEXT         NOT NULL,
  secret      TEXT         NOT NULL,
  events      TEXT[]       NOT NULL DEFAULT ARRAY['grade.posted','attendance.marked','fee.paid'],
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id          UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID         NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_type  TEXT         NOT NULL,
  payload     JSONB        NOT NULL,
  status_code INT,
  error       TEXT,
  delivered_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pt_select" ON public.payment_transactions FOR SELECT USING (
  school_id = current_school_id() AND (
    current_user_role() = 'ADMIN'
    OR parent_user_id = current_user_id()
  )
);
CREATE POLICY "pt_insert" ON public.payment_transactions FOR INSERT WITH CHECK (
  school_id = current_school_id()
);
CREATE POLICY "pt_update" ON public.payment_transactions FOR UPDATE USING (
  school_id = current_school_id()
);

CREATE POLICY "we_select"  ON public.webhook_endpoints FOR SELECT USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "we_insert"  ON public.webhook_endpoints FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "we_delete"  ON public.webhook_endpoints FOR DELETE USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');

CREATE POLICY "wd_select"  ON public.webhook_deliveries FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.webhook_endpoints e WHERE e.id = endpoint_id AND e.school_id = current_school_id())
);

-- Add notification error tracking
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS error_message TEXT;
