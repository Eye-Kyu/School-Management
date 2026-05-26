-- Notifications queue (one row per recipient per event)
CREATE TABLE public.notifications (
  id             UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  recipient_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,  -- 'ABSENT_STUDENT' | 'NEW_ANNOUNCEMENT' | 'HOMEWORK_ASSIGNED'
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  metadata       JSONB,
  is_read        BOOLEAN NOT NULL DEFAULT false,
  email_sent_at  TIMESTAMPTZ,   -- null = not yet sent / not applicable
  sms_sent_at    TIMESTAMPTZ,   -- null = not yet sent / not applicable
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select" ON public.notifications FOR SELECT
  USING (school_id = current_school_id() AND recipient_id = current_user_id());

CREATE POLICY "notif_update" ON public.notifications FOR UPDATE
  USING (school_id = current_school_id() AND recipient_id = current_user_id());

-- Per-user, per-type channel preferences
CREATE TABLE public.notification_preferences (
  id                UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  email_enabled     BOOLEAN NOT NULL DEFAULT true,
  sms_enabled       BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (user_id, notification_type)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_pref_select" ON public.notification_preferences FOR SELECT
  USING (school_id = current_school_id() AND user_id = current_user_id());

CREATE POLICY "notif_pref_insert" ON public.notification_preferences FOR INSERT
  WITH CHECK (school_id = current_school_id() AND user_id = current_user_id());

CREATE POLICY "notif_pref_update" ON public.notification_preferences FOR UPDATE
  USING (school_id = current_school_id() AND user_id = current_user_id());
