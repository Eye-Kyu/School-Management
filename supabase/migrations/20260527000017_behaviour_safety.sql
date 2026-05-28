-- ============================================================
-- v0.4 Week 25 — Behaviour, permission slips, safety tip line
-- ============================================================

CREATE TABLE IF NOT EXISTS public.behaviour_points (
  id           UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    UUID         NOT NULL REFERENCES public.schools(id)   ON DELETE CASCADE,
  student_id   UUID         NOT NULL REFERENCES public.students(id)  ON DELETE CASCADE,
  teacher_id   UUID         NOT NULL REFERENCES public.teachers(id)  ON DELETE CASCADE,
  category     TEXT         NOT NULL CHECK (category IN ('POSITIVE','NEGATIVE')),
  points       INT          NOT NULL DEFAULT 1,
  reason       TEXT         NOT NULL,
  date         DATE         NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bp_student_idx ON public.behaviour_points (student_id, date DESC);

CREATE TABLE IF NOT EXISTS public.permission_slips (
  id                UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  created_by_id     UUID         NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  title             TEXT         NOT NULL,
  description       TEXT,
  audience          TEXT         NOT NULL DEFAULT 'SCHOOL_WIDE',
  target_class_id   UUID         REFERENCES public.classes(id) ON DELETE SET NULL,
  response_deadline DATE,
  one_time_code     TEXT         NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permission_slip_responses (
  id              UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID         NOT NULL REFERENCES public.schools(id)          ON DELETE CASCADE,
  slip_id         UUID         NOT NULL REFERENCES public.permission_slips(id) ON DELETE CASCADE,
  student_id      UUID         NOT NULL REFERENCES public.students(id)         ON DELETE CASCADE,
  parent_user_id  UUID         NOT NULL REFERENCES public.users(id)            ON DELETE CASCADE,
  signed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (slip_id, student_id)
);

-- No student_id stored — anonymous by design
CREATE TABLE IF NOT EXISTS public.safety_tips (
  id             UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      UUID         NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  message        TEXT         NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  status         TEXT         NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEWED','ACTIONED')),
  reviewed_by_id UUID         REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.behaviour_points        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_slips        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_slip_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_tips             ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bp_select"  ON public.behaviour_points FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "bp_insert"  ON public.behaviour_points FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN'));
CREATE POLICY "bp_delete"  ON public.behaviour_points FOR DELETE USING (school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN'));

CREATE POLICY "ps_select"  ON public.permission_slips FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "ps_insert"  ON public.permission_slips FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "ps_delete"  ON public.permission_slips FOR DELETE USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');

CREATE POLICY "psr_select" ON public.permission_slip_responses FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "psr_insert" ON public.permission_slip_responses FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() = 'PARENT');

-- Safety tips: anyone can insert (public), only admin reads
CREATE POLICY "st_insert"  ON public.safety_tips FOR INSERT WITH CHECK (true);
CREATE POLICY "st_select"  ON public.safety_tips FOR SELECT USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');
CREATE POLICY "st_update"  ON public.safety_tips FOR UPDATE USING (school_id = current_school_id() AND current_user_role() = 'ADMIN');
