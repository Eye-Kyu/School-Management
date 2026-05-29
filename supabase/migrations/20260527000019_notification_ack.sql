-- Parent can acknowledge absence notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
