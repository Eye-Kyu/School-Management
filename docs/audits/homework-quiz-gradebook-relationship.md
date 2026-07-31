# Homework / Quiz / Gradebook Relationship Audit

**Scope:** Bucket 1, PR 2, Phase 1 — audit the current homework, quiz, and assessments/gradebook modules to determine the right integration model for a "count toward term grade" workflow, before any implementation begins.

**Status:** Phase 1 (audit) complete. **No code changes in this PR.** Awaiting explicit review/go-ahead before Phase 2 implementation starts, per the task's own instruction.

## Summary

| Area | Finding |
|---|---|
| Homework backend | Real NestJS module (`apps/api/src/homework/`) — but **zero grading capability exists today** (no score column anywhere) |
| Quiz backend | **No NestJS backend exists at all.** 100% client-side Supabase writes, RLS-enforced |
| Homework ↔ assessments link today | None (confirmed, no FK/join/shared ID/code path) |
| Quiz ↔ assessments link today | None (confirmed, same) |
| RLS blocker for a naive quiz cascade | **Real.** `grades` INSERT/UPDATE requires `TEACHER`/`ADMIN` role — a STUDENT (who triggers MCQ auto-grading at submission) cannot write to `grades` under any circumstance |
| Recommended integration model | **Model A (additive linking)**, with two Phase-2-shaping caveats (see §1.5) |
| New drift/gap findings (logged separately in `docs/bug-triage.md`, not fixed here) | 3 |

---

## 1.1 Homework module structure

### Backing tables

Two tables, both defined once in `supabase/migrations/20260526000008_events_homework.sql`, **never altered since** (confirmed via a repo-wide grep for `ALTER TABLE public.homework` across all migration files — zero hits beyond RLS policy re-issues).

**`public.homework_assignments`** (`20260526000008_events_homework.sql:26-37`):

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `school_id` | UUID | NOT NULL, FK → `schools(id)` CASCADE |
| `class_id` | UUID | NOT NULL, FK → `classes(id)` CASCADE |
| `subject_id` | UUID | FK → `subjects(id)` SET NULL |
| `teacher_id` | UUID | NOT NULL, FK → `teachers(id)` CASCADE |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | nullable |
| `due_date` | DATE | NOT NULL |
| `created_at`/`updated_at` | TIMESTAMPTZ | NOT NULL |

**No score, max-score, or max-grade column exists on this table.**

