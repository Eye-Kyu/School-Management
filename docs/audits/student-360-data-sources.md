# Student 360 Data Sources Audit

**Scope:** Bucket 1, PR 4a, Phase 1 — audit the behavior, attendance, academic, safety-report, and (if it exists) health-log subsystems to determine feasibility and the right implementation approach for a read-only "Student 360" pastoral-care aggregation view, before any implementation begins.

**Status:** Phase 1 (audit) complete. **No code changes in this PR.** Awaiting explicit review/go-ahead before Phase 2 implementation starts, per the task's own instruction.

## Summary

| Area | Finding |
|---|---|
| Behavior points | `behaviour_points` — no balance column anywhere; summed fresh in 3 independent places today. **SELECT RLS is blanket school-scope only** (any role, any student) — role-narrowing exists only inside `BehaviourService`'s app code |
| Behavior incident reports | A second, structurally different table (`behavior_incident_reports`, prefect-submitted, PENDING/REVIEWED/DISMISSED) — semantically distinct from the points ledger, no shared shape |
| Attendance | `attendance_records`, properly role-scoped RLS. **No shared attendance-rate helper exists** — 9+ call sites compute it ad hoc, and inconsistently (some count LATE as present, some don't) |
| Approved absences | A **read-time overlay**, not a written status — `absence_requests` approval never touches `attendance_records`. Reading the raw table without replicating the overlay undercounts EXCUSED days |
| Academic | `assessments`/`grades` shape confirmed live (post-drift-fix). **No per-student term-average function exists anywhere** — only per-subject average. The report card's "overall average" is duplicated inline in two separate page components |
| Homework/quiz completeness | Grades are **not** uniformly in `grades` — only assessments a teacher explicitly linked (B1-2b). A complete picture needs `grades` + `homework_completions` + `quiz_attempts`, reconciled against `source_id` |
| Safety reports | **The task's assumed schema doesn't exist.** Two real tables, neither matching: `safety_tips` (anonymous, no `student_id` at all) and `behavior_incident_reports` (has `student_id`, but no severity, free-text category, and — the opposite of "anonymous" — a `NOT NULL` plain-FK reporter already shown by name to class teachers today) |
| Reporter-identity protection | **Does not exist today, at all.** Student 360's "never show reporter identity" requirement is a brand-new protection this PR adds, not a continuation of an existing anonymity mechanism |
| Health/injury logs | Confirmed does not exist. No prior audit or backlog document in this repo traceably flags it as a known gap either |
| Class Teacher access | Strong, extremely well-established precedent (10+ existing migrations use the identical join shape) |
| Department Head access | **Meaningfully harder than assumed** — `subjects` has no relationship to `departments` at all; only `teachers.department_id` exists. Requires new two-hop join logic with no existing precedent |
| Caching precedent | `feed-cache.ts` — a plain module-singleton `Map` + TTL, already proven in production, directly reusable shape |
| Recommendation | Feasible as spec'd, with the corrections above. On-demand + 5-minute TTL cache, mirroring `feed-cache.ts` exactly |

---

## 1.1 Behavior data

### Backing tables

**`public.behaviour_points`** — the actual points ledger, created in `supabase/migrations/20260527000017_behaviour_safety.sql:5-15`, extended in `supabase/migrations/20260723000045_behaviour_leaderboard_columns.sql:12-15`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `school_id` | UUID | NOT NULL, FK → `schools(id)` |
| `student_id` | UUID | NOT NULL, FK → `students(id)` |
| `teacher_id` | UUID | NOT NULL, FK → `teachers(id)` |
| `category` | TEXT | NOT NULL, CHECK IN (`POSITIVE`, `NEGATIVE`) — polarity |
| `points` | INT | NOT NULL, default 1 — always positive magnitude; sign comes from `category` |
| `reason` | TEXT | NOT NULL, free text |
| `reason_category` | TEXT | added later, CHECK IN (`academic`, `attendance`, `citizenship`, `leadership`, `other`) — a *topic*, deliberately separate from `category`'s polarity (the later migration's own comment is explicit about this: polarity and topic are two different concepts, not one column) |
| `date` | DATE | NOT NULL, default `CURRENT_DATE` — the field used for date-windowing |
| `awarded_by_user_id` | UUID | added later, FK → `users(id)` |
| `class_context_id` | UUID | added later, FK → `classes(id)` |
| `created_at` | TIMESTAMPTZ | NOT NULL |

