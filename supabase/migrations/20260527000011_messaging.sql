-- ============================================================
-- Messaging: parent–teacher conversations
-- ============================================================

-- Quiet hours per teacher (defaults: 9 PM – 7 AM)
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS quiet_hours_start SMALLINT NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS quiet_hours_end   SMALLINT NOT NULL DEFAULT 7;

-- Allow notification delivery to be deferred (quiet hours)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS deliver_after TIMESTAMPTZ;

-- ── conversations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id                   UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            UUID         NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  parent_user_id       UUID         NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  teacher_user_id      UUID         NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  student_id           UUID                  REFERENCES public.students(id) ON DELETE SET NULL,
  last_message_body    TEXT,
  last_message_at      TIMESTAMPTZ,
  parent_unread_count  INT          NOT NULL DEFAULT 0,
  teacher_unread_count INT          NOT NULL DEFAULT 0,
  is_flagged           BOOLEAN      NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One thread per (parent, teacher, student) context
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_idx
  ON public.conversations (school_id, parent_user_id, teacher_user_id, COALESCE(student_id::text, ''));

CREATE INDEX IF NOT EXISTS conversations_parent_idx  ON public.conversations (parent_user_id);
CREATE INDEX IF NOT EXISTS conversations_teacher_idx ON public.conversations (teacher_user_id);
CREATE INDEX IF NOT EXISTS conversations_school_idx  ON public.conversations (school_id, last_message_at DESC);

-- ── messages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id              UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID         NOT NULL REFERENCES public.schools(id)      ON DELETE CASCADE,
  conversation_id UUID         NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       UUID         NOT NULL REFERENCES public.users(id)        ON DELETE CASCADE,
  body            TEXT         NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  is_flagged      BOOLEAN      NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_conv_created_idx ON public.messages (conversation_id, created_at);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages      ENABLE ROW LEVEL SECURITY;

-- Conversations: participants + admins can read
CREATE POLICY "conv_select" ON public.conversations FOR SELECT USING (
  school_id = current_school_id() AND (
    parent_user_id  = current_user_id()
    OR teacher_user_id = current_user_id()
    OR current_user_role() = 'ADMIN'
  )
);

-- Only parents may open new threads
CREATE POLICY "conv_insert" ON public.conversations FOR INSERT WITH CHECK (
  school_id = current_school_id()
  AND current_user_role() = 'PARENT'
  AND parent_user_id = current_user_id()
);

-- Participants + admins may update (unread counts, flagging)
CREATE POLICY "conv_update" ON public.conversations FOR UPDATE USING (
  school_id = current_school_id() AND (
    parent_user_id  = current_user_id()
    OR teacher_user_id = current_user_id()
    OR current_user_role() = 'ADMIN'
  )
);

-- Messages: participants + admins can read
CREATE POLICY "msg_select" ON public.messages FOR SELECT USING (
  school_id = current_school_id() AND (
    current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.parent_user_id = current_user_id() OR c.teacher_user_id = current_user_id())
    )
  )
);

-- Participants may send messages
CREATE POLICY "msg_insert" ON public.messages FOR INSERT WITH CHECK (
  school_id = current_school_id()
  AND sender_id = current_user_id()
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND (c.parent_user_id = current_user_id() OR c.teacher_user_id = current_user_id())
  )
);

-- Participants + admins may update (read_at, flagging)
CREATE POLICY "msg_update" ON public.messages FOR UPDATE USING (
  school_id = current_school_id() AND (
    current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.parent_user_id = current_user_id() OR c.teacher_user_id = current_user_id())
    )
  )
);
