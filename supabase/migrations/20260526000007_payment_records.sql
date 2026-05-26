CREATE TABLE public.payment_records (
  id             UUID NOT NULL PRIMARY KEY,
  school_id      UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  fee_balance_id UUID NOT NULL REFERENCES public.fee_balances(id) ON DELETE CASCADE,
  student_id     UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  amount         DECIMAL(12,2) NOT NULL,
  payment_method TEXT,
  reference_no   TEXT,
  paid_date      DATE NOT NULL,
  recorded_by_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_records_select" ON public.payment_records
  FOR SELECT USING (school_id = current_school_id());

CREATE POLICY "payment_records_insert" ON public.payment_records
  FOR INSERT WITH CHECK (
    school_id = current_school_id() AND current_user_role() = 'ADMIN'
  );
