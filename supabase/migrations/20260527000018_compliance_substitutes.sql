-- ============================================================
-- v0.4 Week 26-27 — API tokens, compliance, substitute grants
-- ============================================================

-- Scoped API tokens for school integrations
CREATE TABLE IF NOT EXISTS public.api_tokens (
  id           UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  created_by_id UUID        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  name         TEXT         NOT NULL,
  token_hash   TEXT         NOT NULL UNIQUE,  -- SHA-256 of the raw token
  scopes       TEXT[]       NOT NULL DEFAULT ARRAY['grades:read','attendance:read'],
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- GDPR / data-privacy deletion requests
CREATE TABLE IF NOT EXISTS public.deletion_requests (
  id              UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  requested_by_id UUID         NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  target_user_id  UUID         NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  reason          TEXT,
  status          TEXT         NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','COMPLETED')),
  reviewed_by_id  UUID         REFERENCES public.users(id)            ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  hard_delete_after TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Substitute teacher day-scoped access
CREATE TABLE IF NOT EXISTS public.substitute_grants (
  id                UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID         NOT NULL REFERENCES public.schools(id)   ON DELETE CASCADE,
  granted_by_id     UUID         NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,
  substitute_user_id UUID        NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,
  class_id          UUID         NOT NULL REFERENCES public.classes(id)   ON DELETE CASCADE,
  grant_date        DATE         NOT NULL,
  actions_allowed   TEXT[]       NOT NULL DEFAULT ARRAY['attendance','homework'],
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (substitute_user_id, class_id, grant_date)
);

ALTER TABLE public.api_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.substitute_grants   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tok_select"  ON public.api_tokens FOR SELECT USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "tok_insert"  ON public.api_tokens FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "tok_delete"  ON public.api_tokens FOR DELETE USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');

CREATE POLICY "dr_select"   ON public.deletion_requests FOR SELECT USING (school_id = current_school_id() AND (current_user_role() = 'ADMIN' OR requested_by_id = current_user_id()));
CREATE POLICY "dr_insert"   ON public.deletion_requests FOR INSERT WITH CHECK (school_id = current_school_id());
CREATE POLICY "dr_update"   ON public.deletion_requests FOR UPDATE USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');

CREATE POLICY "sub_select"  ON public.substitute_grants FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "sub_insert"  ON public.substitute_grants FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "sub_delete"  ON public.substitute_grants FOR DELETE USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');