**`public.homework_completions`** (`20260526000008_events_homework.sql:46-53`):

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `school_id` | UUID | NOT NULL, FK → `schools(id)` CASCADE |
| `homework_id` | UUID | NOT NULL, FK → `homework_assignments(id)` CASCADE |
| `student_id` | UUID | NOT NULL, FK → `students(id)` CASCADE |
| `completed_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| — | — | UNIQUE(`homework_id`, `student_id`) |

This is a boolean "did it" tick — one row means "completed." **No content, no file, no score field of any kind.**

A separate, unrelated, currently-**dead** table pair also exists from the same migration that created `assessments`/`grades` — `public.assignments`/`public.submissions` (`supabase/migrations/20260527000012_gradebook.sql:6-36`), with a real `submissions.grade_score NUMERIC(6,2)` column and `assignments.max_score NUMERIC(6,2)`. **No NestJS controller and no frontend page anywhere queries either table** (confirmed via `grep -rln "assignments\|submissions" apps/api/src` — the only hits are a false-positive substring match on `homework_assignments` and an unrelated storage-bucket migration). This is orphaned schema, not to be confused with the live `homework_assignments`/`homework_completions` pair, and not currently reachable by any user action.

### Creation flow

- **Route:** `POST /homework` — `apps/api/src/homework/homework.controller.ts:21-28` (guarded by `AuthGuard`, `FeatureGuard`, `@RequireModule('homework')`).
- **Service:** `HomeworkService.create()` — `apps/api/src/homework/homework.service.ts:90-151`. Resolves `teacher_id` (own row for TEACHER; falls back to any teacher in the school via `this.supabase.admin` for ADMIN callers, lines 110-116), inserts into `homework_assignments` (lines 123-137), writes an `audit_logs` row (lines 140-148).
- **Request schema:** `CreateHomeworkInput` — `packages/types/src/schemas/homework.ts:3-9` — `classId, subjectId?, title, description?, dueDate`. **No score/maxScore field.**
- Other routes on the same controller: `GET /homework` (list), `DELETE /homework/:id` (remove), `POST`/`DELETE /homework/:id/complete` (student completion toggle) — `homework.controller.ts:16-43`.

### Submission storage and score

**There is no homework submission-with-score concept at all.** The only per-student record is the completion tick described above. The score-bearing column that exists in this codebase (`submissions.grade_score`) belongs to the unrelated, dead `assignments`/`submissions` pair — never touched by `homework`-module code.

### Grading flow

**None exists.** Exhaustive check: `grep -n -i "assessment|grade|score"` against every file in `apps/api/src/homework/` returns zero matches. The frontend mirrors this — the same grep against the teacher/student/parent homework pages returns zero matches. `HomeworkController` exposes exactly 5 routes (list, create, delete, complete, uncomplete); none accept or write a score.

For contrast, the closest existing pattern for "how grading would work" is the `assessments` module's `POST /assessments/:id/scores` → `AssessmentsService.upsertScores()` (`apps/api/src/assessments/assessments.service.ts:143-170`), which runs through a user-scoped (`forUser`, RLS-enforced) client, not `admin`.

### Touches `assessments` today?

**No — confirmed fully separate.** No FK from either homework table to `assessments`/`grades`; no FK the other direction either. Grepped specifically inside both modules' controller/service files (not just migrations) for cross-references — zero matches in either direction. `homework` and `assessments` are also independently toggleable feature-module flags (`20260721000023_module_registry.sql:132,135`) — a school could enable one without the other.

**Aside, not a link, but a documentation mismatch worth noting**: the module registry describes `homework` as "online homework and assignment submission" (`20260721000023_module_registry.sql:135`), but the live implementation is a physical/in-class completion-tick model with no file upload or online submission at all. Not something this PR needs to fix, but relevant context — the module's marketing description overstates what it currently does.

### Divide-by-zero / max-score risk for homework specifically

Moot today — there is no max-score column and no grading capability, so there's nothing to divide by yet. This is purely greenfield: any Phase 2 homework-grading feature is new work, not an extension of an existing (and possibly drift-prone) scoring pattern.

---

## 1.2 Quiz module structure

### Backing tables

Three tables, created in `supabase/migrations/20260527000014_quizzes.sql:5-44`. Only one later `ADD COLUMN` exists across all three (confirmed via a full-migration grep for `ALTER TABLE public.(quiz|quiz_questions|quiz_attempts)`).

**`public.quizzes`** (`20260527000014_quizzes.sql:5-18`, altered by `20260723000039_quiz_assignment_deadlines.sql:11-12`):

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `school_id` | UUID | NOT NULL, FK → schools, CASCADE |
| `class_id` | UUID | NOT NULL, FK → classes, CASCADE |
| `subject_id` | UUID | FK → subjects, SET NULL |
| `term_id` | UUID | FK → terms, SET NULL (**nullable**) |
| `created_by_id` | UUID | NOT NULL, FK → users, CASCADE |
| `title` | TEXT | NOT NULL |
| `time_limit_mins` | INT | nullable |
| `is_published` | BOOLEAN | NOT NULL DEFAULT false |
| `shuffle_questions`/`shuffle_options` | BOOLEAN | NOT NULL DEFAULT true |
| `closes_at` | TIMESTAMPTZ | nullable — **added later**, `20260723000039_quiz_assignment_deadlines.sql:11-12` |

No `max_score`/`total_points` column on `quizzes` itself.

**`public.quiz_questions`** (`20260527000014_quizzes.sql:20-30`, never altered since):

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `quiz_id` | UUID | NOT NULL, FK → quizzes, CASCADE |
| `position` | INT | NOT NULL DEFAULT 0 |
| `kind` | TEXT | NOT NULL, `CHECK (kind IN ('MCQ','SHORT_ANSWER'))` |
| `body` | TEXT | NOT NULL |
| `options` | JSONB | nullable (`[{id,text}]` for MCQ) |
| `correct_option_id` | TEXT | nullable |
| `points` | NUMERIC(5,2) | NOT NULL DEFAULT 1 |

**`public.quiz_attempts`** (`20260527000014_quizzes.sql:32-44`, never column-altered since — only RLS policies re-issued):

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `quiz_id` | UUID | NOT NULL, FK → quizzes, CASCADE |
| `student_id` | UUID | NOT NULL, FK → students, CASCADE |
| `started_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| `submitted_at` | TIMESTAMPTZ | nullable |
| `score` | NUMERIC(6,2) | nullable, **no CHECK** |
| `max_score` | NUMERIC(6,2) | nullable, **no CHECK** |
| `tab_blur_count` | INT | NOT NULL DEFAULT 0 |
| `answers` | JSONB | NOT NULL DEFAULT `{}` |
| — | — | **UNIQUE(`quiz_id`, `student_id`)** |

