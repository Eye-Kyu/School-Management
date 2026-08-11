# Sample School Seed Script — Phase 1 Audit & Implementation Plan

**Scope:** produce a comprehensive schema audit and implementation plan for a Node script that seeds a realistic ~300-student Kenyan primary school (CBC) into the same Supabase project as production, under a clearly-labeled test school. **Phase 1 (this document) is audit only — no code, no migrations, no production writes.** Phase 2 implements against this plan after review.

**Status:** Phase 1 complete. Awaiting review before Phase 2 starts.

## Summary

| Area | Finding |
|---|---|
| Table naming | 3 of the task's assumed table names don't exist: `fee_structure` (real: `fee_balances`, no separate fee-schedule table), `class_subjects` (real: `subject_assignments`), `behavior_points_ledger` (real: `behaviour_points` — British spelling, inconsistent with `behavior_incident_reports`'s American spelling) |
| Fee/payment tables | Four real tables, not one: `fee_balances`, `payment_records` (manual), `payment_transactions` (Paystack), `payment_paybill_transactions` (M-Pesa reconciliation) |
| Departments | Link only to `teachers` (`teachers.department_id`) — no relationship to `subjects` at all |
| `grades.score <= max_marks` | **Not** DB-enforced (no CHECK, no trigger) for `DIRECT` assessments — self-imposed convention only |
| `homework_completions.score <= max_score` | **Is** DB-enforced via trigger `homework_grade_within_max_check` — hard constraint, seed data must respect it |
| Linked-assessment grades | A trigger (`grades_block_direct_edit_on_linked`) rejects any direct `grades` write for a `HOMEWORK`/`QUIZ`-sourced assessment, **even from a service-role client** — the seed script must either call the `write_linked_grade()`/`record_quiz_grade()` RPCs or set `app.grade_source='cascade'` first |
| `terms.is_current` | No DB-level single-current-term-per-school constraint — must replicate the app's own "clear then set" sequence |
| Approved absences | Never get an `attendance_records` row — the EXCUSED status is a read-time overlay computed from `absence_requests`. Seeding a row for an approved-absence date would misrepresent real app behavior |
| Script location/runner | No `apps/api/scripts/` directory exists yet. The established seed-script convention lives in `packages/db/prisma/seed.ts`, run via **`tsx`** (not `ts-node`, despite `ts-node` sitting unused as an `apps/api` devDependency) — `tsx` is not yet installed for `apps/api`, flagged as a new devDependency for Phase 2 |
| Storage | `documents` bucket is **private** (flipped from public in an earlier PR); only a service-role client or a short-lived signed URL can read/write it |
| PDF generation | `pdfkit` is already an `apps/api` dependency (`ReceiptPdfService`) — zero new dependencies needed for dummy document PDFs |
| Prefect infrastructure | Discovered, not in the task's own table list: a school created by direct INSERT (bypassing `SuperAdminService.createSchool()`) must also manually seed the 8 default `prefect_powers` rows, or prefect-gated features (leaderboard, behavior-incident reporting) are silently empty/broken for the whole demo school |
| Auth creation | Established pattern (all 11 e2e spec files, zero exceptions): `admin.auth.admin.createUser({email, password, email_confirm: true, user_metadata: {school_id, role}})`, followed by an explicit `users` upsert with `onConflict: 'auth_id'` — never rely on the DB trigger alone for row shape |
| Batch inserts | The only documented chunk-size ceiling anywhere in this codebase is **200 rows per `.insert()` call** (`nemis-export.e2e-spec.ts`) |
| CBC grade levels | `classes.grade_level` is a plain `INTEGER`, unconstrained by any curriculum table — recommend Grade 1–8 as integers 1–8, no PP1/PP2 special-casing needed |

---

## 1. Schema inventory

All tables live in schema `public`. Tenancy/RBAC helper functions referenced by RLS throughout: `current_user_id()`, `current_school_id()`, `current_user_role()`, `guardian_student_ids()` (`supabase/migrations/20260522000002_enable_rls.sql:16-44`, all `SECURITY DEFINER`). **The seed script uses the Supabase service-role client throughout, which bypasses RLS entirely** — RLS policies are noted below only where they reveal something the seed script must still respect for *other* reasons (a trigger that fires regardless of role, an FK, a CHECK), not because RLS itself blocks the script.

Order below is FK-dependency seed order — parents before children.

### 1.1 `schools`

- **Purpose:** the tenant root — one row, the test school itself.
- **Columns:** `id, name, slug (UNIQUE), phone, email, address, logo_url, timezone (default 'Africa/Nairobi'), status (default 'ACTIVE', CHECK IN ('ACTIVE','INACTIVE','SUSPENDED','ARCHIVED')), curriculum_id (FK → curricula, nullable), paybill_shortcode (nullable, unique-if-not-null), created_at, updated_at`.
- **Row count:** 1.
- **FKs/constraints:** `slug` UNIQUE; `curriculum_id → curricula(id) ON DELETE SET NULL` (optional — the platform-level KICD curriculum catalog; **not** enforced against `classes.grade_level` at all, see §4 and §11 correction on grade levels). No FK to itself (it's the root).
- **RLS:** SELECT own-school or SUPER_ADMIN; **no INSERT/UPDATE/DELETE policy exists at all** — only a service-role client can ever create a school row, by design.
- **Triggers:** none.
- **`school_id` column:** N/A (it IS the tenant column's target).
- **Source:** `supabase/migrations/20260522000001_init.sql:14-28`, `20260722000029_school_lifecycle.sql`, `20260722000033_curriculum.sql:33`, `20260727000069_schools_paybill_shortcode.sql`.

### 1.2 `terms`

- **Purpose:** one academic term, `is_current=true` on the one the whole seed's activity data is dated against.
- **Columns:** `id, school_id, name, start_date, end_date, is_current (default false), created_at`.
- **Row count:** 1 (current term only — historical terms are a nice-to-have, not required for the demo).
- **FKs/constraints:** `school_id → schools(id) ON DELETE CASCADE`; UNIQUE `(school_id, name)`.
- **RLS:** SELECT same-school; INSERT/UPDATE ADMIN-only, same-school.
- **Triggers:** none. **No DB constraint enforces "only one `is_current=true` per school"** — only a plain, non-unique index (`terms_school_id_is_current_idx`). The app enforces this with an explicit "clear, then set" two-statement sequence (`apps/api/src/terms/terms.service.ts:28-29, 61-65`). **The seed script must replicate this exact sequence**, even though there's only one term being created (defensive — in case the script is ever extended to seed a second/historical term later).
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260522000001_init.sql:128-138`.

### 1.3 `classes`

- **Purpose:** the 16 class/stream rows (8 grades × 2 streams).
- **Columns:** `id, school_id, name, grade_level (INTEGER, no CHECK), stream, is_active (default true), prefect_student_id (FK → students, nullable, legacy/superseded by class_prefects — do not populate), created_at, updated_at`.
- **Row count:** 16.
- **FKs/constraints:** `school_id → schools(id) ON DELETE CASCADE`; UNIQUE `(school_id, name)`.
- **RLS:** SELECT same-school; INSERT/UPDATE ADMIN-only, plus an additive class-teacher UPDATE policy for the prefect column (irrelevant to seeding).
- **Triggers:** none.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260522000001_init.sql:91-102`, `20260526000006_class_prefect.sql`.

### 1.4 `subjects`

- **Purpose:** the 12-subject school-wide catalog.
- **Columns:** `id, school_id, name, code, created_at, updated_at`.
- **Row count:** 12.
- **FKs/constraints:** `school_id → schools(id) ON DELETE CASCADE`; UNIQUE `(school_id, code)`.
- **RLS:** SELECT same-school; INSERT/UPDATE ADMIN-only.
- **Triggers:** none.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260522000001_init.sql:105-114`. (Not the same thing as `curriculum_subjects` — that's a separate, platform-level KICD reference table unrelated to a specific school's `subjects` rows.)

### 1.5 `subject_assignments` (the task's assumed `class_subjects` — confirmed that name doesn't exist anywhere)

- **Purpose:** the class↔subject↔teacher junction — one row per (class, subject) pairing, naming which teacher teaches it.
- **Columns:** `id, class_id, subject_id, teacher_id, created_at`.
- **Row count:** 148 (derived in §4 from the grade-level subject pattern — not a flat 12×16=192, since lower primary takes fewer subjects than upper primary).
- **FKs/constraints:** `class_id → classes(id) ON DELETE CASCADE`, `subject_id → subjects(id) ON DELETE CASCADE`, `teacher_id → teachers(id) ON DELETE CASCADE`; **UNIQUE `(class_id, subject_id)`** — exactly one teacher per class-subject pairing, DB-enforced.
- **RLS:** SELECT scoped via `class_id`'s school; INSERT/UPDATE/DELETE ADMIN-only.
- **Triggers:** none.
- **`school_id`:** **no column** — tenancy is transitive via `class_id → classes.school_id`.
- **Source:** `supabase/migrations/20260522000001_init.sql:117-125`.

### 1.6 `users` (all 4 roles seeded here: ADMIN, TEACHER, STUDENT, PARENT)

- **Purpose:** the application-level identity row paired 1:1 with a Supabase `auth.users` row (see §2).
- **Columns:** `id, school_id (nullable — only NULL for schoolless SUPER_ADMIN, irrelevant here), auth_id (UNIQUE), email, phone, full_name, role ("UserRole" enum: ADMIN/TEACHER/STUDENT/PARENT/SUPER_ADMIN), is_active (default true), last_login_at, avatar_url, platform_permissions (TEXT[], default '{}' — irrelevant to non-SUPER_ADMIN rows), created_at, updated_at, deleted_at`.
- **Row count:** 1 (admin) + 22 (teachers) + 300 (students) + ~400 (parents) = **~723**.
- **FKs/constraints:** `school_id → schools(id) ON DELETE CASCADE`; UNIQUE `auth_id`; UNIQUE `(school_id, email)`; UNIQUE `(school_id, phone)`.
- **RLS:** SELECT same-school or self; INSERT ADMIN-only same-school; UPDATE ADMIN-only or self. **No RLS policy allows a non-ADMIN, non-self INSERT of another role** — confirms the service-role client is required for bulk seeding across roles, not optional.
- **Triggers:** not on this table directly, but `handle_new_auth_user()` fires `AFTER INSERT ON auth.users` and auto-mirrors a `public.users` row — see §2 for why the seed script does its own explicit upsert anyway rather than depending on this.
- **`school_id`:** yes (nullable, but always set here).
- **Source:** `supabase/migrations/20260522000001_init.sql:31-46`, `20260721000025/26_super_admin_*.sql`, `20260722000028_platform_permissions.sql`, `20260723000051_users_update_self.sql`.

### 1.7 `teachers`

- **Purpose:** the 22 teacher role-rows, one per TEACHER `users` row.
- **Columns:** `id, school_id, user_id (UNIQUE — 1:1 with users), staff_no (NOT NULL, UNIQUE per school), is_class_teacher_of (nullable FK → classes, UNIQUE-if-not-null — one class teacher per class, DB-enforced), department (free-text legacy, leave null), department_id (FK → departments, nullable), quiet_hours_start (default 21), quiet_hours_end (default 7), created_at, updated_at`.
- **Row count:** 22.
- **FKs/constraints:** `school_id → schools(id) ON DELETE CASCADE`, `user_id → users(id) ON DELETE CASCADE` UNIQUE, `is_class_teacher_of → classes(id) ON DELETE SET NULL` with partial UNIQUE index `teachers_class_teacher_unique ON (is_class_teacher_of) WHERE is_class_teacher_of IS NOT NULL`, `department_id → departments(id) ON DELETE SET NULL`.
- **RLS:** SELECT same-school; INSERT/UPDATE ADMIN-only.
- **Triggers:** none directly.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260522000001_init.sql:66-76`, `20260526000005/11`, `20260723000041/42`.

### 1.8 `students`

- **Purpose:** the 300 student role-rows.
- **Columns:** `id, school_id, user_id (UNIQUE), admission_no (UNIQUE per school), date_of_birth, gender (free text, no CHECK), current_class_id (nullable FK → classes), enrollment_date (default now), is_active (default true), birth_certificate_no, upi_number, nationality, county, sub_county, special_needs_notes (6 NEMIS fields, all nullable — leave blank except `county`/`nationality` for realism), created_at, updated_at`.
- **Row count:** 300.
- **FKs/constraints:** `school_id → schools(id) ON DELETE CASCADE`, `user_id → users(id) ON DELETE CASCADE` UNIQUE, `current_class_id → classes(id) ON DELETE SET NULL`; UNIQUE `(school_id, admission_no)`.
- **RLS:** SELECT ADMIN/TEACHER unrestricted in-school, STUDENT self-only, PARENT via `guardian_student_ids()`; INSERT/UPDATE ADMIN-only.
- **Triggers:** none directly.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260522000001_init.sql:49-63`, `20260728000074_students_nemis_fields.sql`.

### 1.9 `guardians`

- **Purpose:** parent↔student links — a pure link table, **not** an embedded-info table (the parent's own name/email/phone live on their own `users` row).
- **Columns:** `id, user_id (FK → users, the PARENT's row), student_id (FK → students), relationship (free text, e.g. 'Mother'/'Father'/'Guardian'), is_primary (default false), created_at`.
- **Row count:** ~420-440 (300 students: ~60% with 1 guardian = 180 links, ~40% with 2 guardians = 240 links → 420 minimum; a small number of parents linked to 2-3 children each accounts for total unique parent users landing near 400 rather than higher — see §4).
- **FKs/constraints:** `user_id → users(id) ON DELETE CASCADE`, `student_id → students(id) ON DELETE CASCADE`; UNIQUE `(user_id, student_id)` — no duplicate link, but one parent CAN guardian multiple students and one student CAN have multiple guardians.
- **RLS:** SELECT ADMIN or the parent's own rows; **no TEACHER SELECT policy exists at all** (a deliberate, documented gap — teacher visibility into guardians goes through a separate `SECURITY DEFINER` function, not broadened RLS). INSERT/UPDATE ADMIN-only.
- **Triggers:** none.
- **`school_id`:** **no column** — transitive via `student_id → students.school_id`.
- **Source:** `supabase/migrations/20260522000001_init.sql:79-88`. Reference implementation for the 4-step parent-link sequence (auth user → users row → students row → guardians row): `packages/db/prisma/seed.ts:320-383`.

### 1.10 `departments`

- **Purpose:** 4 staff departments, teachers only (confirmed: **no relationship to `subjects` exists at all** — the task's "group teachers by department" is doable, "subjects by department" is not).
- **Columns:** `id, school_id, name, description, created_at, updated_at, deleted_at (soft delete), department_head_user_id (nullable FK → users)`.
- **Row count:** 4.
- **FKs/constraints:** `school_id → schools(id) ON DELETE CASCADE`; `department_head_user_id → users(id) ON DELETE SET NULL`.
- **RLS:** SELECT same-school (`deleted_at IS NULL` or caller is ADMIN); INSERT/UPDATE ADMIN-only; no DELETE policy (soft-delete via UPDATE only).
- **Triggers:** **none today** — a soft-delete cascade trigger was added then deliberately dropped (`20260723000048_fix_department_soft_delete_trigger.sql`, RLS-during-AFTER-trigger conflict) in favor of an explicit app-layer second statement. Irrelevant to seeding (nothing gets soft-deleted).
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260723000040/41_departments*.sql`, `20260725000063_department_head.sql`.

### 1.11 Class-teacher and department-head assignment (not separate tables — `UPDATE`s on §1.7/§1.10)

There is **no** separate `class_teachers` junction table, contrary to the task's assumption — "class teacher" is a single nullable column, `teachers.is_class_teacher_of`, set via `UPDATE teachers SET is_class_teacher_of = <classId> WHERE id = <teacherId>` after both rows exist. Same pattern for `departments.department_head_user_id`. Document as a seeding *step*, not a table.

### 1.12 `attendance_records`

- **Purpose:** ~60 school days × 300 students, minus approved-absence-covered dates (see the read-time-overlay correction below).
- **Columns:** `id, school_id, student_id, class_id, date, status ("AttendanceStatus" enum: PRESENT/ABSENT/LATE/EXCUSED), marked_by_id (FK → teachers, ON DELETE RESTRICT), note, created_at, updated_at`.
- **Row count:** ~17,820 (see §5 for the exact derivation).
- **FKs/constraints:** `school_id`/`student_id`/`class_id` all `ON DELETE CASCADE`; `marked_by_id → teachers(id) ON DELETE RESTRICT` (note: RESTRICT, not CASCADE); **UNIQUE `(student_id, date)`** — one row per student per day.
- **RLS:** tenant-scoped (policy text not needed for a service-role seed).
- **Triggers:** none.
- **`school_id`:** yes.
- **Critical correction:** approved absences (via `absence_requests`) **never** get an `attendance_records` row — `EXCUSED` is a pure read-time overlay computed by joining against `absence_requests WHERE status='APPROVED'` (`apps/api/src/attendance/attendance.service.ts`'s `_approvedAbsenceStudentIds`, and the shared `calculateAttendanceRate()` helper from the Foundation PR). **Do not seed any `attendance_records` row with `status='EXCUSED'`, and do not seed a row at all for a date covered by a seeded `absence_requests` range** — doing either would not match how the real app ever produces data, defeating the point of a "realistic" seed.
- **Source:** `supabase/migrations/20260522000001_init.sql:158-171` (enum at line 8).

### 1.13 `absence_requests`

- **Purpose:** the specific "student with 3 approved absences" demo case (§6), plus a handful of others.
- **Columns:** `id, school_id, student_id, requested_by_user_id (FK → users), start_date, end_date, reason, status (CHECK IN ('PENDING','APPROVED','DENIED'), default 'PENDING'), reviewed_by_user_id, reviewed_at, denial_reason, created_at, updated_at`.
- **Row count:** ~50-70 (covering the 1% of attendance-window student-days assigned as approved-absence, see §5; date ranges span multiple consecutive days per request, so row count is well below the raw day count).
- **FKs/constraints:** `school_id`/`student_id` `ON DELETE CASCADE`; `requested_by_user_id`/`reviewed_by_user_id → users(id)`; **CHECK `end_date >= start_date`**.
- **RLS:** INSERT requires caller be the requesting PARENT with a real `guardians` link (irrelevant — service-role bypasses); UPDATE (review) ADMIN or the student's Class Teacher only.
- **Triggers:** none.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260725000065_absence_requests.sql:16-32`.

### 1.14 `assessments`

- **Purpose:** one row per (class-subject-assignment × ~6 assessments/term). **Current live shape only** — the original `CREATE TABLE` in `20260527000012_gradebook.sql` describes columns that were dropped by a later drift-fix migration; do not use it as source of truth.
- **Columns (current):** `id, school_id, class_id, subject_id, term_id (NOT NULL), teacher_id (NOT NULL), name, description, max_marks (NOT NULL INT, CHECK > 0), assessment_date, source_type (NOT NULL, default 'DIRECT', CHECK IN ('DIRECT','HOMEWORK','QUIZ')), source_id (nullable), created_at`.
- **Row count:** ~888 (148 subject_assignments × 6 assessments each — see §5).
- **FKs/constraints:** `school_id`/`class_id`/`subject_id`/`teacher_id` all CASCADE; `term_id → terms(id) ON DELETE CASCADE`; `max_marks > 0`; partial UNIQUE `(source_type, source_id) WHERE source_type != 'DIRECT'` — one assessment per linked homework/quiz.
- **RLS:** tenant/role-scoped (service-role bypasses).
- **Triggers:** none on this table directly.
- **`school_id`:** yes.
- **Source:** `20260728000073_fix_assessments_schema_drift.sql`, `20260728000076_fix_assessments_term_id_drift.sql`, `20260728000077_assessments_max_marks_positive.sql`, `20260728000081_assessments_source_link.sql`.

### 1.15 `grades`

- **Purpose:** per-student scores against each assessment.
- **Columns:** `id, school_id, assessment_id, student_id, score (NUMERIC(6,2), nullable), comment, graded_by_id, graded_at, created_at, updated_at`.
- **Row count:** ~15,000 (see §5).
- **FKs/constraints:** `assessment_id`/`student_id`/`school_id` CASCADE, `graded_by_id → users(id) ON DELETE SET NULL`; **UNIQUE `(assessment_id, student_id)`**.
- **RLS:** tenant/role-scoped.
- **Triggers:** **`grades_block_direct_edit_on_linked`** (`BEFORE INSERT OR UPDATE`, function `check_linked_grade_direct_edit()`) — rejects the write if the target assessment's `source_type != 'DIRECT'` and the session var `app.grade_source` isn't `'cascade'`. **Fires for every caller including service-role.** The seed script's linked-homework/quiz demo cases (§6) must either call the `write_linked_grade()`/`record_quiz_grade()` RPCs, or explicitly run `SELECT set_config('app.grade_source','cascade',true);` in the same DB session immediately before the raw INSERT, computing the normalized score itself.
- **`school_id`:** yes.
- **No DB-level bound** ties `grades.score` to `assessments.max_marks` for `DIRECT` assessments — self-impose it for realism only.
- **Source:** `supabase/migrations/20260527000012_gradebook.sql:54-66`, `20260728000082_write_linked_grade.sql`.

### 1.16 `homework_assignments`

- **Purpose:** ~250 homework items across the term.
- **Columns:** `id, school_id, class_id, subject_id (nullable), teacher_id, title, description, due_date, created_at, updated_at, max_score (NUMERIC(6,2), nullable, CHECK IS NULL OR > 0)`.
- **Row count:** ~250 (see §5 for the corrected derivation — the task's flat "12 subjects × 10 weeks" formula doesn't map cleanly onto the real per-class schema).
- **FKs/constraints:** `school_id`/`class_id` CASCADE, `subject_id → subjects(id) ON DELETE SET NULL`, `teacher_id → teachers(id) ON DELETE CASCADE`.
- **RLS:** SELECT school-wide; INSERT/UPDATE/DELETE ADMIN/TEACHER only.
- **Triggers:** none on this table itself.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260526000008_events_homework.sql:26-37`, `20260728000078_homework_grading.sql:18-20`.

### 1.17 `homework_completions`

- **Purpose:** per-student completion + grading against each homework.
- **Columns:** `id, school_id, homework_id, student_id, completed_at (default now), score (nullable), grader_note, graded_at, graded_by_user_id`.
- **Row count:** ~3,500-4,000 (see §5).
- **FKs/constraints:** `school_id`/`homework_id`/`student_id` CASCADE; **UNIQUE `(homework_id, student_id)`**.
- **RLS:** SELECT school-wide; INSERT/DELETE STUDENT self-only (irrelevant); UPDATE (grading) ADMIN or the relevant TEACHER.
- **Triggers:** **`homework_grade_within_max_check`** (`BEFORE INSERT OR UPDATE`) — if `NEW.score IS NOT NULL` and the parent `homework_assignments.max_score` is set, rejects `NEW.score > max_score`. **This is a real, hard DB-level bound** (unlike `grades`) — every seeded completion score must respect its own homework's `max_score`.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260526000008_events_homework.sql:46-53`, `20260728000078_homework_grading.sql:22-59`.

### 1.18 `quizzes`, `quiz_questions`, `quiz_attempts`

- **Purpose:** ~20 quizzes total, mostly upper-primary, each with questions and student attempts.
- **`quizzes` columns:** `id, school_id, class_id, subject_id (nullable), term_id (nullable), created_by_id, title, time_limit_mins, is_published (default false), shuffle_questions/shuffle_options (default true), created_at, closes_at (nullable)`.
- **`quiz_questions` columns:** `id, quiz_id, school_id, position (default 0), kind (CHECK IN ('MCQ','SHORT_ANSWER')), body, options (JSONB), correct_option_id, points (default 1)`.
- **`quiz_attempts` columns:** `id, school_id, quiz_id, student_id, started_at, submitted_at (nullable), score, max_score, tab_blur_count (default 0), answers (JSONB, default '{}')`.
- **Row counts:** 20 quizzes, ~140 questions (~7/quiz), ~320 attempts (~85% attempt rate × avg class size).
- **FKs/constraints:** all CASCADE to `schools`/`classes`/`quizzes`/`students` as applicable; `quiz_attempts` UNIQUE `(quiz_id, student_id)` — one attempt per student per quiz.
- **RLS:** role/publish-state-scoped; module-gated (`module_enabled(school_id,'quizzes')` — the test school must have this module enabled, see §7).
- **Triggers:** none on any of the three directly.
- **`school_id`:** yes on all three.
- **Source:** `supabase/migrations/20260527000014_quizzes.sql:5-44`, `20260723000039_quiz_assignment_deadlines.sql`.

### 1.19 `behaviour_points` (British spelling — confirmed, this is the real name)

- **Purpose:** ~500 ledger entries, the points/consequences system.
- **Columns:** `id, school_id, student_id, teacher_id, category (CHECK IN ('POSITIVE','NEGATIVE')), points (INT, default 1), reason, date (default CURRENT_DATE), created_at, reason_category (nullable, CHECK IN ('academic','attendance','citizenship','leadership','other')), awarded_by_user_id, class_context_id`.
- **Row count:** ~500.
- **FKs/constraints:** `school_id`/`student_id`/`teacher_id` CASCADE; `awarded_by_user_id → users(id) ON DELETE SET NULL`; `class_context_id → classes(id) ON DELETE SET NULL`.
- **RLS:** SELECT is **blanket school-scope only** — no per-role/per-student narrowing at the DB layer at all (all real narrowing happens in `BehaviourService`'s app code) — irrelevant to a service-role seed, noted for completeness since it's an unusual RLS shape relative to every other table here.
- **Triggers:** none.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260527000017_behaviour_safety.sql:5-16`, `20260723000045_behaviour_leaderboard_columns.sql`.

### 1.20 `behavior_incident_reports` (American spelling — confirmed, inconsistent with §1.19)

- **Purpose:** ~50 reports across ~30 students, the "concerns raised" (not "actions taken") side of behavior data.
- **Columns:** `id, school_id, reported_by_user_id (FK → users), student_id, category (free text, no CHECK), description, status (CHECK IN ('PENDING','REVIEWED','DISMISSED'), default 'PENDING'), reviewed_by_user_id, reviewed_at, class_teacher_notes, created_at, updated_at`.
- **Row count:** ~50.
- **FKs/constraints:** `school_id`/`student_id` CASCADE, `reported_by_user_id → users(id) ON DELETE CASCADE`, `reviewed_by_user_id → users(id) ON DELETE SET NULL`.
- **RLS:** INSERT requires the caller be a STUDENT holding an active `class_prefects`/`school_prefects` row with the `report_behavior_incident` power (irrelevant to service-role seeding, but see the realism note in §6/§7 addendum: `reported_by_user_id` should still point at a genuinely seeded student-prefect for the data to make sense on screen).
- **Triggers:** none. Never auto-converts into `behaviour_points` — the two tables are deliberately unlinked at the DB level.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260725000062_behavior_incident_reports.sql:10-23`.

### 1.21 Also needed, discovered during audit — prefect infrastructure

Not in the task's own table list, but load-bearing: `prefect_powers` (8 default rows per school — `view_class_behavior_leaderboard`, `compose_message_to_class_teacher`, `report_behavior_incident`, `view_class_attendance_summary`, `view_class_timetable_detailed`, `view_school_behavior_leaderboard_full`, `compose_message_to_admin`, `report_behavior_incident_school_wide`), `class_prefects`, `school_prefects`. Real schools get these 8 default rows automatically via `SuperAdminService.createSchool()`; a seed script that inserts a `schools` row directly (bypassing that service, exactly like `cross-tenant.e2e-spec.ts`'s own fixture does — see `apps/api/test/cross-tenant.e2e-spec.ts:141-156` for the exact 8-row insert to copy) **must replicate this seed itself**, or the leaderboard and behavior-incident-reporting features render empty/broken for the whole demo school regardless of how much `behaviour_points`/`behavior_incident_reports` data exists. Recommend seeding the 8 `prefect_powers` rows (required) plus one `class_prefects` row for 4-6 of the 16 classes (optional, for demo variety — not required for data correctness). Source: `supabase/migrations/20260725000059/60/61_*prefects*.sql`.

### 1.22 Fee/payment tables — 4 real tables, not the task's assumed `fee_structure`/`fee_balances`/`payment_records`/`payment_transactions`

- **`fee_balances`** — the per-student-per-term balance itself; there is no separate "fee structure/schedule" table, this row *is* the structure. Columns: `id, school_id, student_id, term_id (nullable, no FK — app-enforced only), amount_due, amount_paid (default 0), currency (default 'KES'), notes, as_of_date, created_at, updated_at`. Row count: 300 (one per student for the current term). FKs: `school_id`/`student_id` CASCADE. RLS: SELECT ADMIN/parent-of-student/self; INSERT/UPDATE ADMIN-only. No triggers.
- **`payment_records`** — manual/cash payments. Columns: `id, school_id, fee_balance_id, student_id, amount, payment_method, reference_no, paid_date, recorded_by_id, notes, created_at`. RLS: INSERT same-school ADMIN only; **no UPDATE policy at all** (append-only from RLS's perspective, irrelevant to service-role).
- **`payment_transactions`** — Paystack online payments. Columns: `id, school_id, student_id, parent_user_id, fee_balance_id (nullable), provider (default 'PAYSTACK'), reference (UNIQUE), amount, currency, status (CHECK IN ('PENDING','SUCCESS','FAILED','ABANDONED')), provider_payload, receipt_sent_at, created_at, updated_at`.
- **`payment_paybill_transactions`** — the M-Pesa reconciliation table (this is the one with the `UNMATCHED` status the task's Section 6 wants). Columns: `id, school_id (nullable — unattributed callbacks), mpesa_receipt_number (UNIQUE), transaction_type, transaction_time, amount, currency, msisdn, bill_reference_number, business_shortcode, reconciliation_status (CHECK IN ('PENDING','MATCHED','UNMATCHED','MANUALLY_MATCHED','REVERSED'), default 'PENDING'), matched_student_id, matched_fee_balance_id, matched_at, matched_by_user_id, reconciliation_notes, receipt_sent_at, raw_callback (JSONB NOT NULL), created_at, updated_at`. **No INSERT RLS policy at all** — every real row is written by `MpesaDarajaService` via service-role, so a seed-script insert (also service-role) is consistent with how this table is always populated in practice.
- **Row counts:** see §5.
- **Source:** `supabase/migrations/20260522000001_init.sql:174-188` (`fee_balances`), `20260526000007_payment_records.sql`, `20260529000019_payments.sql:5-21` (`payment_transactions`), `20260727000070_payment_paybill_transactions.sql`.

### 1.23 `documents` (+ Storage bucket)

- **Purpose:** ~30 documents across the 4 scope types.
- **Columns (current live shape):** `id, school_id, uploaded_by_id, title, file_name, file_size, mime_type, tags (TEXT[], default '{}'), created_at, scope_type (default 'SCHOOL_WIDE'), scope_subtype (nullable), scope_id (nullable, no FK — app-validated), storage_path, deleted_at, updated_at`. (Columns `audience`/`target_grade_level`/`target_class_id`/`file_url` were dropped in a prior PR — do not use them.)
- **Row count:** 30 (4 SCHOOL_WIDE + 4 CLASS + 4 SUBJECT + 18 ASSIGNMENT — see §6).
- **FKs/constraints:** `school_id`/`uploaded_by_id` CASCADE; CHECK `documents_scope_check` enforcing the valid `(scope_type, scope_subtype, scope_id)` combinations (`SCHOOL_WIDE` → both null; `CLASS`/`SUBJECT` → `scope_id` set, `scope_subtype` null; `ASSIGNMENT` → both set, `scope_subtype IN ('HOMEWORK','QUIZ','ONLINE_ASSIGNMENT')`).
- **RLS:** INSERT same-school ADMIN/TEACHER, module-gated (`document_library`).
- **Triggers:** none.
- **`school_id`:** yes.
- **Storage bucket:** id `documents`, **private** (flipped from public in a prior PR, all `authenticated`-role policies dropped). Only a service-role client or a signed URL can read/write it. Upload path convention (from `DocumentsService.upload()`, `apps/api/src/documents/documents.service.ts:62,71-73`): `${schoolId}/${randomUUID()}-${sanitizedFilename}`, `.storage.from('documents').upload(storagePath, buffer, {contentType, upsert:false})` via `this.supabase.admin`. Replicate this exact key shape.
- **Source:** `supabase/migrations/20260527000014_quizzes.sql:101-116` (original), `20260728000084/85/86/87_documents_*.sql` (current shape + privacy + downloads).

### 1.24 `conversations`, `messages`

- **`conversations` columns:** `id, school_id, parent_user_id (nullable), teacher_user_id (nullable), admin_user_id (nullable), student_id (nullable), last_message_body, last_message_at, parent_unread_count/teacher_unread_count/admin_unread_count (default 0), is_flagged (default false), created_at`. CHECK `conversations_party_shape_chk`: exactly 2 of the 3 party columns populated (parent↔teacher, admin↔teacher, or admin↔parent — never parent↔admin↔teacher all three, never a lone party). Unique composite index prevents duplicate conversations for the same party/student combination.
- **`messages` columns:** `id, school_id, conversation_id, sender_id, body (CHECK 1-2000 chars), is_flagged (default false), read_at, created_at, bypass_quiet_hours (default false)`.
- **Row counts:** ~15 conversations, ~80-100 messages (see §5).
- **Triggers:** `conversations_reject_student` (`BEFORE INSERT OR UPDATE`) — raises an exception if any party column resolves to a STUDENT-role user, **regardless of caller/role, including service-role**. The seed script must never attempt a student-party conversation.
- **`school_id`:** yes on both.
- **Source:** `supabase/migrations/20260527000011_messaging.sql`, `20260723000038_admin_teacher_messaging.sql`.

### 1.25 `notifications`

- **Purpose:** a small, illustrative set — not a full simulated history.
- **Columns:** `id, school_id, recipient_id, type (free text, no DB enum/CHECK), title, body, metadata (JSONB), is_read (default false), email_sent_at, sms_sent_at, created_at, deliver_after, acknowledged_at, error_message, sms_status (CHECK IN ('PENDING','SENDING','SENT','ABANDONED','SKIPPED_LEGACY_STUB'), default 'PENDING'), sms_send_attempts (default 0)`.
- **Row count:** ~30-50.
- **RLS:** **no INSERT policy at all** — every real row is written via service-role by `NotificationsService`, consistent with a seed-script insert.
- **Triggers:** none.
- **`school_id`:** yes.
- **Source:** `supabase/migrations/20260526000009_notifications.sql`, plus 4 later ALTERs adding `deliver_after`/`acknowledged_at`/`error_message`/`sms_status`.

### Explicitly not seeded (per the task's own instruction, confirmed still correct)

`audit_logs` (system-generated), `_migration_log` (system table), `auth.users` direct inserts (must go through `auth.admin.createUser`, see §2), health data (confirmed does not exist anywhere in this codebase, `docs/audits/student-360-data-sources.md` §1.5), payroll (confirmed does not exist).

---

## 2. Auth user creation strategy

### Established pattern (identical across all 11 e2e spec files, zero exceptions)

```ts
const { data: authData, error: authErr } = await admin.auth.admin.createUser({
  email, password, email_confirm: true, user_metadata: { school_id: schoolId, role },
});
if (authErr) throw new Error(`Auth user create failed: ${authErr.message}`);

await admin.from('users').upsert(
  { id: randomUUID(), school_id: schoolId, auth_id: authData.user.id, email, full_name, role, updated_at: new Date().toISOString() },
  { onConflict: 'auth_id' },
);
```
(`apps/api/test/student-360.e2e-spec.ts:47-56`, verified identical in `notifications-sms.e2e-spec.ts:48-61` and every other spec file.)

- `email_confirm: true` is used everywhere — no test user needs email verification or magic-link confirmation. **This seed script should do the same** — no student/parent/teacher needs to click a confirmation link.
- `phone` is **never** passed to `createUser()` itself — only set on the follow-up `users` row.
- `user_metadata: {school_id, role}` feeds the `handle_new_auth_user()` DB trigger, which auto-mirrors a `public.users` row — but **every e2e fixture still does its own explicit upsert afterward** with `onConflict: 'auth_id'`, treating the trigger's row as best-effort/optional rather than depending on its exact shape. The seed script should do the same: pass `user_metadata` for realism/trigger-compatibility, but never assume the trigger's row is complete — always upsert explicitly right after.

### Passwords and emails

- **Documented test password**, one shared value for every seeded user (ADMIN/TEACHER/PARENT/STUDENT alike) — e.g. `TestPass2026!` — printed prominently by the seed script's own summary output (§7) so a reviewer never has to grep source for it.
- **Emails**: `@example.com` (an IANA-reserved domain, guaranteed never to route anywhere real) — e.g. `jane.wanjiku.t1@example.com` for a teacher, `john.kamau.s042@example.com` for student #42. Never a real domain.
- **Phone numbers**: `+254799` prefix (a documented "reserved for testing" range this codebase should adopt — it's outside Safaricom's real allocated ranges (070x/071x/072x/074x/079x-Airtel etc. vary), so `+254799XXXXXX` cannot reach a real subscriber). Sequential/deterministic suffixes per user for reproducibility across re-seeds.

### Volume and parallelization

~723 total `createUser` calls (1 admin + 22 teachers + 300 students + ~400 parents). Supabase's Admin Auth API has no publicly documented hard rate limit for a project at this tier, but unbounded `Promise.all(723 calls)` risks transient failures under real network conditions regardless. **Recommend a bounded concurrency of ~10 simultaneous `createUser` calls** (a simple `for` loop over chunks of 10, `await Promise.all(chunk)` per chunk — no new dependency needed for this, plain `Array.prototype.slice` chunking suffices), with a retry-once-on-transient-failure wrapper. Flag this concurrency figure as worth confirming/tuning empirically on Phase 2's first real run against the actual project — this is inherently untestable from an audit alone.

---

## 3. Realistic data generation — `apps/api/scripts/lib/kenyan-names.ts`

Recommend a single constants-only file (no logic), matching the task's own suggested split — keeps the reference data trivially reusable if a second seed variant is ever wanted, and keeps the main orchestrator script free of giant literal arrays.

**Contents (illustrative excerpt — full lists populated in Phase 2, sourced from well-known common Kenyan given/surnames spanning the requested ethnic groups, no attribution needed since these are common names, not copied from any specific individual or dataset):**

- `FIRST_NAMES_MALE` / `FIRST_NAMES_FEMALE` / `FIRST_NAMES_UNISEX` (~20 each spanning Kikuyu — Njoroge, Wanjiku, Kamau; Luo — Otieno, Achieng, Owino; Luhya — Wafula, Nekesa, Simiyu; Kamba — Mutua, Mwikali, Musyoka; Kalenjin — Kiprotich, Chebet, Kiplagat; Meru — Mutuma, Kanana; Kisii — Nyabuto, Kemunto; Somali — Abdi, Halima; Coastal/Mijikenda — Baraka, Zawadi) — 40-60 total across genders.
- `SURNAMES` (~40-60, same ethnic spread — e.g. Kamau, Odhiambo, Wanyama, Kilonzo, Rotich, Mutwiri, Ondieki, Hassan, Mwangi).
- `NAIROBI_AREAS` (15-20: Kilimani, Riruta, Kasarani, Embakasi, Dagoretti, Kawangware, Umoja, Buruburu, Kayole, Ngara, Lang'ata, Roysambu, Ruaraka, Zimmerman, Kahawa, Githurai, Kariobangi, South B, South C, Karen).
- `SCHOOL_NAME_TEMPLATES` — always `TEST — ` prefixed: `TEST — Kilimani Primary School`, `TEST — Nyayo Academy Primary`, `TEST — Riruta Primary School` (pick one for the actual seed; keep 3-5 templates for re-seed variety if the teardown/re-seed cycle is ever used with a different name).
- `PHONE_PREFIX = '+254799'`.
- `TEST_EMAIL_DOMAIN = 'example.com'`.
- `TEST_PASSWORD = 'TestPass2026!'`.

Name generation combines first+surname independently at random (with the gender-appropriate first-name pool), which naturally produces some cross-ethnic-group combinations (e.g. a Kikuyu first name with a Luo surname) — realistic for intermarriage/name-choice diversity in an actual Kenyan school, not a bug to avoid.

---

## 4. School structure and enrollment

| Item | Value | Reasoning |
|---|---|---|
| School name | `TEST — Kilimani Primary School` | Clearly labeled per the fixed constraint; Nairobi-based |
| Grade levels | Grade 1–8, as integers 1-8 in `classes.grade_level` | `grade_level` is a plain unconstrained `INTEGER`; no PP1/PP2 pre-primary special-casing needed since nothing in the schema requires, rewards, or even represents it distinctly (see §11 correction) |
| Classes | 16 (8 grades × 2 streams, e.g. "Grade 3A"/"Grade 3B") | Matches the fixed constraint exactly |
| Students | 300, split 12 classes of 19 + 4 classes of 18 | 300 / 16 = 18.75 → 12×19 + 4×18 = 228+72 = 300 exactly |
| Subjects | 12: Mathematics, English, Kiswahili, Environmental Activities (G1-3 only), Science & Technology (G4-8 only), Social Studies (G4-8 only), Christian Religious Education, Agriculture (G4-8 only), Creative Arts, Physical & Health Education, Life Skills Education (G4-8 only), Home Science (G6-8 only) | A CBC-shaped split between lower-primary integrated subjects and upper-primary specialized subjects — not exhaustively curriculum-accurate, but demo-realistic and internally consistent |
| `subject_assignments` rows | 148 | Lower primary (G1-3, 6 classes × 7 subjects = 42) + mid primary (G4-5, 4 classes × 10 subjects = 40) + upper primary (G6-8, 6 classes × 11 subjects = 66) = 148 |
| Teachers | 22 | 16 class teachers (1 per class, each also subject-teaching 1-3 of the 148 assignments) + 6 specialist teachers (PE, Music, Home Science, Agriculture, Creative Arts, a floating CRE/Life Skills teacher) shared across many classes with no class-teacher duty. ~148/22 ≈ 6.7 assignments/teacher average |
| Departments | 4: Languages; Mathematics & Sciences; Humanities & Religious Education; Creative & Technical | Teacher-only grouping (§1.10) — one `department_head_user_id` per department, itself a teacher (naturally overlaps with a class-teacher role for the role-overlap demo case, §6) |
| Admin | 1 (headteacher) | Fixed constraint |
| Guardians | ~400 unique PARENT users, ~420-440 `guardians` link rows | 300 students: 180 single-guardian (60%) + 120 dual-guardian (40%) → 420 links minimum; ~15-20 parents linked to 2-3 children (siblings) brings unique parent-user count down to ~400 while keeping link count near 420-440 |

---

## 5. Activity data volume

| Type | Row count | Reasoning / correction from the task's own estimate |
|---|---|---|
| `attendance_records` | **~17,820** (not 18,000) | 300 students × 60 days = 18,000 (student,date) slots. Split: 92% PRESENT (16,560), 5% LATE (900), 2% unapproved ABSENT (360), **1% approved-absence (180 slots) — these get NO `attendance_records` row at all** (§1.12 correction), only a covering `absence_requests` range. Written rows = 16,560+900+360 = 17,820 |
| `absence_requests` | ~50-70 | The 180 approved-absence student-days grouped into multi-day requests (avg ~3 consecutive days each) rather than 180 single-day requests, spread across ~40-50 distinct students |
| `assessments` | ~888 | 148 `subject_assignments` × 6 assessments/term each (task's own "5-7 per subject" → using 6) — recalculated against the real per-class-subject structure rather than a flat 12-subjects-school-wide assumption |
| `grades` | ~15,000 | 888 assessments × ~18.75 avg class size × ~90% sit-rate (not every student sits every assessment, absences etc.) ≈ 14,985 |
| `homework_assignments` | ~250 | Task's own ~240 estimate kept close, but generated as 2/week × 8 weeks across a deliberately-curated rotating subset of the 84 "core-subject" class-subject pairings (Math/English/Kiswahili/CRE/Science&Tech/Social Studies) — not literally every pairing every week, which would be unrealistically dense for a seed |
| `homework_completions` | ~3,500-4,000 | 250 assignments × ~18.75 avg class size × ~75-80% avg completion rate (task's own 60-95% range, centered) |
| `quizzes` | 20 | Fixed constraint, mostly upper-primary |
| `quiz_questions` | ~140 | ~7 questions/quiz average |
| `quiz_attempts` | ~320 | 20 quizzes × ~18.75 avg class size × ~85% attempt rate |
| `behaviour_points` | ~500 | Fixed constraint. Distribution: ~60% POSITIVE/40% NEGATIVE, 1-5 points each. Not evenly spread — most students (≈220/300) get 0-3 entries, a smaller group (≈50-60) get 4-8 entries; the two named demo students (§6) get deliberately concentrated, correlated patterns |
| `behavior_incident_reports` | ~50 | Fixed constraint, across ~30 distinct students. `reported_by_user_id` set to genuinely-seeded student prefects (§1.21), not an arbitrary user, for on-screen realism |
| `prefect_powers` | 8 | Required (§1.21), not optional — a school created outside `SuperAdminService.createSchool()` starts with none |
| `class_prefects` | 4-6 | Optional, demo variety only — one prefect for a handful of classes, not all 16 |
| `fee_balances` | 300 | One per student, current term only. KES 15,000 each, per the fixed constraint |
| Payment rows (3 tables combined) | ~255 | 60% fully paid (180 students: split ~90 Paystack `SUCCESS` + ~70 Paybill `MATCHED` + ~20 manual `payment_records`), 25% partial (75 students: similar 3-way split, ~30/30/15), 15% unpaid (45 students: zero payment rows) = 180+75 = 255 payment rows total across the three tables |
| `documents` | 30 | 4 SCHOOL_WIDE + 4 CLASS + 4 SUBJECT + 18 ASSIGNMENT (task said "3-4"/"2-3"/"2-3"/"several" — rounded up the ASSIGNMENT bucket to give the linked-homework/linked-quiz demo cases and a few regular homework items each 1-2 attachments) |
| `conversations` | ~15 | Minimal, per the fixed constraint — a mix of all 3 valid party shapes (parent↔teacher, admin↔teacher, admin↔parent) |
| `messages` | ~80-100 | ~5-7 messages per conversation average |
| `notifications` | ~30-50 | Minimal, illustrative — a handful of each of `ABSENT_STUDENT`/`HOMEWORK_ASSIGNED`/`PAYMENT_RECEIVED`/`NEW_ANNOUNCEMENT`, not a full simulated history |

**Total row count across all tables: roughly 39,000-40,000** — dominated by `attendance_records` (~17,820) and `grades` (~15,000).

---

## 6. Demo-friendly patterns

Each case is tagged by a **deterministic seed-time index**, not random selection — re-running teardown+seed must produce the same demo script every time.

| Case | Identification | Implementation notes |
|---|---|---|
| **Declining student** (Student 360 case study) | Grade 6A, roster index 5 | Attendance: PRESENT-heavy first half of term, unapproved-ABSENT-heavy second half. Math + Science grades: high scores (75-85%) on early-term assessments, low (35-50%) on late-term ones in the *same* subjects. 2 `behaviour_points` NEGATIVE entries dated in the second half, correlated with the same window |
| **Star student** | Grade 6B, roster index 3 | Consistently PRESENT (>95% rate), top-quartile grades across nearly all subjects all term, 4-5 `behaviour_points` POSITIVE entries, zero NEGATIVE |
| **Linked homework** (B1-2b showcase) | Grade 5A/5B Mathematics homework, week 4 | Seeded with `homework_assignments.max_score` set; ~80% of the relevant class(es) graded via `homework_completions`; an `assessments` row with `source_type='HOMEWORK'`, `source_id` = that homework's id; grades cascaded via the `write_linked_grade()` RPC (or `set_config('app.grade_source','cascade',true)` + raw insert, per §1.15) — never a raw insert without that step, it will be rejected by the trigger |
| **Linked quiz** | Grade 7A/7B Science quiz | Same pattern via `record_quiz_grade(quiz_attempt_id)` — one RPC call per submitted attempt, quiz linked to an assessment with `source_type='QUIZ'` |
| **Parent with 2 children, different grades** | One parent linked to a Grade 2 and a Grade 7 student | Two `guardians` rows, same `user_id`, both `is_primary=true` on their respective links (no uniqueness conflict — `is_primary` isn't globally unique) |
| **Class teacher who's also a subject teacher elsewhere** | The Grade 3A class teacher also teaches Mathematics in Grade 4A and 4B | Natural consequence of the 22-teacher/148-assignment structure (§4) — no special casing needed beyond picking this one teacher's assignments deliberately during generation, so it's guaranteed to exist and be easy to point at in a demo, not just "probably somewhere in the data" |
| **Documents at each scope** | 4 SCHOOL_WIDE (handbook, holiday schedule, dress code, calendar), 4 CLASS (2 different classes), 4 SUBJECT (2-3 different subjects), 18 ASSIGNMENT (attached across the linked-homework/linked-quiz cases above plus several regular homework items) | Storage bytes via `pdfkit` (§8) |
| **Student with recent approved absences** (approved-absence overlay showcase) | Grade 4A, roster index 8 | 3 `absence_requests` rows, `status='APPROVED'`, spanning distinct short date ranges (1-2 days each) within the term, with correspondingly *no* `attendance_records` rows for those exact dates (§1.12) |
| **Unmatched Paybill payment** | One `payment_paybill_transactions` row | `reconciliation_status='UNMATCHED'`, `matched_student_id=NULL`, a `bill_reference_number` that doesn't match any seeded student's `admission_no` — deliberately, to simulate a real unattributed M-Pesa callback |
| **Student with outstanding arrears** | Grade 8A, roster index 1 | Part of the 15%-unpaid bucket (§5), `fee_balances.amount_paid=0` against the full `amount_due` |

---

## 7. Production safeguards

### Pre-run checks (script exits immediately if any fail)

1. **Test school already exists** — `SELECT id FROM schools WHERE name = '<exact test school name>'` via service-role; if found, exit with `"Test school already exists (id: <id>). Run teardown-sample-school.ts first."`
2. **`NODE_ENV==='production'`** requires both `--force` and `--confirm-production` flags; otherwise exit immediately, before any Supabase call.
3. **`--confirm` flag required** on every invocation, regardless of `NODE_ENV` — a bare `tsx scripts/seed-sample-school.ts` with no flags always exits with a usage message, never runs.
4. **Print target `SUPABASE_URL` prominently**, then `await new Promise(r => setTimeout(r, 5000))` before the first write — a deliberate 5-second Ctrl-C window.
5. **Blank-DB heuristic** — `SELECT count(*) FROM schools` via service-role; if `0`, print a warning ("this looks like an empty database — did you mean to point at a dev/staging project instead?") and require an *additional* explicit `--i-know-this-looks-empty` flag to proceed. (This check is a heuristic, not a guarantee — document it as such; it cannot distinguish "truly blank prod" from "a fresh dev DB," which is exactly why it demands one more explicit flag rather than blocking outright.)

### During-run safeguards

- **INSERT-only** — the seed script contains no `.update()`/`.delete()` calls against any pre-existing row, anywhere, except the two documented "clear then set" exceptions that are self-contained to rows the script itself just created in the same run (`terms.is_current`, §1.2; `teachers.is_class_teacher_of`/`departments.department_head_user_id`, §1.11).
- **Every insert scoped to the one `school_id`** created in step 1 of the run (or, for tables without a `school_id` column — `subject_assignments`, `guardians` — scoped transitively via a `class_id`/`student_id` that itself belongs to that school).
- **No real Postgres transaction wraps the whole run** — correcting the task's own literal wording here: Supabase's REST/PostgREST client has no multi-statement client-side transaction primitive (each `.insert()`/`.upsert()`/`.rpc()` call is its own independent HTTP request/DB transaction). "Wrap the entire seed in a single logical transaction" is implemented instead as: (a) the pre-run existence check (item 1) makes a from-scratch run always start from zero, (b) every step's failure mode is "print exactly how far it got + the test school's id, then exit non-zero," so a partial run is always resumable via **teardown, then re-seed** rather than needing rollback, and (c) the row counts/order in §1 mean a mid-run failure can never leave an orphaned row violating an FK (everything downstream of an unwritten parent simply never gets attempted).

### Post-run verification

- Print a per-table row-count summary (table name → rows inserted), matching the §1/§5 shape so a reviewer can sanity-check actual vs. planned.
- Print the test school's `id` and its exact name, plus a one-line "find it at `/super-admin/schools` search for '<name>'" pointer.
- Print the exact teardown command (`tsx scripts/teardown-sample-school.ts --confirm --school-id=<id>`) and the shared test password.

### Teardown script — `apps/api/scripts/teardown-sample-school.ts`

- Same `--confirm`/`NODE_ENV` safeguards as the seed script (items 2-3 above; items 1/4/5 don't apply the same way — teardown's own "does the school exist" check is inverted, see below).
- Resolves the test school by exact name (same constant as the seed script); if not found, **prints "Test school not found — nothing to tear down" and exits 0** (idempotent, per the task's own requirement).
- Deletes in strict reverse-FK order (mirroring §1's seed order backwards) — in practice, deleting the `schools` row itself and letting `ON DELETE CASCADE` handle every table in §1 that cascades from `school_id` is *not* sufficient by itself, because several tables key off `student_id`/`class_id`/`user_id` transitively (`guardians`, `subject_assignments`) or have `ON DELETE SET NULL`/`RESTRICT` FKs (`attendance_records.marked_by_id` is RESTRICT — teachers can't be deleted while they still have attendance rows marked, so `attendance_records` must be deleted *before* `teachers`, not left to cascade). Explicit per-table deletes in reverse order are safer and more auditable than relying on cascade alone, matching the precedent already established in every e2e spec file's own `afterAll` cleanup block.
- Deletes every `auth.users` row created for this school's users (`admin.auth.admin.deleteUser(id)` per id, parallelized — same reasoning as the Foundation PR's own `cross-tenant.e2e-spec.ts` cleanup fix, see `docs/bug-triage.md` if a similar sequential-loop timeout risk shows up here at ~723 users, likely worth parallelizing from the start rather than discovering the same timeout issue again).
- Deletes the Storage objects under the `documents` bucket's `${schoolId}/` prefix (list then bulk-remove) before deleting the `documents` rows.

---

## 8. Storage bucket content

**Recommend Option A — generate dummy PDFs at seed time via `pdfkit`.** Zero new dependencies: `pdfkit` (`^0.15.0`) is already an `apps/api` dependency, used by `ReceiptPdfService` (`apps/api/src/payments/receipt-pdf.service.ts`) for payment receipts. Reuse its exact pattern:

```ts
const doc = new PDFDocument({ size: 'A4', margin: 50 });
const chunks: Buffer[] = [];
doc.on('data', (chunk) => chunks.push(chunk));
const done = new Promise<Buffer>((resolve, reject) => {
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});
doc.fontSize(16).text(document.title, { align: 'center' });
doc.fontSize(11).text(`This is a sample document for ${schoolName} — placeholder content generated by the seed script.`);
doc.end();
const buffer = await done;
```
then upload via the same service-role `.storage.from('documents').upload(storagePath, buffer, {contentType: 'application/pdf', upsert: false})` call shape `DocumentsService.upload()` already uses (§1.23) — never Option B (committed sample files, adds repo bloat and licensing/provenance questions for zero benefit here) or Option C (no content — makes the seed's own documents feature demo literally non-functional, defeating the purpose of a demo-friendly seed).

---

## 9. Idempotency and re-runs

**Recommend Option A — single-run only.** Matches the task's own recommendation and the simplest possible safeguard shape (§7's existence check is the *entire* idempotency mechanism — no per-row upsert-or-skip logic needed anywhere else in the script, which also keeps the bulk-insert code paths simple arrays rather than existence-checked loops, important at this row volume for §10's runtime estimate). If fresh data is ever needed: `teardown-sample-school.ts` then re-run the seed. `packages/db/prisma/seed.ts`'s own existence-check-then-insert idiom is the right pattern for that *one* top-level "does the test school exist" gate — but applying it per-row across ~40,000 rows (Option B) would multiply the script's SELECT-then-INSERT round-trips severalfold for no real benefit, since the single top-level gate already makes accidental double-seeding impossible.

---

## 10. Estimated runtime and cost

- **Auth user creation** (~723 `createUser` calls at ~10 concurrent, each call realistically 200-500ms round-trip): ~723/10 × ~350ms ≈ **~25 seconds**, plus the paired `users` upsert per user (similar volume, can run concurrently with the *next* batch's auth calls rather than strictly serialized) — call it **~30-45 seconds** for all of §2 combined.
- **Bulk table inserts** (§1/§5, ~39,000-40,000 rows total, batched at the established 200-row-per-call ceiling from `nemis-export.e2e-spec.ts`): ~200 `.insert()` calls total across all tables at ~150-300ms each (smaller payloads than 723-user auth creation, no per-row external API call involved) ≈ **~40-60 seconds**.
- **Storage uploads** (30 PDFs via `pdfkit`, each generated near-instantly in-memory then uploaded): ~30 × ~300ms ≈ **~10 seconds**.
- **Total estimated wall-clock time: ~2-3 minutes** for a full from-scratch seed run. Order-of-magnitude only — the real number depends on Supabase project tier/region latency from wherever Phase 2 actually runs it, flagged as worth timing on the first real run rather than trusted as precise.
- **Rate limits:** no publicly documented hard ceiling found for Supabase Auth Admin API creation calls at this project's tier — the ~10-concurrent figure (§2) is a conservative default, not derived from a documented limit. Worth confirming empirically; if Phase 2's first run shows 429s/throttling, drop concurrency further rather than retry-storming.
- **Storage cost:** ~30 PDFs × a few KB each (short placeholder text, `pdfkit` output for a single page of text is typically 5-15KB) ≈ **well under 1MB total** — negligible, no cost concern.
- **N+1 avoidance:** every table in §1/§5 is inserted via batched-array `.insert()` calls (chunked at 200 rows where the table's row count exceeds that), never a per-row loop with an `await` inside — the one necessarily-per-row operation is auth user creation (§2, no batch endpoint exists in the Supabase Admin API), already addressed via bounded concurrency rather than serial awaiting.

---

## 11. Implementation plan for Phase 2

### Seed order (strict FK-dependency order, per §1)

`schools → terms → prefect_powers → classes → subjects → subject_assignments (after teachers exist — see note) → departments → auth users + public.users (all 4 roles) → teachers → students → guardians → is_class_teacher_of / department_head_user_id UPDATEs → class_prefects (optional) → attendance_records → absence_requests → assessments → grades (respecting the linked-assessment trigger) → homework_assignments → homework_completions → quizzes/quiz_questions/quiz_attempts → behaviour_points → behavior_incident_reports → fee_balances → payment_records/payment_transactions/payment_paybill_transactions → documents (+ Storage uploads) → conversations/messages → notifications`.

Note: `subject_assignments` needs both `classes`/`subjects` (available early) **and** `teachers` (available only after auth users are created) — so it's seeded *after* teachers, not immediately after `subjects`, despite appearing early in §1's inventory-ordering. The ordering above reflects actual runtime dependency, not §1's presentation order.

### Code structure

One orchestrator entrypoint, `apps/api/scripts/seed-sample-school.ts`, importing from a small set of per-cluster modules under `apps/api/scripts/lib/` — mirroring how the 3 audit agents naturally clustered the schema (a good proxy for genuine cohesion, not an arbitrary split):
- `lib/kenyan-names.ts` — reference data only (§3).
- `lib/seed-structure.ts` — school/terms/classes/subjects/subject_assignments/departments/prefect_powers.
- `lib/seed-people.ts` — auth users + users/teachers/students/guardians + class-teacher/department-head assignment.
- `lib/seed-academic.ts` — attendance_records/absence_requests/assessments/grades/homework/quizzes.
- `lib/seed-behavior.ts` — behaviour_points/behavior_incident_reports/class_prefects.
- `lib/seed-fees.ts` — fee_balances/payment_records/payment_transactions/payment_paybill_transactions.
- `lib/seed-content.ts` — documents (+ pdfkit generation + Storage upload)/conversations/messages/notifications.
- `lib/demo-patterns.ts` — the deterministic-index bookkeeping for §6 (which roster positions/entities are "the declining student," "the linked homework," etc.), imported by whichever cluster module needs to tag its own inserts — keeps the interesting-case logic in one place rather than scattered magic-number comments across every cluster file.
- `teardown-sample-school.ts` — standalone script, own file (not a `lib/` module — it's a distinct entrypoint, not shared logic), reverse-order deletes per §7.

### Common patterns

- **Batching**: a small `chunk<T>(arr: T[], size: number): T[][]` helper (no new dependency), used for every `.insert()` exceeding ~200 rows (§10).
- **Auth concurrency**: same `chunk()` helper at a smaller chunk size (~10) driving `Promise.all` per chunk for `createUser` calls (§2).
- **Linked-grade writes**: a small `writeLinkedGrade(assessmentId, studentId, score)` wrapper calling the `write_linked_grade` RPC — used by both the homework and quiz linked-demo cases (§6), never a raw `grades` insert for those two specific assessments.
- **IDs**: `randomUUID()` throughout, matching every existing precedent in this codebase (`packages/db/prisma/seed.ts`, every e2e fixture) — never letting Postgres default-generate an id where the script needs to reference that id again later in the same run (most tables here), and relying on the DB default (`gen_random_uuid()`) only where nothing else needs to reference the row's id afterward.

### New dependency needed for Phase 2 (flagged now, not added)

`tsx` as a new `apps/api` devDependency (currently only in `packages/db`) — the established, already-proven-in-this-monorepo seed-script runner. `apps/api/package.json` needs a new `"seed:sample-school": "tsx scripts/seed-sample-school.ts"` and `"teardown:sample-school": "tsx scripts/teardown-sample-school.ts"` entry, matching the task's own requested `pnpm --filter @school-manager/api seed:sample-school` invocation shape.

### Proposed Phase 2 commit structure

1. `feat(scripts): seed script scaffolding — school structure, safeguards, teardown skeleton` (§1.1-§1.11, §1.21 structure tables, §7 safeguards, `lib/kenyan-names.ts`, the orchestrator's flag-parsing/pre-run-check shell with no activity data yet)
2. `feat(scripts): seed core enrollment — auth users, teachers, students, guardians` (§2, §1.6-§1.9, §4)
3. `feat(scripts): seed academic and attendance activity data` (§1.12-§1.18, §5's academic/attendance rows, including the linked-homework/quiz RPC-based writes)
4. `feat(scripts): seed behavior, fees, documents, messaging, and the demo-pattern cases` (§1.19-§1.25, §6, §8)
5. `feat(scripts): teardown-sample-school.ts` (§7's teardown script, standalone — deliberately last, so it can be tested against the output of commits 1-4 rather than developed blind)
6. `docs: mark B1-X (sample school seed) shipped in EXECUTION_PLAN.md`
