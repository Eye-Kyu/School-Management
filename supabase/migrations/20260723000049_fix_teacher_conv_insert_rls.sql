-- ============================================================
-- Fix conv_insert's TEACHER branch — guardians has no TEACHER read policy
-- ============================================================
-- conv_insert's TEACHER branch (20260723000038_admin_teacher_messaging.sql)
-- checks parent eligibility via a nested EXISTS against public.guardians.
-- That subquery runs under the CALLING teacher's own row security, same as
-- any other query — and guardians only has SELECT policies for ADMIN and
-- for a parent reading their own rows (guardians_select_admin,
-- guardians_select_own_parent, both in 20260522000002_enable_rls.sql).
-- There has never been a policy granting TEACHER any visibility into
-- guardians at all, so from a teacher's own RLS-scoped view this EXISTS
-- always evaluated to a guaranteed false, regardless of the underlying
-- data — teacher-initiated conversations (1:1 compose and the class
-- broadcast, which reuses this same branch) could never actually succeed.
-- Confirmed empirically: a direct RLS-scoped insert with a fully correct
-- fixture (real subject_assignments row, real guardians row) still failed
-- with 42501 before this fix.
--
-- Fixed with a SECURITY DEFINER helper (bypasses RLS internally for its own
-- lookup, same pattern current_user_id()/current_school_id()/
-- current_user_role() already use) rather than adding a broader TEACHER
-- SELECT policy on guardians — this keeps the "can this teacher message
-- this parent" check narrowly scoped instead of opening up general
-- teacher-facing guardians visibility as a side effect.

CREATE OR REPLACE FUNCTION public.teacher_may_message_parent(p_teacher_user_id uuid, p_parent_user_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.user_id = p_teacher_user_id
      AND EXISTS (
        SELECT 1
        FROM public.guardians g
        JOIN public.students s ON s.id = g.student_id
        WHERE g.user_id = p_parent_user_id
          AND (
            s.current_class_id = t.is_class_teacher_of
            OR EXISTS (
              SELECT 1 FROM public.subject_assignments sa
              WHERE sa.teacher_id = t.id AND sa.class_id = s.current_class_id
            )
          )
      )
  );
$$;

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
      AND public.teacher_may_message_parent(current_user_id(), parent_user_id)
    )
  )
);
