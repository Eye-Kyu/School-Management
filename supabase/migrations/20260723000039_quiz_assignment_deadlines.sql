-- ============================================================
-- Deadline enforcement: quizzes (new closes_at) + assignments (existing due_date)
-- ============================================================
-- After a deadline passes, a student can still see the quiz/assignment and
-- their own past submission/attempt (score, answers, what they got wrong) —
-- SELECT policies are untouched. What's blocked is starting a new attempt,
-- submitting for the first time, or resubmitting/re-saving an attempt.
-- Grading by a TEACHER/ADMIN is never deadline-gated.

-- ── quizzes: add a deadline column (none existed before) ────────
ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ;

-- ── submissions: own-student check + deadline gate ───────────────
-- sub_insert previously only checked role = 'STUDENT', with no check that
-- student_id was the caller's own student row, and no deadline check at all.
DROP POLICY IF EXISTS "sub_insert" ON public.submissions;
CREATE POLICY "sub_insert" ON public.submissions FOR INSERT WITH CHECK (
  school_id = current_school_id()
  AND current_user_role() = 'STUDENT'
  AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
  AND EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.id = assignment_id
      AND now() <= (a.due_date::timestamp AT TIME ZONE 'UTC')
  )
);

-- sub_update previously allowed ANY user in the school to update ANY
-- submission (no participant check at all). Tightened here because the
-- deadline gate has to be added to this same policy anyway: a student may
-- update only their own submission and only before the deadline; a
-- teacher/admin may grade any submission at any time, deadline or not.
DROP POLICY IF EXISTS "sub_update" ON public.submissions;
CREATE POLICY "sub_update" ON public.submissions FOR UPDATE USING (
  school_id = current_school_id() AND (
    current_user_role() IN ('TEACHER', 'ADMIN')
    OR (
      current_user_role() = 'STUDENT'
      AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
      AND EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.id = assignment_id
          AND now() <= (a.due_date::timestamp AT TIME ZONE 'UTC')
      )
    )
  )
);

-- ── quiz_attempts: deadline gate on starting/saving/submitting ──
DROP POLICY IF EXISTS "qa_insert" ON public.quiz_attempts;
CREATE POLICY "qa_insert" ON public.quiz_attempts FOR INSERT WITH CHECK (
  school_id = current_school_id()
  AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
  AND EXISTS (
    SELECT 1 FROM public.quizzes q
    WHERE q.id = quiz_id AND (q.closes_at IS NULL OR now() <= q.closes_at)
  )
);

DROP POLICY IF EXISTS "qa_update" ON public.quiz_attempts;
CREATE POLICY "qa_update" ON public.quiz_attempts FOR UPDATE USING (
  school_id = current_school_id() AND (
    current_user_role() IN ('TEACHER', 'ADMIN')
    OR (
      EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
      AND EXISTS (
        SELECT 1 FROM public.quizzes q
        WHERE q.id = quiz_id AND (q.closes_at IS NULL OR now() <= q.closes_at)
      )
    )
  )
);