**Prisma cross-check:** `packages/db/prisma/schema.prisma` has **no `Quiz`/`QuizQuestion`/`QuizAttempt` model at all** (case-insensitive grep for "quiz" → zero matches). Unlike `assessments`, quiz tables are entirely invisible to Prisma, which is presumably *why* they haven't drifted the same way — but it also means any future `prisma db push` against a dev DB before a matching migration exists could reproduce the exact same drift class the `assessments` fix already had to correct.

### Creation, publishing, and question authoring

**There is no NestJS controller for quizzes.** Confirmed three ways: no `apps/api/src/quiz*` directory exists; a repo-wide grep for "quiz" in `apps/api/src` returns only AI question-generation code (unrelated to persistence, see below); and the module registry itself documents this explicitly — `supabase/migrations/20260721000023_module_registry.sql:139` — `-- Optional — RLS-only (no NestJS controller exists; RLS is the sole enforcement point)`.

All quiz mutations happen from Next.js client components via the browser Supabase client (RLS-enforced):
- **Create:** `apps/web/app/(dashboard)/teacher/quizzes/QuizzesTeacherClient.tsx:35-43` — `supabase.from('quizzes').insert({...})`.
- **Publish (a separate step, not atomic with creation):** same file, `togglePublish`, lines 54-57 — an unconditional boolean flip, `supabase.from('quizzes').update({ is_published: !current })`. **No check that the quiz has ≥1 question before publish.**
- **Add questions (separate step, one at a time or AI-bulk):** `apps/web/app/(dashboard)/teacher/quizzes/[id]/QuizBuilderClient.tsx`, `saveQuestion` (lines 169-196) and `handleAiQuestions` (lines 204-221) — both direct `supabase.from('quiz_questions').insert(...)`.
- **AI question generation** does go through NestJS (`POST /ai/generate-quiz`, `apps/api/src/ai/ai.controller.ts:28-29` → `ai.service.ts:76`), but it only returns proposed question JSON — it never writes to `quiz_questions`; persistence is client-side as above.

### Attempt/submission storage and one-attempt enforcement