**There is no signed `points_delta` column.** The task's assumed shape (`points_delta`) has to be derived at query time: `category === 'NEGATIVE' ? -points : points`.

**No "current balance" column exists anywhere** — checked `students`' full column list (`20260522000001_init.sql:49-63`, plus every later `ALTER TABLE students`) — nothing tracks a running total. Balance is recomputed from scratch, independently, in three separate places today:
- `apps/api/src/behaviour/behaviour.service.ts` (`_compute`, the leaderboard's own summation) — sums signed `points` grouped by `student_id`, with a 60-second in-memory TTL cache local to that service.
- `apps/api/src/behaviour/behaviour.scheduler.ts` — a nightly cron that independently re-sums all `behaviour_points` for the current term to award "Best Student."
- `apps/web/app/(dashboard)/admin/behaviour/page.tsx` — a server component that sums `positiveTotal`/`negativeTotal` via a plain `.reduce()` over the last 100 fetched rows.

Student 360 needs its own summation too — there's no canonical total to just read, and none of the three existing summations is obviously "the" one to import (each serves a different window/purpose).

### A second, structurally different table exists

**`public.behavior_incident_reports`** (`supabase/migrations/20260725000062_behavior_incident_reports.sql:10-23`, verified directly) — a prefect-submitted report/triage queue, explicitly **not** part of the points ledger:

```sql
CREATE TABLE IF NOT EXISTS public.behavior_incident_reports (
  id, school_id,
  reported_by_user_id  UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  student_id            UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  category              TEXT NOT NULL,   -- free text, no CHECK constraint
  description           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','REVIEWED','DISMISSED')),
  reviewed_by_user_id, reviewed_at, class_teacher_notes,
  created_at, updated_at
);
```

The migration's own header comment states plainly: *"Never auto-converted into behaviour_points; a Class Teacher must review and explicitly decide."* This table has no `points_delta`-shaped data at all — it's a pending/reviewed/dismissed workflow queue, semantically an *unreviewed accusation*, not an *awarded consequence*.

**Open question for Phase 2, not resolved here**: does Student 360's "behavior" section aggregate only `behaviour_points` (the actual ledger), or does it also surface a count from this second table? The task's own requested response shape (`points_delta`, `category`, `incidents_this_term`) maps cleanly onto `behaviour_points` alone — this audit recommends **points-ledger-only by default**, since mixing in unreviewed/possibly-dismissed reports as "incidents" risks presenting unproven claims as settled fact in a tool whose whole design goal is "read at a glance." If pastoral staff want visibility into *pending* reports too, that's a legitimate but distinct ask worth a deliberate decision, not a silent inclusion.

### RLS — a real gap to flag

Current, live policy (re-issued in `supabase/migrations/20260721000024_module_enforcement_rls.sql:115-118`, superseding the original in `20260527000017_behaviour_safety.sql:58`, confirmed via direct grep — no other file touches `bp_select`):

```sql
CREATE POLICY "bp_select" ON public.behaviour_points FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'behaviour_tracking')
);
```

**This is blanket school-scope only** (plus a module-enabled flag) — no role or per-student narrowing at the database layer at all. Any authenticated user in the school — TEACHER, STUDENT, PARENT, regardless of relationship to the student in question — can `SELECT` any `behaviour_points` row directly. All the real narrowing (leaderboard capping, class-teacher-full-view-vs-others-ranked-only, self-rank for prefects) happens entirely inside `BehaviourService`'s application code, which itself uses the service-role (`supabase.admin`) client internally and does its own filtering before returning JSON.

**Direct implication for Student 360**: if the new aggregation queries `behaviour_points` via a plain RLS-respecting client, the *database* won't stop it from seeing every student's history — the endpoint's own `user_has_student_360_access()` check (gating the whole request, not a per-row filter) is what has to do that work here, same as `BehaviourService` already does for the leaderboard. This is a materially different trust model than attendance/grades below, where the RLS itself is already role-aware.

### Existing UI for context

`apps/web/app/(dashboard)/leaderboard/page.tsx` + `LeaderboardClient.tsx`, backed by `GET /behaviour/leaderboard`. Windows: `week` (ISO week)/`month`/`term` (current term's `start_date`)/`all`. Scopes: `school`/`class`/`grade`, role-gated. Ranking is a signed-total-per-student, with a `breakdown` map keyed by `reason_category`, rendered as `"+3 citizenship, -1 other"` plus a bold `"{total} pts"`. Top-3 medal emoji, capped list with a "Showing the top N" note. No trend-over-time chart exists — it's a point-in-time ranked list, recomputed from scratch per request, not a rolling delta. Useful precedent for terminology ("pts", category breakdown) but not for a UI pattern Student 360 should copy wholesale — the task's own "clinical and neutral" tone explicitly asks for the opposite of the leaderboard's medal-emoji styling.

---

## 1.2 Attendance data

### Schema

`public.attendance_records` (`supabase/migrations/20260522000001_init.sql:158-171`, enum at line 8):

```sql
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "marked_by_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);
```

One row per `(student_id, date)` (unique constraint `attendance_records_student_id_date_key`). Four statuses: `PRESENT`, `ABSENT`, `LATE`, `EXCUSED` — no "unmarked" state at the DB level; the absence of a row for a date means unmarked, not any particular status.

### No shared attendance-rate helper — a real, citable inconsistency

Searched `packages/types/src` (only Zod schemas for attendance exist — `AttendanceStatus`, `MarkAttendanceInput`, query schemas — no computation logic) and every `apps/api`/`apps/web` call site that computes a rate. **No shared helper exists.** At least 9 independent implementations exist, and they disagree with each other on whether `LATE` counts as "present":

| Counts LATE as present | Counts PRESENT only |
|---|---|
| `apps/api/src/ai/ai.controller.ts` | `apps/web/app/(dashboard)/student/page.tsx` |
| `apps/web/app/(dashboard)/admin/analytics/page.tsx` | `apps/web/app/(dashboard)/student/attendance/page.tsx` |
| `apps/web/app/(dashboard)/teacher/analytics/page.tsx` | `apps/web/app/(dashboard)/parent/page.tsx` |
| `apps/web/app/(dashboard)/student/analytics/page.tsx` | `apps/web/app/(dashboard)/parent/attendance/page.tsx` |
| | `apps/web/app/print/report-card/[studentId]/page.tsx` |

A third, new Student 360 formula would disagree with whichever half it doesn't match. **Recommendation: extract one shared helper (e.g. into `packages/types/src`, alongside `grading.ts`) as part of Phase 2, and have Student 360 use it** — rather than either picking a side silently or adding a fourth inconsistent formula. This is a real, pre-existing gap Student 360 surfaces, not created by it — worth fixing while touching this code, matching how prior PRs in this project have handled similar "found a real bug while building the actual feature" situations.

### Approved absences are a read-time overlay, not a status write — a real implementation constraint

`public.absence_requests` (`supabase/migrations/20260725000065_absence_requests.sql:16-32`) is a fully separate table: `student_id, requested_by_user_id, start_date, end_date, reason, status (PENDING/APPROVED/DENIED), reviewed_by_user_id, reviewed_at, denial_reason`.

**Approval never writes or updates any `attendance_records` row.** Confirmed directly in `apps/api/src/attendance/attendance.service.ts:82-94` (`_approvedAbsenceStudentIds`):

```ts
// Students in `studentIds` who have an APPROVED absence_requests row
// covering `date`. No attendance_records rows are ever written for these
// dates — the EXCUSED status is computed here, at read time, only.
private async _approvedAbsenceStudentIds(studentIds: string[], date: string): Promise<Set<string>> {
  const { data } = await this.supabase.admin
    .from('absence_requests')
    .select('student_id')
    .in('student_id', studentIds)
    .eq('status', 'APPROVED')
    .lte('start_date', date)
    .gte('end_date', date);
  return new Set((data ?? []).map((r) => r.student_id));
}
```

Used in `roster()` (`attendance.service.ts:55-69`) to overlay `{status: 'EXCUSED', note: 'Approved absence'}` for dates with no real row, and as a **write-blocking gate** in `mark()` (`:202-213`) — a teacher's attempt to mark a different status on a covered date/student is silently dropped and audit-logged as `absence.override_attempt`. Deliberately uses the service-role client, since `absence_requests` RLS doesn't grant every subject teacher SELECT on it (see RLS below).

**Direct implication for Student 360**: a naive `SELECT * FROM attendance_records WHERE student_id = X AND date BETWEEN term_start AND term_end` will **undercount `EXCUSED` days** for any approved parent absence that falls on a date with no underlying row. The aggregation needs its own term-range version of this overlay — `_approvedAbsenceStudentIds` as written only handles a single date (one `roster()` call = one day); a term-wide Student 360 query needs to merge real `attendance_records` rows with `absence_requests`-covered date ranges across the whole term without double-counting a day that has both. This is new logic to write, not a drop-in reuse of the existing function.

### RLS

`attendance_records_select` (`supabase/migrations/20260522000002_enable_rls.sql:256-273`) — genuinely role-scoped at the DB layer, a real contrast with behavior's blanket policy above: ADMIN sees all in-school; TEACHER sees only classes they have a `subject_assignments` row for; STUDENT sees only their own; PARENT sees only guardian-linked children's rows.

`absence_requests_select` (`20260725000065_absence_requests.sql:47-69`): ADMIN, the requesting parent, the student's Class Teacher, or **any subject teacher assigned to the student's current class** (broader than its own UPDATE policy, deliberately, so subject teachers can render the "Approved absence" badge in the roster).

---

## 1.3 Academic data (grades/assessments)

### Current live shape (verified against the full drift history, not just the original `CREATE TABLE`)

`assessments`' original migration (`20260527000012_gradebook.sql:39-52`) describes columns that **were never actually live** — `kind`, `weight`, `max_score`, `date`, `created_by_id` were dropped by `20260728000073_fix_assessments_schema_drift.sql:26-31` (a `prisma db push` had already built the real table with the correct shape before that migration ran; its own header comment explains this in detail). Verified directly:

```sql
-- 20260728000073_fix_assessments_schema_drift.sql:26-37
ALTER TABLE public.assessments
  DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS weight,
  DROP COLUMN IF EXISTS max_score, DROP COLUMN IF EXISTS date, DROP COLUMN IF EXISTS created_by_id;
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS max_marks INT,
  ADD COLUMN IF NOT EXISTS assessment_date DATE;
```

Plus `20260728000076_fix_assessments_term_id_drift.sql:24-30` (`term_id` now `NOT NULL`, `ON DELETE CASCADE`), `20260728000077_assessments_max_marks_positive.sql:18` (`CHECK (max_marks > 0)`), and `20260728000081_assessments_source_link.sql` (B1-2b: `source_type TEXT NOT NULL DEFAULT 'DIRECT' CHECK IN ('DIRECT','HOMEWORK','QUIZ')`, `source_id UUID NULL`).

**Current live `assessments` columns**: `id, school_id, term_id (NOT NULL), class_id (NOT NULL), subject_id (NOT NULL), teacher_id (NOT NULL), name (NOT NULL), description (nullable), max_marks (NOT NULL INT, CHECK >0), assessment_date (nullable), source_type (NOT NULL, default DIRECT), source_id (nullable), created_at, updated_at`.

`grades` (`20260527000012_gradebook.sql:54-66`) — confirmed **unchanged since creation** (grepped every migration for `ALTER TABLE public.grades`, only hit is the read-only-enforcement trigger from B1-2b, not a column change): `id, school_id, assessment_id (NOT NULL FK), student_id (NOT NULL FK), score (nullable NUMERIC(6,2)), comment, graded_by_id, graded_at, created_at, updated_at`. Unique on `(assessment_id, student_id)`.

### No per-student term-average function exists — the task's premise is wrong

`packages/types/src/grading.ts` (read in full) exports exactly three functions:
- `calculateSubjectAverage(scores: {score, maxMarks}[]): number | null` — unweighted mean of each assessment's own percentage, **per subject**.
- `assignLetterGrade(pct): 'A'|'B'|'C'|'D'|'E'`.
- `normalizeScore(sourceScore, sourceMaxScore, assessmentMaxMarks): number` — the B1-2b homework/quiz-to-gradebook projection formula.

**None of these compute a single student-wide "term average."** The module's own header comment confirms this was a deliberate, scoped fix for disagreeing *per-subject* averaging formulas across the app — it was never meant to solve "one number for the whole term." The report card's own overall average is computed independently, inline, in **two separate page components** (`apps/web/app/report-card/[studentId]/page.tsx` and `apps/web/app/print/report-card/[studentId]/page.tsx`) — each calls `calculateSubjectAverage` once per subject, then takes the mean of the subject averages. Student 360's `term_average_percentage` needs this pattern extracted into a real shared function (a natural, small addition to `grading.ts`) rather than assumed to already exist or written a third time inline.

### Homework/quiz grades are not uniformly in `grades`

Confirmed against `docs/audits/homework-quiz-gradebook-relationship.md` and the B1-2b service code directly: `HomeworkService.linkToGradebook()`/`QuizzesService.linkToGradebook()` are explicit, teacher-or-admin-triggered opt-in actions. Only once a homework/quiz is linked does grading it cascade into a `grades` row (via `write_linked_grade()`). **Before that link exists, `homework_completions.score` and `quiz_attempts.score` have zero FK/join to `assessments`/`grades` at all.**

**Direct implication**: "this student's grades this term" cannot be answered from `grades` alone. A complete picture needs `grades` **plus** separately querying `homework_completions.score` and `quiz_attempts.score`, filtered to non-null (graded) rows, and **reconciled against `assessments.source_id`** so an already-linked homework/quiz's score isn't double-counted (once via its cascaded `grades` row, once via the raw source table). This is a first-class design constraint for the aggregation service, not an edge case to handle later.

### RLS

Tightened in `supabase/migrations/20260724000054_tighten_gradebook_rls.sql` (verified in full directly — the file's own header comment documents that the *original* policies were school-wide only, a real pre-existing vulnerability fixed in that PR). Current `assess_select`/`grade_select` (`:28-49`, `:74-99`): ADMIN sees all; TEACHER sees classes they're class-teacher of or have a `subject_assignments` row for; STUDENT sees only their own class's/own rows; PARENT sees only guardian-linked students'.

`class_average_scores(p_assessment_ids uuid[])` (`:138-152`) — a `SECURITY DEFINER STABLE` SQL function returning only `(assessment_id, avg_score, student_count)`, `REVOKE ALL FROM PUBLIC; GRANT TO authenticated`. This is the established, directly-reusable precedent in this codebase for "expose an aggregate, never raw per-student rows" — the exact shape Student 360's safety-report counts (§1.4) should mirror.

---

## 1.4 Safety reports

**The task's assumed schema — a table with `subject_student_id`, `reporter_id` (nullable/hashed/encrypted), a category/severity enum, and `term_id` — does not exist.** Two real, structurally different tables exist instead, verified directly against `supabase/migrations/20260527000017_behaviour_safety.sql` and `20260725000062_behavior_incident_reports.sql`.

### `public.safety_tips` — anonymous, but has no student association at all

```sql
-- No student_id stored — anonymous by design
CREATE TABLE IF NOT EXISTS public.safety_tips (
  id, school_id,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEWED','ACTIONED')),
  reviewed_by_id, reviewed_at, created_at
);
```

No `student_id`, no reporter column of any kind (not nullable, not hashed — simply absent), no severity, no term. **This table cannot be "a safety report about a student"** — it's a school-wide anonymous tip line with no per-student link whatsoever. RLS: `st_insert` allows anyone (`WITH CHECK (true)`); `st_select`/`st_update` are ADMIN-only.

### `public.behavior_incident_reports` — the real per-student table, but not anonymous

```sql
CREATE TABLE IF NOT EXISTS public.behavior_incident_reports (
  id, school_id,
  reported_by_user_id  UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  student_id            UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  category              TEXT NOT NULL,          -- free text, NO CHECK/enum
  description           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','REVIEWED','DISMISSED')),
  reviewed_by_user_id, reviewed_at, class_teacher_notes, created_at, updated_at
);
```
(verified directly, full file read)

Differences from the task's assumptions:
- **No `severity` column.**
- **`category` has no CHECK constraint** — free `TEXT`. Any category-breakdown logic in Student 360 (`count_by_category`) cannot assume a fixed value set; it should group by whatever distinct strings exist, not validate against an enum that doesn't exist at the DB level.
- **`reported_by_user_id` is `NOT NULL`, a plain FK to `users(id)` — not anonymous, not hashed, not encrypted.** This is the direct opposite of the task's framing.
- **No `term_id`** — only `created_at`/`updated_at`. Term-scoping requires deriving the term from `created_at` against `terms.start_date`/`end_date`, the same pattern already used elsewhere in this codebase for date-only-scoped tables (e.g. homework/quiz term inference in B1-2b).

### Reporter identity has zero protection today — this is new ground, not reused ground

RLS (`bir_select`, verified directly, full text above in the raw migration read): visible to `ADMIN`, the reporter themself, or the reported student's Class Teacher. **Confirmed at the application layer that eligible viewers see the reporter's name plainly**: `apps/web/app/(dashboard)/teacher/behavior-incidents/BehaviorIncidentsClient.tsx` renders `Reported by {report.reported_by?.full_name ?? '—'}` directly to the reviewing class teacher, sourced from a plain `reported_by:users!reported_by_user_id(full_name)` join in the page's own select. There is no masking view, no column-level RLS, no `SECURITY DEFINER` function hiding this column from anyone eligible to see the row at all.

**This means Student 360's "never expose reporter identity" requirement is a brand-new protection this PR is adding, not a continuation of an existing anonymity mechanism.** The task's own §1.4 questions ("what's the anonymity model? nullable/hashed/encrypted?") presuppose something that doesn't exist in this codebase — worth stating plainly rather than describing a model that isn't there. The right precedent to newly apply is `class_average_scores()`'s shape (§1.3): a `SECURITY DEFINER` function that returns only `(category, count)`, with reporter identity and `description` never selected in the first place, by construction — not RLS trying to hide a column from a query that could otherwise select it.

### Existing UI

`apps/web/app/(dashboard)/admin/safety-tips/page.tsx` — admin-only list for the anonymous, student-less `safety_tips`. `apps/web/app/(dashboard)/teacher/behavior-incidents/page.tsx` — the real per-student incident UI, RLS-scoped to the requesting teacher's visible rows, shows student name, category, description, reporter name, status. Nothing today aggregates safety-report counts per student across time — this confirms Student 360's safety section is new surface area, not a duplicate of an existing rollup.

---

## 1.5 Health / injury logs

**Confirmed does not exist.** Grepped `supabase/migrations` and `apps/api/src` case-insensitively for `health|injury|clinic|medical|nurse`: every "health" hit is either the infrastructure `system-health` module (DB-reachability/auth-count checks — nothing student-medical, see `docs/phase-0/04-nemis-and-hardening.md:35-36`) or unrelated coincidental substring matches. No table, no module, no UI for student health/injury/clinic/medical records exists anywhere.

**The task's claim that "the critique months ago flagged it as missing" is not traceable to anything in this codebase's own history.** Searched `docs/audits/*`, `docs/phase-0/*`, `docs/phase-1/00-backlog.md`, and `EXECUTION_PLAN.md` for any prior mention — found none. This is stated factually rather than as a correction of the task (the critique may exist outside this repo's own documentation, in a conversation or document this audit has no access to) — but from this codebase's own record, health-log tracking is a fresh gap, not a previously-scoped and now-revisited one.

**Recommendation: Student 360 will not include health data in this PR.** Add "student health/injury log module" to `docs/phase-1/00-backlog.md` as a new item in Phase 2's documentation task.

---

## 1.6 Existing data that shouldn't be in Student 360

- **Fee balance** (`fee_balances` table) — parent/financial concern, not pastoral. Confirmed as explicitly out of scope per the task; no further audit needed since the task's exclusion list is already definitive here.
- **Guardian contact information** — Student 360 is about the student, not their guardians; including phone/email/address would be scope creep into a different concern (and a different privacy boundary — guardians have their own consent expectations distinct from the student's).
- **Individual `behavior_incident_reports.description` and `reported_by_user_id`** — per §1.4, counts only, never contents or identity, and this needs new protection since none exists today.
- **`behavior_incident_reports.class_teacher_notes`** — a class teacher's own private review notes on a specific incident; even further into "not pastoral-summary material" than the report's own description.
- **Any homework/quiz *submission content*** (`homework_completions`, `quiz_attempts.answers`) — Student 360 needs only the *score*, not what the student actually answered; pulling submission content would be a second, unrelated privacy surface with no reason to be in a pastoral-care summary.
- **`students.enrollment_date`, `date_of_birth`, `gender`** and other pure demographic/administrative fields — available already via the student's own record; not "how is this child doing right now" material, and duplicating them here adds surface area for no benefit.
- **Payment/paybill records, message/conversation content** — not academic, attendance, behavior, or safety; clearly out of scope, no ambiguity.

---

## 1.7 Cross-source performance considerations

### Estimated row volume per student per term

| Source | Rough per-student-per-term volume |
|---|---|
| `assessments`/`grades` | 5–20 assessments per subject-load (a handful of subjects × a few assessments each), same order of magnitude of `grades` rows |
| `homework_completions`/`quiz_attempts` | Similar order of magnitude, only relevant for graded (non-null-score) rows |
| `attendance_records` | Up to one row per school day in the term (roughly 60–100 for a typical term), plus 0–a few `absence_requests` rows to overlay |
| `behaviour_points` | Typically low — 0–20 for most students, occasionally more for a student with a lot of pastoral activity |
| `behavior_incident_reports` | Typically very low — most students will have zero |

Total: on the order of **100–250 rows read across 5–6 distinct queries** per Student 360 view. This is small by any standard — no join produces a cross-product risk (each query is independently filtered to one student, one term), and every table involved already has `student_id`/`school_id` indexes from its own RLS-driving needs (confirmed for `behaviour_points` — `bp_student_idx (student_id, date DESC)` — and implicitly present via FK+RLS patterns on the others).

### Risk assessment

No obvious N+1 risk *if* the aggregation issues one batched query per source table (not one query per assessment/incident/etc.) — this is the natural way to write it given each source is independently filterable by `student_id` + a term/date range. The one piece of genuinely new query complexity is the attendance term-range overlay (§1.2) — merging real rows with `absence_requests` date ranges across a whole term, rather than a single date — but this is still a bounded, small-N operation, not a performance risk at this data scale.

### Recommendation: on-demand + short TTL cache, not a materialized view

Given the row counts above, **on-demand aggregation per request, with a short TTL cache to absorb repeat views of the same student within a short window, is the right strategy** — a materialized view or precomputation pipeline would be solving a scale problem this app doesn't have. This matches the task's own stated preference.

`apps/api/src/notifications-aggregation/feed-cache.ts` (verified in full) is the established, already-production-proven precedent to mirror exactly: a plain module-level `Map<key, {expiresAt, data}>`, a `TTL_MS` constant, and exported `getCached*/setCached*/invalidate*` functions imported directly (not DI'd) by any service whose writes should invalidate an entry — its own header comment explains why (single-instance deployment, no Redis/Upstash configured, avoiding a circular-module-dependency risk from DI-injecting back into the aggregation service). A Student 360 cache should use this identical shape with `TTL_MS = 300_000` (5 minutes, per the task) and a key of `student-360:{studentId}:{termId}`. Given the task's own explicit "TTL-based expiry only, invalidation as a follow-up if needed" framing, no invalidation hooks are required for this PR — consistent with `feed-cache.ts`'s own design allowing either.

---

## 1.8 Recommendation

**Feasible as spec'd, with three corrections the reviewer should explicitly sign off on before Phase 2 starts** — not silently resolved by this audit, since each is a real design decision, not a mechanical fix:

1. **Term-average and homework/quiz completeness need new code, not reuse of something that already exists.** `packages/types/src/grading.ts` needs a new per-student aggregate function (built from its existing `calculateSubjectAverage`, following the same pattern the report-card pages already use inline). The academic aggregation must query `grades` **and** `homework_completions`/`quiz_attempts`, reconciled against `assessments.source_id`, to be a complete picture — querying `grades` alone will silently omit any not-yet-linked homework/quiz grades. Low risk, but real new work, not zero-cost as the task's phrasing implies.

2. **Safety-report privacy is a new protection this PR adds, not an existing model to preserve.** There is no current anonymity mechanism for `behavior_incident_reports` — reporter identity is fully visible to eligible viewers today. The `SECURITY DEFINER`-counts-only function (mirroring `class_average_scores()`) is the right design, and is *more* protective than anything that exists today, which is exactly what the task wants — but the reviewer should understand this is genuinely new ground, not "make sure a redaction still works," so it deserves the same scrutiny as any new security boundary, including a direct test that a crafted/creative query still can't retrieve `reported_by_user_id` or `description` through this path (per the task's own Task 6 privacy-specific test list).

3. **Department Head access is the highest-risk scope of the four, and needs new join logic with no existing precedent.** `subjects` has no relationship to `departments` at all — confirmed by grepping every migration for `department_id` (the only hit is `teachers.department_id`). The only existing "Department Head oversight" RLS pattern (`attendance_remark_requests`) stops at "a teacher in my department," never reaching through to arbitrary students. Student 360's `user_has_student_360_access()` needs a genuinely new two-hop path: dept → member teachers (`teachers.department_id`) → those teachers' `is_class_teacher_of`/`subject_assignments` rows → classes → students. This is implementable (the building blocks — `teachers.department_id`, `subject_assignments`, `is_class_teacher_of` — all exist), but it's new composition, not a mirror of something already proven at this shape, and should get proportionally more test coverage than the Class Teacher and Admin scopes (which are both trivial, well-precedented checks).

**Additional calibration point, not blocking**: whether Student 360's "behavior" section includes only `behaviour_points` (recommended default) or also a count from the pending `behavior_incident_reports` queue (§1.1) — a product decision, not a technical one.

**Caching/query strategy**: on-demand per-request aggregation + a 5-minute TTL cache mirroring `feed-cache.ts`'s exact shape (§1.7) — no materialized view or precomputation needed at this data scale.

**Gaps needing no further calibration** (already resolved by this audit, not open questions): health/injury logs don't exist and won't be included (§1.5, backlog item added in Phase 2's docs task); Class Teacher and Admin access are both low-risk, well-precedented checks; the attendance rate formula should use one new shared helper rather than either picking an existing inconsistent convention or adding a fourth one (§1.2).
