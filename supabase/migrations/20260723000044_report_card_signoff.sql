-- ============================================================
-- Report card sign-off — Class Teacher locks the class_teacher_comment
-- ============================================================
-- student_report_cards previously had no locking concept, and its RLS gave
-- ANY teacher full read/write on ANY student's report card (not scoped to
-- the class teacher at all). This adds locking; the class-teacher-only
-- scoping of who may create the lock is enforced primarily at the API layer
-- plus the trigger below (RLS's declarative WITH CHECK can't compare
-- old-vs-new column values, a trigger can — same reasoning as the
-- reject_student_conversation_participant trigger from the messaging PR).

ALTER TABLE public.student_report_cards
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_by_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.check_report_card_signoff()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.users u WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL AND u.role = 'ADMIN'
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.teachers t
      JOIN public.users u ON u.id = t.user_id
      JOIN public.students s ON s.id = NEW.student_id
      WHERE u.auth_id = auth.uid() AND u.deleted_at IS NULL
        AND t.is_class_teacher_of = s.current_class_id
    ) THEN
      RAISE EXCEPTION 'Only the class teacher of this student or an admin may sign off a report card';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS report_card_signoff_check ON public.student_report_cards;
CREATE TRIGGER report_card_signoff_check
  BEFORE UPDATE ON public.student_report_cards
  FOR EACH ROW EXECUTE FUNCTION public.check_report_card_signoff();

-- Replace the single FOR ALL policy with lock-aware granularity: SELECT and
-- INSERT stay as permissive as before for ADMIN/TEACHER; UPDATE now blocks
-- a TEACHER once the row is locked (ADMIN can still unlock/correct); DELETE
-- is unchanged (locking is about edits, not row lifecycle).
DROP POLICY IF EXISTS "rc_admin_teacher" ON public.student_report_cards;

CREATE POLICY "rc_select" ON public.student_report_cards FOR SELECT USING (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER')
);

CREATE POLICY "rc_insert" ON public.student_report_cards FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER')
);

CREATE POLICY "rc_update" ON public.student_report_cards FOR UPDATE USING (
  school_id = current_school_id()
  AND (
    current_user_role() = 'ADMIN'
    OR (current_user_role() = 'TEACHER' AND locked_at IS NULL)
  )
);

CREATE POLICY "rc_delete" ON public.student_report_cards FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER')
);
