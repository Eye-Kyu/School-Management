-- ============================================================
-- Platform billing: a manual invoice ledger against schools'
-- package subscriptions. No payment gateway — the SuperAdmin
-- generates invoices and marks them paid/cancelled by hand.
-- Every figure this powers traces back to a real invoice row,
-- not a projection.
--
-- amount/currency/package_name/billing_cycle are snapshotted at
-- creation time from the school's then-active package, not
-- live-joined — a later package price edit or rename must never
-- silently rewrite a historical invoice.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_invoices (
  id              UUID          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID          NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  subscription_id UUID          REFERENCES public.school_subscriptions(id) ON DELETE SET NULL,
  package_id      UUID          REFERENCES public.packages(id) ON DELETE SET NULL,
  package_name    TEXT          NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  currency        TEXT          NOT NULL DEFAULT 'KES',
  billing_cycle   TEXT          NOT NULL CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
  period_start    DATE          NOT NULL,
  period_end      DATE          NOT NULL,
  due_date        DATE          NOT NULL,
  status          TEXT          NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED')),
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS platform_invoices_school_idx ON public.platform_invoices (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_invoices_status_due_idx ON public.platform_invoices (status, due_date);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Full CRUD (unlike audit_logs/privileged_access_logs) since invoices
-- legitimately transition status over time — same convention as `packages`.
ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_invoices_select_super_admin" ON public.platform_invoices FOR SELECT
  USING (current_user_role() = 'SUPER_ADMIN');
CREATE POLICY "platform_invoices_write_super_admin" ON public.platform_invoices FOR ALL
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');
