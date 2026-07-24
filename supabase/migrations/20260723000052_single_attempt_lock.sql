-- ============================================================
-- Task 5: quiz/assignment single-attempt lock
-- ============================================================
-- Both submissions and quiz_attempts already have UNIQUE(assignment/quiz_id,
-- student_id), and the student-facing submit flow is an upsert keyed on that
-- constraint. Closing off UPDATE (submissions) / post-submit UPDATE
-- (quiz_attempts) for students means the only way to get a second live
-- attempt is a teacher-initiated DELETE, which naturally becomes a fresh
-- INSERT next time via the existing upsert — no new column needed.

-- ── submissions: students can never UPDATE their own submission again ──
-- once inserted. TEACHER/ADMIN keep unrestricted update access for grading.
DROP POLICY IF EXISTS "sub_update" ON public.submissions;
CREATE POLICY "sub_update" ON public.submissions FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER', 'ADMIN')
);

-- New: only the assignment's creator, the class teacher of the student's
-- current class, or ADMIN may delete a submission (used for "reset attempt").
CREATE POLICY "sub_delete" ON public.submissions FOR DELETE USING (
  school_id = current_school_id() AND (
    current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id = assignment_id AND a.created_by_id = current_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM public.students s
      JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
      WHERE s.id = student_id AND t.user_id = current_user_id()
    )
  )
);

-- ── quiz_attempts: student UPDATE only while not yet submitted ──
-- (autosave/finalize still work pre-submit; nothing works post-submit,
-- including re-finalizing). TEACHER/ADMIN keep unrestricted access.
DROP POLICY IF EXISTS "qa_update" ON public.quiz_attempts;
CREATE POLICY "qa_update" ON public.quiz_attempts FOR UPDATE USING (
  school_id = current_school_id() AND (
    current_user_role() IN ('TEACHER', 'ADMIN')
    OR (
      submitted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
      AND EXISTS (
        SELECT 1 FROM public.quizzes q
        WHERE q.id = quiz_id AND (q.closes_at IS NULL OR now() <= q.closes_at)
      )
    )
  )
);

-- New: same creator/class-teacher/admin scoping as sub_delete, for "reset attempt".
CREATE POLICY "qa_delete" ON public.quiz_attempts FOR DELETE USING (
  school_id = current_school_id() AND (
    current_user_role() = 'ADMIN'
    OR EXISTS (
      SELECT 1 FROM public.quizzes q
      WHERE q.id = quiz_id AND q.created_by_id = current_user_id()
    )
    OR EXISTS (
      SELECT 1 FROM public.students s
      JOIN public.teachers t ON t.is_class_teacher_of = s.current_class_id
      WHERE s.id = student_id AND t.user_id = current_user_id()
    )
  )
);
