-- Events / calendar
CREATE TABLE public.events (
  id                 UUID NOT NULL PRIMARY KEY,
  school_id          UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  created_by_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  starts_at          TIMESTAMPTZ NOT NULL,
  ends_at            TIMESTAMPTZ NOT NULL,
  all_day            BOOLEAN NOT NULL DEFAULT false,
  event_type         TEXT NOT NULL DEFAULT 'GENERAL',
  audience           TEXT NOT NULL DEFAULT 'SCHOOL_WIDE',
  target_grade_level INTEGER,
  target_class_id    UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_select" ON public.events FOR SELECT  USING (school_id = current_school_id());
CREATE POLICY "events_insert" ON public.events FOR INSERT  WITH CHECK (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "events_update" ON public.events FOR UPDATE  USING  (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "events_delete" ON public.events FOR DELETE  USING  (school_id = current_school_id() AND current_user_role() = 'ADMIN');

-- Physical homework assignments (in-person, no file upload)
CREATE TABLE public.homework_assignments (
  id          UUID NOT NULL PRIMARY KEY,
  school_id   UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id  UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  teacher_id  UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  due_date    DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.homework_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "homework_select" ON public.homework_assignments FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "homework_insert" ON public.homework_assignments FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER'));
CREATE POLICY "homework_update" ON public.homework_assignments FOR UPDATE USING  (school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER'));
CREATE POLICY "homework_delete" ON public.homework_assignments FOR DELETE USING  (school_id = current_school_id() AND current_user_role() IN ('ADMIN', 'TEACHER'));

-- Student completion ticks
CREATE TABLE public.homework_completions (
  id           UUID NOT NULL PRIMARY KEY,
  school_id    UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  homework_id  UUID NOT NULL REFERENCES public.homework_assignments(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (homework_id, student_id)
);

ALTER TABLE public.homework_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hw_comp_select" ON public.homework_completions FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "hw_comp_insert" ON public.homework_completions FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() = 'STUDENT'
);
CREATE POLICY "hw_comp_delete" ON public.homework_completions FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() = 'STUDENT'
);
