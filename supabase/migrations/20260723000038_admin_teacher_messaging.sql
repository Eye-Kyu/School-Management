-- ============================================================
-- Messaging: admin- and teacher-initiated conversations
-- ============================================================
-- Extends the existing parent<->teacher conversations/messages tables
-- (no parallel tables) to also support admin<->teacher and admin<->parent
-- threads. Each conversation row now has exactly two of three possible
-- party columns populated (parent_user_id, teacher_user_id, admin_user_id);
-- the third is NULL. A student is never a valid value for any of them.

-- ── conversations: add the third party slot ────────────────────
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS admin_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS admin_unread_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.conversations
  ALTER COLUMN parent_user_id DROP NOT NULL,
  ALTER COLUMN teacher_user_id DROP NOT NULL;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_party_shape_chk CHECK (
    (parent_user_id IS NOT NULL AND teacher_user_id IS NOT NULL AND admin_user_id IS NULL)
    OR (admin_user_id IS NOT NULL AND teacher_user_id IS NOT NULL AND parent_user_id IS NULL)
    OR (admin_user_id IS NOT NULL AND parent_user_id IS NOT NULL AND teacher_user_id IS NULL)
  );

-- Replace the old (parent, teacher, student) unique index with one that
-- covers all three shapes — NULLs coalesced to '' so two rows that share
-- the same populated pair + student can't duplicate regardless of shape.
DROP INDEX IF EXISTS conversations_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_idx ON public.conversations (
  school_id,
  COALESCE(admin_user_id::text, ''),
  COALESCE(parent_user_id::text, ''),
  COALESCE(teacher_user_id::text, ''),
  COALESCE(student_id::text, '')
);

CREATE INDEX IF NOT EXISTS conversations_admin_idx ON public.conversations (admin_user_id);

-- ── messages: admin sends bypass quiet hours ────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS bypass_quiet_hours BOOLEAN NOT NULL DEFAULT false;

-- ── student-safety guarantee (unbypassable, not just RLS) ──────
-- RLS insert policies below already keep a STUDENT out of any party column
-- for RLS-governed inserts. This trigger makes the guarantee unconditional,
-- so it also holds for service-role writes that bypass RLS entirely.
CREATE OR REPLACE FUNCTION public.reject_student_conversation_participant()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id IN (NEW.parent_user_id, NEW.teacher_user_id, NEW.admin_user_id)
      AND u.role = 'STUDENT'
  ) THEN
    RAISE EXCEPTION 'A student cannot be a conversation participant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS conversations_reject_student ON public.conversations;
CREATE TRIGGER conversations_reject_student
  BEFORE INSERT OR UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.reject_student_conversation_participant();

-- ── RLS: conversations ───────────────────────────────────────────
DROP POLICY IF EXISTS "conv_insert" ON public.conversations;
CREATE POLICY "conv_insert" ON public.conversations FOR INSERT WITH CHECK (
  school_id = current_school_id()
  AND (
    -- Parent opens a thread with a teacher at their school (existing behavior)
    (
      current_user_role() = 'PARENT'
      AND parent_user_id = current_user_id()
      AND admin_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.users tu
        WHERE tu.id = teacher_user_id AND tu.school_id = current_school_id() AND tu.role = 'TEACHER'
      )
    )
    OR
    -- Admin opens a thread with a teacher or a parent at their own school —
    -- never a student, and never cross-school.
    (
      current_user_role() = 'ADMIN'
      AND admin_user_id = current_user_id()
      AND (
        (
          teacher_user_id IS NOT NULL AND parent_user_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.users tu
            WHERE tu.id = teacher_user_id AND tu.school_id = current_school_id() AND tu.role = 'TEACHER'
          )
        )
        OR
        (
          parent_user_id IS NOT NULL AND teacher_user_id IS NULL
          AND EXISTS (
            SELECT 1 FROM public.users pu
            WHERE pu.id = parent_user_id AND pu.school_id = current_school_id() AND pu.role = 'PARENT'
          )
        )
      )
    )
    OR
    -- Teacher opens a thread with a parent of a student in a class they
    -- teach (subject_assignments row) or are the class teacher of.
    (
      current_user_role() = 'TEACHER'
      AND teacher_user_id = current_user_id()
      AND admin_user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = current_user_id()
          AND EXISTS (
            SELECT 1
            FROM public.guardians g
            JOIN public.students s ON s.id = g.student_id
            WHERE g.user_id = parent_user_id
              AND (
                s.current_class_id = t.is_class_teacher_of
                OR EXISTS (
                  SELECT 1 FROM public.subject_assignments sa
                  WHERE sa.teacher_id = t.id AND sa.class_id = s.current_class_id
                )
              )
          )
      )
    )
  )
);

-- ── RLS: messages ────────────────────────────────────────────────
DROP POLICY IF EXISTS "msg_insert" ON public.messages;
CREATE POLICY "msg_insert" ON public.messages FOR INSERT WITH CHECK (
  school_id = current_school_id()
  AND sender_id = current_user_id()
  AND current_user_role() IN ('ADMIN', 'TEACHER', 'PARENT')
  AND (bypass_quiet_hours = false OR current_user_role() = 'ADMIN')
  AND EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND (
        c.parent_user_id = current_user_id()
        OR c.teacher_user_id = current_user_id()
        OR c.admin_user_id = current_user_id()
      )
  )
);