- **Score:** `quiz_attempts.score`, nullable, no CHECK.
- **Max score:** `quiz_attempts.max_score`, stored **per attempt**, computed client-side as `Σ quiz_questions.points` at submit time (`apps/web/app/(dashboard)/student/quizzes/[id]/QuizTaker.tsx:123-131`) — there is no denormalized total on `quizzes` itself.
- **One-attempt-per-student is enforced by three layered mechanisms, all of which must be preserved together by any future change** (per the task's own explicit "do not change quiz attempt limits" instruction):
  1. DB `UNIQUE(quiz_id, student_id)` (`20260527000014_quizzes.sql:43`), with the student-facing write as an `upsert` keyed on exactly this constraint (`QuizTaker.tsx:69-75`).
  2. RLS `qa_update` only permits a student to update their own attempt while `submitted_at IS NULL` (`20260723000052_single_attempt_lock.sql:38-51`) — this is what actually prevents re-submission, not the UNIQUE constraint alone (the UNIQUE constraint governs the upsert's *target row*, not whether it's still writable).
  3. A teacher/admin-only reset path (`qa_delete`, `20260723000052_single_attempt_lock.sql:54-67`) is the sole way to intentionally allow a new attempt, and is itself audited (`resetAttempt`, `QuizBuilderClient.tsx:120-158`, writes `audit_logs` with `action: 'quiz.reset'`).

### Auto-grading logic

**Runs entirely in the student's browser**, not server-side, not via a DB trigger. `QuizTaker.tsx:118-143` (`handleSubmit`): loops questions, sums `points` into `maxScore`, adds a question's `points` to `score` only for MCQ questions where the selected answer matches `correct_option_id`; SHORT_ANSWER questions contribute 0 until a teacher grades them. The computed `score`/`max_score` are written via a direct client `update` call (lines 133-138). Confirmed no DB trigger exists for this (a full grep of every `CREATE TRIGGER` across all migrations found 5 total, none touching any `quiz*` table).

**Because this is a client-side computation submitted via a plain RLS-gated write, RLS only verifies *who* can write which row (the student, their own attempt, before submission, before any deadline) — not that the submitted score is arithmetically consistent with the submitted answers.** A technically savvy student could in principle submit an arbitrary score through the same call shape. This is a pre-existing characteristic of the current design, not introduced by this audit's scope, but directly relevant to whether a future gradebook cascade should trust `quiz_attempts.score` as-is or re-derive/re-verify it server-side at the cascade point.

### Manual grading for SHORT_ANSWER questions

Also entirely client-side. `ShortAnswerReview` component inside `QuizBuilderClient.tsx:21-103`; the grading action `finalise()` (lines 34-55) computes `newScore = (attempt.score ?? 0) + saBonus` and writes it back to the **same** `quiz_attempts.score` column MCQ auto-grading uses (there is no separate manual-score column) — `:45-47`. This write goes through the `TEACHER`/`ADMIN` branch of `qa_update` RLS, which (unlike the student branch) has no `submitted_at` restriction, so teachers can finalize short-answer scores post-submission.

### Touches `assessments` today?

**No — confirmed fully separate**, and explicitly documented in-code: `QuizBuilderClient.tsx:49-51` has a comment stating quiz scores live entirely in `quiz_attempts` and are never pushed into `grades`. DB-level confirmation: `grades.assessment_id` FKs only to `assessments`; `assessments` has no `quiz_id` column; a repo-wide grep for `quiz_id` shows every occurrence confined to the quiz tables' own files.

### Divide-by-zero / max-score risk

**Real and currently only guarded ad hoc, client-side, in ~4 separate places** (`QuizTaker.tsx:146`, `QuizReview.tsx:23`, `QuizBuilderClient.tsx:351`, `apps/web/app/(dashboard)/student/quizzes/page.tsx:52-53`), no shared utility. Nothing prevents publishing a zero-question quiz (`togglePublish` has no question-count check, and there's no NestJS layer to add one to), and a zero-question quiz's `max_score` genuinely persists as `0.00` (not NULL) after submission. **Any future score-normalization formula must bring its own zero/NULL guard — nothing upstream can be relied on.**

---

## 1.3 Gradebook / assessments module structure

### Live `assessments` schema

Cross-checked `packages/db/prisma/schema.prisma:346-371` against `supabase/migrations/20260728000073_fix_assessments_schema_drift.sql` (the sub-sprint 4 corrective migration) — they agree on the live shape:

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `school_id`, `class_id`, `subject_id`, `teacher_id` | UUID | NOT NULL, FK CASCADE |
| `term_id` | UUID | **NOT NULL per Prisma** — see caveat below |
| `name` | String | NOT NULL |
| `description` | String | nullable |
| `max_marks` | Int | NOT NULL, **no `CHECK (max_marks > 0)` anywhere** |
| `assessment_date` | Date | nullable |
| — | — | UNIQUE(`term_id`, `class_id`, `subject_id`, `name`) |

The only positivity guard on `max_marks` is an **app-layer** Zod schema (`packages/types/src/schemas/assessments.ts:10`, `.int().positive().max(1000)`) that applies **only** to requests through `POST /assessments` — not to the direct-Supabase write path (see below), and not re-validated anywhere a score is later saved.

**Caveat on `term_id`, flagged as a new finding (not in the original drift-fix's scope):** the original `20260527000012_gradebook.sql:44` declared `term_id` nullable with `ON DELETE SET NULL`. Prisma says non-optional with `onDelete: Cascade`. Unlike `teacher_id`/`max_marks` — which `20260728000073_fix_assessments_schema_drift.sql:43-51` explicitly reconciled with a conditional `SET NOT NULL` — no migration ever does the same for `term_id`. The live DB (built originally via `prisma db push`) presumably matches Prisma, but a from-scratch bootstrap replaying only the migration files would not. Logged in `docs/bug-triage.md` (see below), not fixed here.

### `grades` table

`supabase/migrations/20260527000012_gradebook.sql:54-66`, unchanged since (only RLS re-issued):

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `assessment_id` | UUID | NOT NULL, FK → assessments, CASCADE |
| `student_id` | UUID | NOT NULL, FK → students, CASCADE |
| `score` | NUMERIC(6,2) | nullable |
| `comment` | TEXT | nullable |
| `graded_by_id`/`graded_at` | — | nullable |
| — | — | **UNIQUE(`assessment_id`, `student_id`)** |

**New finding, logged separately in `docs/bug-triage.md`:** `packages/db/prisma/schema.prisma:373-391` defines `model Score` mapped `@@map("scores")` — but no migration ever creates a `public.scores` table (grep for `CREATE TABLE.*scores` across all migrations → zero results), and every live consumer (`apps/api/src/assessments/assessments.service.ts:136,165,198,235`) reads/writes `public.grades`. Prisma's table-map name for this model is simply wrong. This is a second, previously-undocumented instance of the exact drift class the `assessments` table itself already had one incident of.

### How a teacher enters a grade today

**Two independent, coexisting paths, both RLS-scoped (neither uses `admin`):**

1. **Direct browser Supabase writes**, bypassing NestJS entirely — `apps/web/app/(dashboard)/teacher/gradebook/GradebookClient.tsx`: create assessment (`:84-93`, `supabase.from('assessments').insert(...)`), enter/autosave a score (`:110-116`, `supabase.from('grades').upsert(..., { onConflict: 'assessment_id,student_id' })`, 800ms debounce). Notably `filteredSubjects = subjects; // all subjects (teacher can enter grades for any)` (`:141`) — this path does **not** scope the subject dropdown to the teacher's actual `subject_assignments`, and (see RLS below) neither does the database.
2. **Through NestJS** — `POST /assessments/:id/scores` → `AssessmentsController.upsertScores` (`assessments.controller.ts:64-71`) → `AssessmentsService.upsertScores()` (`assessments.service.ts:143-170`), using `this.supabase.forUser(accessToken)` (RLS-scoped, confirmed no `admin` usage anywhere in this service via grep). Assessment *creation* through this path (`assessments.service.ts:64-123`) **does** app-layer-check `subject_assignments` for TEACHER callers (lines 84-100) — stronger than path 1 — but `upsertScores()` itself does not re-verify teacher ownership of the target assessment; it relies entirely on RLS.

### Aggregation / term totals / report cards

Shared math module: **`packages/types/src/grading.ts`** — its own header comment records this as the sub-sprint 4 "reconciliation": both report-card renderers previously computed term averages independently and disagreed. `calculateSubjectAverage()` (lines 26-31) computes an **unweighted mean of each assessment's own percentage** (a 10-mark quiz would count equally to a 100-mark exam under this formula — relevant if quiz-derived assessments are added later), and **already drops any row with `maxMarks <= 0`** — i.e., the aggregation layer already guards the zero-max case, even though nothing upstream currently guarantees `max_marks` can't be zero or negative. `assignLetterGrade()` (lines 34-40) maps percentage to A–E. Used by both `apps/web/app/report-card/[studentId]/page.tsx` and `apps/web/app/print/report-card/[studentId]/page.tsx`, unit-tested in `apps/api/src/__tests__/grading.spec.ts`.

**Report cards read `grades` live, every render** — no cache or precompute table exists (the adjacent `student_report_cards` table only stores head-teacher/class-teacher comments and a publish flag, explicitly noting in its own top comment that "grades come from the assessments/grades tables"). Nothing to invalidate.

A `SECURITY DEFINER` Postgres function, `class_average_scores(p_assessment_ids uuid[])` (`supabase/migrations/20260724000054_tighten_gradebook_rls.sql:138-149`), already exists in this codebase specifically to let STUDENT/PARENT callers get a class-average aggregate without needing raw per-classmate row access — **this is the established precedent for "narrowly-scoped server-side function that safely does something RLS alone won't allow a given role to do directly,"** directly relevant to the quiz-cascade problem in §1.2/§1.5.

### RLS relevant to a homework/quiz → gradebook link

`assess_insert`/`assess_update` and `grade_insert`/`grade_update` (`20260527000012_gradebook.sql:102-107,114-119`) have never been tightened beyond their original form — confirmed via a grep for these exact policy names across every migration; only the SELECT-side policies were later reworked (`20260724000054_tighten_gradebook_rls.sql`). All four are **role (`TEACHER`/`ADMIN`) + `school_id` only — no class or subject-assignment scoping at the RLS layer.**

For comparison, `homework_insert`/`homework_update` (`20260526000008_events_homework.sql:39-43`) are the identical shape/coarseness. `quiz_insert` similarly (`20260721000024_module_enforcement_rls.sql:57-66`), plus a `module_enabled()` gate.

**Direct answer to the audit's own question:** adding new columns (`source_type`, `source_id`) to `assessments` would **not** be blocked by any existing `assess_insert`/`assess_update` policy — Postgres RLS `WITH CHECK`/`USING` clauses only evaluate columns they explicitly reference, and a new, unreferenced column is invisible to them. **But the inverse is also true and matters more**: these coarse policies also wouldn't *validate* a link's legitimacy — any TEACHER/ADMIN in the school could create an assessment claiming `source_id` = a homework/quiz row they don't actually own, with zero RLS-level pushback. Enforcing real ownership would need either new `WITH CHECK` logic (an `EXISTS` against the source table, checking `teacher_id`/`class_id` match) or app-layer validation mirroring `assessments.service.ts create()`'s existing `subject_assignments` check.

---

## 1.4 The three-way overlap

- **`submissions.grade_score` (the dead `assignments`/`submissions` pair) and `grades.score` are the same concept** — both `NUMERIC(6,2)`, both paired with a comment/graded-by/graded-at quartet, both meaning "the numeric mark a teacher assigned to one student's piece of work." The only structural difference is which parent table they key off. Not relevant to the live `homework_assignments` system (which has no score concept at all), but relevant if anyone later resurrects the dead `assignments`/`submissions` tables.
- **Natural join points:** `assessments`, `homework_assignments`, and `quizzes` all share the same `school_id`/`class_id`/`subject_id` UUID space (same target tables), so a `source_id` UUID FK is mechanically clean — no type mismatch to resolve.
- **The real structural mismatch is `term_id`:** `assessments.term_id` is required (see §1.3 caveat). `homework_assignments` has **no `term_id` column at all** — only `due_date`. `quizzes.term_id` exists but is **nullable/optional**. Linking either source into `assessments` requires either resolving a term at link time (comparing `due_date` against `terms`' date ranges for homework, with an explicit error path when no term matches) or making `assessments.term_id` nullable (itself a real schema change touching the one column already flagged above as ambiguously specified). **This is exactly why the task's own Phase 2 spec already requires an explicit "Term" field on the linking form** — the audit confirms this is a hard technical necessity, not a UX nicety.
- **`subject_id` is nullable on both `homework_assignments` and `quizzes`, but NOT NULL on `assessments`** — a homework/quiz with no subject set could not cleanly become a linked assessment without a fallback or a required-subject prompt at link time.
- No RLS policy blocks the *creation* of the link (see §1.3); ownership *validation* of the link is an app-layer responsibility Phase 2 will need to add.

---

## 1.5 Recommendation

**Model A — Additive linking.** Evidence strongly supports it and rules out the alternatives:

- Model B (unify tables) is foreclosed by the task's own "do not merge tables" instruction, and this audit found no evidence that would justify overriding that instruction anyway — homework, quizzes, and assessments have genuinely different shapes (completion-tick vs. timed/auto-graded attempt vs. teacher-entered mark) that don't collapse cleanly into one row type without losing information (e.g., `quiz_attempts.answers`, `tab_blur_count`, `homework_completions.completed_at` have no equivalent on `assessments`/`grades`).
- Model A's mechanics (`assessments.source_type`/`source_id`) are mechanically clean for both sources — same UUID space, no type mismatches, and the migration path for existing data is trivial: every current `assessments` row simply becomes `source_type = 'DIRECT'` by default, and zero backfill is needed for homework/quizzes since nothing links them today.
- Risk it minimizes: it preserves 100% of existing homework and quiz behavior untouched (their own tables, their own RLS, their own UI) — a hard requirement per the task's "do not change how homework submissions are stored"/"do not change quiz attempt limits" instructions. The cost is confined to `assessments` gaining two new (mostly nullable) columns plus new application code for the linking/cascade workflow — no existing table's shape changes.
- Cost, stated plainly: the audit found the real cost is **not** the schema addition itself (cheap, safe, additive) — it's that **quizzes need genuinely new server-side infrastructure to make the cascade trustworthy and even possible**, since RLS correctly blocks a STUDENT from ever writing `grades` directly, and quiz auto-grading is currently a 100%-client-side, unverified computation. This is real, necessary Phase 2 scope, not gold-plating — either a narrowly-scoped `SECURITY DEFINER` function (mirroring the existing `class_average_scores()` precedent) or a new minimal NestJS quiz-submission endpoint is required, and Phase 2 planning should treat this as a first-class task, not an afterthought bolted onto "add two columns."

**Two Phase-2-shaping caveats, both grounded in evidence gathered here, not assumed:**

1. **The quiz-side cascade cannot be a plain client-side write.** `grade_insert`/`grade_update` RLS requires `TEACHER`/`ADMIN` role; a student's own MCQ-auto-grade-at-submission moment has neither. Phase 2 must introduce new, narrowly-scoped server-side infrastructure for this specific write, not extend the existing purely-client-side quiz pattern.
2. **The "Term" field on both linking forms is a hard requirement, not a default-and-forget convenience field**, because `assessments.term_id` is required and neither `homework_assignments` (no term concept at all) nor `quizzes` (optional term) can be relied on to already have one. Phase 2 needs an explicit "no matching term" error path for homework's due-date-based term inference.

**Three new findings logged in `docs/bug-triage.md` (Open), not fixed here** — genuine pre-existing gaps surfaced while tracing exactly the columns/tables a normalization feature would need to trust:
- Prisma's `Score`/`@@map("scores")` vs. the live `grades` table name (second instance of the drift class `20260728000073` already fixed once).
- `assessments.term_id`'s nullability/cascade behavior never explicitly reconciled between the original migration and Prisma, unlike `teacher_id`/`max_marks`.
- `max_marks` has no DB-level positivity guard, and the direct-Supabase grade-entry path doesn't even guard it at the app layer — directly relevant since any score-normalization formula divides by a max score with no guaranteed-positive upstream source.
