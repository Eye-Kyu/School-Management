-- ============================================================
-- Task 3: SuperAdmin -> SchoolAdmin broadcast messaging
-- ============================================================
-- Explicitly cross-tenant by design: platform_messages/platform_message_recipients
-- deliberately let a SUPER_ADMIN fan a single message out to ADMIN users across
-- every school on the platform, and let each School Admin read the rows
-- addressed to them. Same "catalogue read, platform-only write" shape as
-- modules/packages, extended so recipients can also read (and update read/
-- dismiss state on) their own delivery rows.

CREATE TABLE IF NOT EXISTS public.platform_messages (
  id              UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id  UUID                  REFERENCES public.users(id) ON DELETE SET NULL,
  subject         TEXT         NOT NULL,
  body            TEXT         NOT NULL,
  sent_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  sender_deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.platform_message_recipients (
  id                    UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_message_id   UUID         NOT NULL REFERENCES public.platform_messages(id) ON DELETE CASCADE,
  recipient_school_id   UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  recipient_user_id     UUID         NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  read_at               TIMESTAMPTZ,
  dismissed_at          TIMESTAMPTZ,
  UNIQUE (platform_message_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS platform_message_recipients_recipient_idx
  ON public.platform_message_recipients (recipient_user_id, read_at);

ALTER TABLE public.platform_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_message_recipients ENABLE ROW LEVEL SECURITY;

-- platform_messages: SUPER_ADMIN inserts and sees all; a School Admin sees
-- only messages they were actually sent (via a recipient row), never every
-- broadcast on the platform.
CREATE POLICY "pm_select_super_admin" ON public.platform_messages FOR SELECT USING (
  current_user_role() = 'SUPER_ADMIN'
);
CREATE POLICY "pm_select_recipient" ON public.platform_messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.platform_message_recipients r
    WHERE r.platform_message_id = id AND r.recipient_user_id = current_user_id()
  )
);
CREATE POLICY "pm_insert_super_admin" ON public.platform_messages FOR INSERT WITH CHECK (
  current_user_role() = 'SUPER_ADMIN' AND sender_user_id = current_user_id()
);

-- platform_message_recipients: SUPER_ADMIN sees/manages all (fan-out on
-- send); a School Admin sees only their own rows.
CREATE POLICY "pmr_select_super_admin" ON public.platform_message_recipients FOR SELECT USING (
  current_user_role() = 'SUPER_ADMIN'
);
CREATE POLICY "pmr_select_own" ON public.platform_message_recipients FOR SELECT USING (
  recipient_user_id = current_user_id()
);
CREATE POLICY "pmr_insert_super_admin" ON public.platform_message_recipients FOR INSERT WITH CHECK (
  current_user_role() = 'SUPER_ADMIN'
);
-- Recipients may only flip read_at/dismissed_at on their own row — enforced
-- at the app layer (PATCH only ever sets those two columns); RLS scopes WHICH
-- rows, column-level restriction isn't expressible in Postgres RLS.
-- SUPER_ADMIN is deliberately NOT granted UPDATE here — the report the user
-- provided asked read/dismissed state to be exactly the recipient's business.
CREATE POLICY "pmr_update_own" ON public.platform_message_recipients FOR UPDATE USING (
  recipient_user_id = current_user_id()
) WITH CHECK (
  recipient_user_id = current_user_id()
);

-- ── New platform permission: SEND_PLATFORM_MESSAGES ──
-- Same additive-enum pattern as 20260722000028_platform_permissions.sql.
-- Backfill every existing SUPER_ADMIN so this PR doesn't silently lock out
-- accounts that predate it, then patch the signup trigger for future ones.
UPDATE public.users
SET platform_permissions = array_append(platform_permissions, 'SEND_PLATFORM_MESSAGES')
WHERE role = 'SUPER_ADMIN' AND NOT ('SEND_PLATFORM_MESSAGES' = ANY(platform_permissions));

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_school_id   uuid;
  v_role        text;
  v_permissions text[];
BEGIN
  v_school_id := (NEW.raw_user_meta_data->>'school_id')::uuid;
  v_role      := NEW.raw_user_meta_data->>'role';

  IF v_role = 'SUPER_ADMIN' THEN
    v_permissions := ARRAY[
      'VIEW_SCHOOLS', 'MANAGE_SCHOOLS', 'VIEW_MODULES', 'MANAGE_MODULES',
      'VIEW_PACKAGES', 'MANAGE_PACKAGES', 'VIEW_CURRICULUM', 'MANAGE_CURRICULUM',
      'VIEW_PLATFORM_USERS', 'MANAGE_PLATFORM_USERS', 'VIEW_BILLING', 'MANAGE_BILLING',
      'VIEW_PLATFORM_ANALYTICS', 'VIEW_AUDIT_LOGS', 'GRANT_PRIVILEGED_ACCESS',
      'VIEW_SYSTEM_HEALTH', 'MANAGE_PLATFORM_SETTINGS', 'SEND_PLATFORM_MESSAGES'
    ];
  ELSE
    v_permissions := '{}';
  END IF;

  IF v_role IS NOT NULL AND (v_school_id IS NOT NULL OR v_role = 'SUPER_ADMIN') THEN
    INSERT INTO public.users (
      id, school_id, auth_id, email, phone, full_name, role, platform_permissions, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_school_id,
      NEW.id,
      NEW.email,
      NEW.phone,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, NEW.phone, 'Unknown'),
      v_role::"UserRole",
      v_permissions,
      now()
    )
    ON CONFLICT (auth_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
