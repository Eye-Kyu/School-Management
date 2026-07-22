-- ============================================================
-- Privileged tenant access: explicit, scoped, time-limited grants
-- letting a SUPER_ADMIN read into one school's tenant data for
-- support/troubleshooting, fully audited.
--
-- Deliberately NOT implemented via RLS/current_school_id()
-- impersonation — see the Phase 10 plan for why. Enforcement is
-- entirely in PlatformPrivilegedAccessService, which checks a
-- grant is active/unexpired/in-scope before querying via the
-- admin client with an explicit school_id filter. RLS here is
-- narrow: SUPER_ADMIN manages their own grants; nothing about
-- existing tenant-table policies changes at all.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.privileged_access_grants (
  id                  UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_user_id UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_school_id    UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  reason              TEXT         NOT NULL,
  reference           TEXT,
  access_level        TEXT         NOT NULL DEFAULT 'READ_ONLY' CHECK (access_level IN ('READ_ONLY', 'READ_WRITE')),
  scopes              TEXT[]       NOT NULL,
  status              TEXT         NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'EXPIRED')),
  expires_at          TIMESTAMPTZ  NOT NULL,
  ended_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS privileged_access_grants_super_admin_idx ON public.privileged_access_grants (super_admin_user_id);
CREATE INDEX IF NOT EXISTS privileged_access_grants_school_idx ON public.privileged_access_grants (target_school_id);

-- Append-only, like audit_logs — no UPDATE/DELETE policy at all.
CREATE TABLE IF NOT EXISTS public.privileged_access_logs (
  id                  UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id            UUID         NOT NULL REFERENCES public.privileged_access_grants(id) ON DELETE CASCADE,
  super_admin_user_id UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_school_id    UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  action              TEXT         NOT NULL,
  resource_type       TEXT         NOT NULL,
  resource_id         UUID,
  scope               TEXT         NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS privileged_access_logs_grant_idx ON public.privileged_access_logs (grant_id);
CREATE INDEX IF NOT EXISTS privileged_access_logs_school_idx ON public.privileged_access_logs (target_school_id, created_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.privileged_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privileged_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "privileged_access_grants_select_super_admin" ON public.privileged_access_grants FOR SELECT
  USING (current_user_role() = 'SUPER_ADMIN');
CREATE POLICY "privileged_access_grants_write_super_admin" ON public.privileged_access_grants FOR ALL
  USING (current_user_role() = 'SUPER_ADMIN') WITH CHECK (current_user_role() = 'SUPER_ADMIN');

CREATE POLICY "privileged_access_logs_select_super_admin" ON public.privileged_access_logs FOR SELECT
  USING (current_user_role() = 'SUPER_ADMIN');
CREATE POLICY "privileged_access_logs_insert_super_admin" ON public.privileged_access_logs FOR INSERT
  WITH CHECK (current_user_role() = 'SUPER_ADMIN');
