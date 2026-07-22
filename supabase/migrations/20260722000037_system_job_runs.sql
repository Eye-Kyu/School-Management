-- ============================================================
-- Generic scheduled-job heartbeat table.
--
-- Turns "is this cron actually running" from a fuzzy inference
-- (e.g. a growing pending-notifications backlog) into a direct
-- measurement. Reusable for any future @Cron job, not a one-off
-- for the notifications dispatcher.
--
-- Only the backend's service-role admin client ever writes this
-- (see notifications.scheduler.ts) — no INSERT/UPDATE policy for
-- any authenticated role, same convention as every other
-- SuperAdmin-internal table.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_job_runs (
  job_key         TEXT         NOT NULL PRIMARY KEY,
  last_run_at     TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_job_runs_select_super_admin" ON public.system_job_runs FOR SELECT
  USING (current_user_role() = 'SUPER_ADMIN');
