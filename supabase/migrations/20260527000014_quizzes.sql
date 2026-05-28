-- ============================================================
-- v0.3 Week 17 — In-app quizzes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quizzes (
  id            UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID         NOT NULL REFERENCES public.schools(id)    ON DELETE CASCADE,
  class_id      UUID         NOT NULL REFERENCES public.classes(id)    ON DELETE CASCADE,
  subject_id    UUID                  REFERENCES public.subjects(id)   ON DELETE SET NULL,
  term_id       UUID                  REFERENCES public.terms(id)      ON DELETE SET NULL,
  created_by_id UUID         NOT NULL REFERENCES public.users(id)      ON DELETE CASCADE,
  title         TEXT         NOT NULL,
  time_limit_mins INT,
  is_published  BOOLEAN      NOT NULL DEFAULT false,
  shuffle_questions BOOLEAN  NOT NULL DEFAULT true,
  shuffle_options   BOOLEAN  NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id            UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       UUID         NOT NULL REFERENCES public.quizzes(id)    ON DELETE CASCADE,
  school_id     UUID         NOT NULL REFERENCES public.schools(id)    ON DELETE CASCADE,
  position      INT          NOT NULL DEFAULT 0,
  kind          TEXT         NOT NULL CHECK (kind IN ('MCQ', 'SHORT_ANSWER')),
  body          TEXT         NOT NULL,
  options       JSONB,      -- [{id, text}] for MCQ
  correct_option_id TEXT,   -- option id for MCQ auto-grade
  points        NUMERIC(5,2) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id            UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID         NOT NULL REFERENCES public.schools(id)    ON DELETE CASCADE,
  quiz_id       UUID         NOT NULL REFERENCES public.quizzes(id)    ON DELETE CASCADE,
  student_id    UUID         NOT NULL REFERENCES public.students(id)   ON DELETE CASCADE,
  started_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  submitted_at  TIMESTAMPTZ,
  score         NUMERIC(6,2),
  max_score     NUMERIC(6,2),
  tab_blur_count INT         NOT NULL DEFAULT 0,
  answers       JSONB        NOT NULL DEFAULT '{}', -- {question_id: answer_text_or_option_id}
  UNIQUE (quiz_id, student_id)
);

CREATE INDEX IF NOT EXISTS quiz_questions_quiz_idx ON public.quiz_questions (quiz_id, position);
CREATE INDEX IF NOT EXISTS quiz_attempts_student_idx ON public.quiz_attempts (student_id);

-- RLS
ALTER TABLE public.quizzes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts   ENABLE ROW LEVEL SECURITY;

-- Quizzes: teachers/admins manage; students see published ones in their class
CREATE POLICY "quiz_select" ON public.quizzes FOR SELECT USING (
  school_id = current_school_id() AND (
    current_user_role() IN ('TEACHER','ADMIN') OR is_published = true
  )
);
CREATE POLICY "quiz_insert" ON public.quizzes FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
CREATE POLICY "quiz_update" ON public.quizzes FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
CREATE POLICY "quiz_delete" ON public.quizzes FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);

-- Questions: same as quizzes
CREATE POLICY "qq_select" ON public.quiz_questions FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "qq_insert" ON public.quiz_questions FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
CREATE POLICY "qq_update" ON public.quiz_questions FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);
CREATE POLICY "qq_delete" ON public.quiz_questions FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('TEACHER','ADMIN')
);

-- Attempts: students manage their own; teachers/admins read all
CREATE POLICY "qa_select" ON public.quiz_attempts FOR SELECT USING (
  school_id = current_school_id() AND (
    current_user_role() IN ('TEACHER','ADMIN')
    OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
  )
);
CREATE POLICY "qa_insert" ON public.quiz_attempts FOR INSERT WITH CHECK (
  school_id = current_school_id() AND
  EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
);
CREATE POLICY "qa_update" ON public.quiz_attempts FOR UPDATE USING (
  school_id = current_school_id() AND (
    current_user_role() IN ('TEACHER','ADMIN') OR
    EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.user_id = current_user_id())
  )
);

-- Document library (Week 19)
CREATE TABLE IF NOT EXISTS public.documents (
  id            UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID         NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  uploaded_by_id UUID        NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  title         TEXT         NOT NULL,
  file_url      TEXT         NOT NULL,
  file_name     TEXT         NOT NULL,
  file_size     BIGINT,
  mime_type     TEXT,
  audience      TEXT         NOT NULL DEFAULT 'SCHOOL_WIDE'
                             CHECK (audience IN ('SCHOOL_WIDE','GRADE','CLASS')),
  target_grade_level INT,
  target_class_id UUID       REFERENCES public.classes(id) ON DELETE SET NULL,
  tags          TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_school_idx ON public.documents (school_id, created_at DESC);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "docs_select" ON public.documents FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "docs_insert" ON public.documents FOR INSERT WITH CHECK (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN','TEACHER')
);
CREATE POLICY "docs_update" ON public.documents FOR UPDATE USING (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN','TEACHER')
);
CREATE POLICY "docs_delete" ON public.documents FOR DELETE USING (
  school_id = current_school_id() AND current_user_role() IN ('ADMIN','TEACHER')
);
