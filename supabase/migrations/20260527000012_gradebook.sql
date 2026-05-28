-- ============================================================
-- v0.3 — Gradebook: assessments, grades, online assignments, submissions
-- ============================================================

-- ── Online assignments (teacher-created, student-submitted) ──
CREATE TABLE IF NOT EXISTS public.assignments (
  id            UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID         NOT NULL REFERENCES public.schools(id)    ON DELETE CASCADE,
  class_id      UUID         NOT NULL REFERENCES public.classes(id)    ON DELETE CASCADE,
  subject_id    UUID                  REFERENCES public.subjects(id)   ON DELETE SET NULL,
  term_id       UUID                  REFERENCES public.terms(id)      ON DELETE SET NULL,
  created_by_id UUID         NOT NULL REFERENCES public.users(id)      ON DELETE CASCADE,
  title         TEXT         NOT NULL,
  description   TEXT,
  due_date      DATE         NOT NULL,
  allowed_types TEXT[]       NOT NULL DEFAULT ARRAY['pdf','doc','docx','txt','jpg','png'],
  max_score     NUMERIC(6,2),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.submissions (
  id            UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID         NOT NULL REFERENCES public.schools(id)     ON DELETE CASCADE,
  assignment_id UUID         NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id    UUID         NOT NULL REFERENCES public.students(id)    ON DELETE CASCADE,
  content       TEXT,
  file_urls     TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  submitted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_late       BOOLEAN      NOT NULL DEFAULT false,
  grade_score   NUMERIC(6,2),
  grade_comment TEXT,
  graded_by_id  UUID                  REFERENCES public.users(id)      ON DELETE SET NULL,
  graded_at     TIMESTAMPTZ,
  UNIQUE (assignment_id, student_id)
);

-- ── Gradebook assessments ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assessments (
  id            UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID         NOT NULL REFERENCES public.schools(id)    ON DELETE CASCADE,
  class_id      UUID         NOT NULL REFERENCES public.classes(id)    ON DELETE CASCADE,
  subject_id    UUID         NOT NULL REFERENCES public.subjects(id)   ON DELETE CASCADE,
  term_id       UUID                  REFERENCES public.terms(id)      ON DELETE SET NULL,
  created_by_id UUID         NOT NULL REFERENCES public.users(id)      ON DELETE CASCADE,
  name          TEXT         NOT NULL,
  kind          TEXT         NOT NULL CHECK (kind IN ('QUIZ','TEST','EXAM','CAT','ASSIGNMENT','OTHER')),
  weight        NUMERIC(5,2) NOT NULL DEFAULT 1,
  max_score     NUMERIC(6,2) NOT NULL DEFAULT 100,
  date          DATE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.grades (
  id              UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID         NOT NULL REFERENCES public.schools(id)      ON DELETE CASCADE,
  assessment_id   UUID         NOT NULL REFERENCES public.assessments(id)  ON DELETE CASCADE,
  student_id      UUID         NOT NULL REFERENCES public.students(id)     ON DELETE CASCADE,
  score           NUMERIC(6,2),
  comment         TEXT,
  graded_by_id    UUID                  REFERENCES public.users(id)        ON DELETE SET NULL,
  graded_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, student_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS assignments_class_idx    ON public.assignments (class_id, due_date);
CREATE INDEX IF NOT EXISTS submissions_student_idx  ON public.submissions  (student_id);
CREATE INDEX IF NOT EXISTS assessments_class_idx    ON public.assessments  (class_id, subject_id);
CREATE INDEX IF NOT EXISTS grades_assessment_idx    ON public.grades       (assessment_id);
CREATE INDEX IF NOT EXISTS grades_student_idx       ON public.grades       (student_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades       ENABLE ROW LEVEL SECURITY;

-- Assignments: teachers + admins write; students/parents in class read
CREATE POLICY "assign_select" ON public.assignments FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "assign_insert" ON public.assignments FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
CREATE POLICY "assign_update" ON public.assignments FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
CREATE POLICY "assign_delete" ON public.assignments FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);

-- Submissions: students insert their own; teachers + admins read all in their school
CREATE POLICY "sub_select" ON public.submissions FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "sub_insert" ON public.submissions FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() = 'STUDENT'
);
CREATE POLICY "sub_update" ON public.submissions FOR UPDATE USING (school_id = current_school_id());

-- Assessments: teachers + admins write; everyone in school reads
CREATE POLICY "assess_select" ON public.assessments FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "assess_insert" ON public.assessments FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
CREATE POLICY "assess_update" ON public.assessments FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
CREATE POLICY "assess_delete" ON public.assessments FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);

-- Grades: teachers + admins write; students see their own; parents see their child's
CREATE POLICY "grade_select" ON public.grades FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "grade_insert" ON public.grades FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
CREATE POLICY "grade_update" ON public.grades FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
