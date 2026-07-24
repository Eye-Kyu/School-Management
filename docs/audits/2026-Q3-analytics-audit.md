# 2026-Q3 Analytics Audit

**Scope:** every page, widget, or query across Admin / Teacher / Student / Parent that displays analytics, charts, statistics, aggregates, or trend data, plus report cards and the behavior leaderboard insofar as they carry aggregate metrics.

**Status:** Phase 1 (audit) complete. Two live security findings surfaced during research (not the audit's literal cross-tenant ask, but real same-tenant vulnerabilities) were fixed immediately, out of band, before this doc was finalized — see [Security findings](#security-findings-fixed-out-of-band) below. Everything else in this doc is unimplemented/partial work awaiting Phase 2 prioritization.

**Audit complete — awaiting review before Phase 2.**

## Summary

| Metric | Count |
|---|---|
| Analytics locations with existing UI | 10 |
| — Real | 3 |
| — Stub (hardcoded/placeholder data) | 0 |
| — Broken (mislabeled/errors/empty) | 1 |
| — Partial | 6 |
| Locations with no UI at all (tracked separately, not "broken") | 3 |
| Cross-tenant risks flagged | 1 (pre-existing, documented SuperAdmin assist-mode gap) |
| Same-tenant security findings (fixed out of band, see below) | 2 |
| Charting library found in the codebase | **none** — every "chart" anywhere, for every role, is a hand-rolled CSS `width:%` div bar. No `recharts`/`chart.js`/`d3`/etc. in any `package.json`. |
| TanStack Query | installed (`@tanstack/react-query` in `apps/web/package.json`), zero usages anywhere in the repo |
| Estimated total effort to fully wire remaining partial/broken/not-implemented items | ~6 days |

Notably: this codebase does not fake data. Every analytics widget that exists either queries the database for real or the page simply doesn't exist — there is no case of a chart rendering hardcoded placeholder numbers.

---

## Security findings (fixed out of band)

Two live, exploitable vulnerabilities turned up while tracing the data behind these analytics widgets. Both were same-tenant (not cross-school) issues, so they fall slightly outside the audit's literal "cross-tenant risk" column, but they're real and were fixed immediately rather than left open pending Phase 2 prioritization, per explicit direction.

### SEC-1: `grades`/`assessments`/`assignments`/`submissions` RLS was school-wide only

**Root cause:** `supabase/migrations/20260527000012_gradebook.sql` — the four SELECT policies (`assess_select`, `assign_select`, `grade_select`, `sub_select`) only ever checked `school_id = current_school_id()`. Their own inline comments already said "students see their own; parents see their child's" / "students/parents in class read" — the SQL never implemented it. Any authenticated STUDENT, PARENT, or TEACHER could call `supabase.from('grades').select('*')` directly from the browser and read every other student's scores, assignments, and submitted content in the school. Worse, `apps/api/src/assessments/assessments.service.ts` runs entirely on `this.supabase.forUser(accessToken)` with almost no app-layer scoping of its own (`getScores`/`upsertScores`/`deleteAssessment` trust RLS completely) — this policy was the *only* protection for that whole module.

**Fix:** `supabase/migrations/20260724000054_tighten_gradebook_rls.sql`. `assessments`/`assignments` (metadata only, no per-student score data) are now class-scoped: ADMIN school-wide, TEACHER via `is_class_teacher_of` OR a `subject_assignments` row for that class (mirroring the exact two-way check already established for `bp_insert` in `20260723000043_class_teacher_rls.sql`), STUDENT their own current class, PARENT their linked children's classes. `grades`/`submissions` (actual per-student content) are strictly own-row for STUDENT/PARENT, class-scoped for TEACHER, school-wide for ADMIN.

Verified against every existing consumer in `apps/web` and `apps/api` (18 files) before landing, including the one case that would have regressed naively: `assessments.service.ts`'s `list(classId)`/`exportClassReport` explicitly support a class-teacher-only caller with **no** `subject_assignments` row (covered by an existing passing e2e test) — the fix's TEACHER branch grants access via `is_class_teacher_of` for exactly this reason, not subject_assignments alone.

**One deliberate, handled consequence:** `student/analytics/page.tsx`'s "class average" comparison previously worked by fetching every classmate's raw `grades` row and averaging client-side — now correctly blocked by the tightened policy. Rather than let that silently return zero rows and render a wrong "class average," the same migration adds a `SECURITY DEFINER` function, `class_average_scores(uuid[])`, that returns only `(assessment_id, avg_score, student_count)` — never raw per-student rows, so it doesn't reopen the hole. `student/analytics/page.tsx` was switched to call it via `.rpc()`. `teacher/analytics/page.tsx` needed no change — its equivalent query is already scoped to the teacher's own classes and is covered by the new TEACHER branch directly.

**Tests:** `apps/api/test/cross-tenant.e2e-spec.ts`, two new tests — cross-student blocking (same school, different class), teacher/admin regression checks, and the RPC's aggregate-only shape + cross-school exclusion.

**A third thing surfaced during live validation, not a bug but a consequence worth recording:** Postgres applies `SELECT` policies to the `RETURNING` clause of `UPDATE`/`DELETE`, not just the mutation's own `USING` clause — otherwise a write-only actor could exfiltrate row data through `RETURNING` despite having no read rights. Two pre-existing Task 5 tests (single-attempt-lock: teacher grading a past-deadline submission, and teacher-reset-then-resubmit) had teacherA grading/resetting a submission with no real `subject_assignments`/`is_class_teacher_of` relationship to the class — invisible before because `sub_select` was school-wide, and now correctly empty-`RETURNING` under the tightened policy even though the underlying grade/delete succeeded. Fixed by giving those two tests' own fixtures a real class relationship (`is_class_teacher_of`), matching this file's established self-contained-fixture convention, rather than loosening the policy back. Full `cross-tenant.e2e-spec.ts` suite (129 tests) passes after this, aside from one confirmed pre-existing flake in an unrelated Task 3 (platform messaging) test that passes cleanly in isolation.

**A second, independent bug surfaced while validating this fix live:** `assessments` (only that table — not `assignments`/`grades`/`submissions`) carried an additional, pre-existing PERMISSIVE policy, `assessments_school_isolation` (`ALL` commands, `USING (school_id = (SELECT users.school_id FROM users WHERE users.auth_id = auth.uid()))`), that exists nowhere in the migration history — it was never created by any file in `supabase/migrations/`, so it was almost certainly added ad hoc outside the migration pipeline (e.g. via the Supabase Studio RLS UI) at some earlier, unknown point. It was invisible and harmless-by-coincidence until now: since the old `assess_select` was ALSO just a school-wide check, this redundant policy changed nothing. Postgres ORs multiple PERMISSIVE policies together for the same command, so the moment `assess_select` was tightened to be class/role-scoped, this untouched duplicate silently became the dominant, unrestricted grant — fully undoing the fix for `assessments` specifically. Caught via live e2e testing (a fresh, isolated probe outside the shared test fixtures initially gave a false-negative "all clear" due to an unrelated `NOT NULL` constraint on `teacher_id` silently failing that probe's insert; the real e2e test against the shared fixtures caught it correctly). Dropped in `20260724000056_drop_rogue_isolation_policy.sql`, along with a temporary `diag_check_policies()` introspection function added and removed during the investigation (`20260724000055_diag_temp.sql`). **Worth a follow-up:** since this policy was created outside the tracked migration history, it's worth an independent check for other ad hoc, untracked policies on any other table — this audit only went looking because a live test caught a concrete leak, not via a systematic sweep.

**Note for Phase 2:** the corresponding INSERT/UPDATE/DELETE policies on these four tables (`assess_update`, `grade_update`, etc.) still only check `current_user_role() IN ('TEACHER','ADMIN')` with no class scoping — any teacher in the school can currently mutate any other teacher's assessment/grade. This is a distinct, adjacent gap from what was found and fixed here (this audit's mandate was analytics reads); flagged for a follow-up security pass, not addressed in this patch.

### SEC-2: `parent/grades/page.tsx` — unvalidated `studentId` URL parameter (IDOR)

**Root cause:** the page read `searchParams.studentId` and passed it straight into the `grades` query without ever checking it belonged to the calling parent's own linked children (which the same function had already resolved via `guardians` a few lines earlier). A parent could view any other student's grades in the school by editing `?studentId=` in the URL. Confirmed via grep this was the *only* parent page with this pattern — `fees`/`attendance`/`homework`/`permission-slips` either hardcode the first child or don't accept a student selector at all.

**Fix:** `apps/web/app/(dashboard)/parent/grades/page.tsx` now validates the requested `studentId` against the parent's own resolved `students` array before using it, falling back to their first child otherwise. This is defense in depth — SEC-1's RLS fix would now also block the underlying query structurally — but explicit validation avoids a confusing empty-state render for a tampered URL and is the correct app-layer practice regardless of the DB layer.

**Related, not modified:** `report-card/[studentId]/page.tsx` and `print/report-card/[studentId]/page.tsx` have the identical unvalidated-route-param shape, but are already protected transitively: the `students` row lookup that both pages do first is gated by the pre-existing (and correct) `students_select` RLS policy, which already restricts STUDENT/PARENT to their own/linked child — a tampered `studentId` there returns `student: null` before any grade data is ever queried. No code change was needed for these two pages.

---

## Findings by location

| # | Location | What it claims to show | Current state | Backing endpoint | Data source dependencies | RLS status | Cross-tenant risk | Effort to fully wire |
|---|---|---|---|---|---|---|---|---|
| 1 | `apps/web/app/(dashboard)/admin/analytics/page.tsx` (`/admin/analytics`) | School-wide stats: active students/teachers, fee collection, attendance by class, subject pass rates, teacher workload | **Partial** — every number is a real, live query; no mock data | none (direct Supabase read) | `terms`, `students`, `teachers`, `fee_balances`, `classes`, `subjects`, `attendance_records`, `assessments`, `grades`, `subject_assignments` | `createClient()` (RLS session client, not `.admin`) | **Yes — flagged.** Pre-existing, documented SuperAdmin assist-mode gap: `teachers`/`subject_assignments` aren't in `lib/supabase/server.ts`'s `DIRECT_SCHOOL_ID_TABLES` allowlist, so a SuperAdmin browsing this page in assist mode gets an unscoped, cross-school read for the teacher-workload widget specifically. Already documented in that file's own header comment and in `EXECUTION_PLAN.md`'s backlog from the prior PR. | S — add the two tables to the allowlist |
| 2 | Admin per-class analytics | Per-class breakdown (grade distribution, class average, etc.) | **Not implemented** — no route exists at all. The only per-class number anywhere is the "attendance by class" bar list embedded in #1. | — | — | — | — | L — net-new page |
| 3 | `admin/analytics/page.tsx` + `admin/fees/page.tsx` (`/admin/fees`, titled "Fee arrears") | Fees collected / outstanding / trend | **Partial** — collected and outstanding totals are real (`fee_balances`, summed server-side); **trend does not exist anywhere** — no time-series query, no "collected over time" chart | none | `fee_balances` | RLS session client | none found | M — needs a payments-over-time query; verify `fee_balances`/a payments table has enough history to chart before committing to a design |
| 4 | `apps/web/app/(dashboard)/admin/attendance/page.tsx` (`/admin/attendance`, titled "Attendance Export") | Nav labels this "attendance analytics" | **Broken — mislabeled.** This is a CSV export tool (class/date-range filter + download button), not an analytics page. No charts, no stat cards. Real attendance analytics (rate %, per-class breakdown) already exists inside #1. | `GET /attendance/export` (`attendance.controller.ts`) | `attendance_records` | `forUser(token)` via NestJS | none found | S — either relabel the nav entry and link to #1's attendance widget, or build a dedicated page; reviewer call |
| 5 | `admin/analytics/page.tsx` — "Teacher workload (classes assigned)" widget | Teacher workload ranking | **Partial** — real, but "workload" is a raw count of `subject_assignments` rows per teacher, not actual timetable hours/periods (a weak proxy). Same assist-mode gap as #1. | none | `subject_assignments`, `teachers`, `users` | RLS session client | Yes — same as #1 | S for the assist-mode fix; M if a truer workload metric (timetable-hours-based) is wanted |
| 6 | `apps/web/app/(dashboard)/teacher/analytics/page.tsx` (`/teacher/analytics`) | "Assessment averages" (labeled internally as at-risk/score-distribution/class-avg by the coverage checklist), weekly attendance, at-risk student list | **Partial.** At-risk list (attendance <70% / grade <50% / submission <40%, HIGH/MEDIUM flags) is real and correctly computed. What's labeled "score distribution" in the audit brief is actually a per-assessment **average** bar, not a histogram — no bucketed score distribution exists anywhere in the codebase. | none | `subject_assignments`, `students`, `assessments`, `grades`, `attendance_records`, `assignments`, `submissions` | RLS session client, correctly scoped to the teacher's own classes (verified against the SEC-1 fix — no regression) | none found | S to relabel "assessment averages" honestly, M to build a true histogram |
| 7 | `teacher/analytics/page.tsx` — "Weekly attendance" widget (no separate page exists) | Attendance trend per class, last 8 weeks | **Real.** | none | `attendance_records` | RLS session client, correctly scoped | none found | — (already works) |
| 8 | `apps/web/app/(dashboard)/student/analytics/page.tsx` (`/student/analytics`) | "Subject performance" (grade trend + class-avg comparison), attendance pattern, submission rate | **Partial.** Attendance pattern and submission rate are real and correctly own-scoped. "Grade trend" is actually current-term **subject averages**, not a chronological trend line over time — there's no time-series grade chart anywhere. Class-average comparison was, until the SEC-1 fix, backed by an unscoped cross-student read; now uses the safe `class_average_scores` RPC. | none | `assessments`, `grades`, `attendance_records`, `assignments`, `submissions` | RLS session client, own-row scoped (fixed under SEC-1) | none found (post-fix) | M — a true time-series trend needs charting a student's own scores across assessment dates, which the data already supports (`assessment_date` exists); mostly a frontend change |
| 9 | Parent per-child analytics | Same as #8, per linked child | **Not implemented.** No route, no nav entry (`DashboardShell.tsx`'s `PARENT` array has no Analytics item, unlike STUDENT/TEACHER), never planned in `EXECUTION_PLAN.md` or `ROADMAP.md`. | — | — | — | — | L — net-new page; must reuse the `guardians`-based child-resolution pattern from `parent/page.tsx` and must validate any child-selector param against the parent's own children (see SEC-2 — don't repeat that mistake) |
| 10 | `apps/web/app/(dashboard)/leaderboard/` + `apps/api/src/behaviour/` | Behavior/leaderboard rankings by net points, filterable by window/scope | **Real, well-built.** RLS (`forUser` + explicit `.eq('school_id', ...)` belt-and-suspenders), role-based visibility caps enforced server-side (student/parent capped at top-20 school-wide only; teacher blocked from grade-scope entirely, class-scope requires being class teacher or having a subject_assignments row), 60s in-memory cache keyed by `school_id:window:scope:classId:gradeLevel:cap` with proactive bust on new point awards. Dedicated cross-tenant e2e coverage already exists (`cross-tenant.e2e-spec.ts` lines ~2277-2462). | `GET /behaviour/leaderboard` | `behaviour_points` | `forUser(token)` + explicit school filter | none found — best-guarded feature in the whole audit | — (already works) |
| 11 | AI-suite analytics (tutor usage/session stats) | — | **Not implemented as a page**, for any role. `tutor_logs` (school_id, student_id, conversation_id, question, answer) is written on every tutor turn by `ai.service.ts`, and its RLS (`tutor_logs_select`) is already correctly scoped to `ADMIN`/`TEACHER` roles within the school — but no page anywhere reads the table. The data pipe exists; nothing consumes it. | — (table exists, no reading endpoint) | `tutor_logs` | RLS already correct, unused | none (unused) | M — new teacher/admin-facing page: session counts, most-asked topics, usage over time |
| 12 | `apps/web/app/print/report-card/[studentId]/page.tsx` and `app/report-card/[studentId]/page.tsx` (the printable document) | Per-subject average, overall average, letter grade, attendance summary | **Partial.** All of the above are real, computed from live `assessments`/`grades`/`attendance_records` queries. **No class rank or class-average comparison anywhere** — grepped the whole `app/print` and `app/report-card` trees for rank/position/class_average, zero matches. | none | `assessments`, `grades`, `attendance_records`, `students`, `schools` | RLS session client; protected transitively via `students_select` for STUDENT/PARENT (see SEC-2 note); TEACHER retains broad `students_select` visibility (pre-existing, unrelated to this audit) but content will now render empty for classes outside the teacher's own per SEC-1 | none found | S to add a class-average line (data already available via `class_average_scores`), M for rank/position (needs an ordering computation across the class) |
| 13 | `apps/web/app/(dashboard)/admin/report-cards/page.tsx` (`/admin/report-cards`) | Students count, "with comments" count, published count, per selected class+term | **Real.** Operational/workflow completion tracking, not an academic metric. | none | `students`, `student_report_cards` | RLS session client | none found | — (already works) |

---

## Prose notes on tricky cases

**"Score distribution" (teacher) and "grade trend" (student/parent) don't mean what their labels imply.** Both are averages presented with chart-like styling, not the histogram/time-series their names suggest. This is a labeling gap as much as a data gap — worth a product decision on whether to relabel to match reality (cheap) or build the literal feature (a genuine new chart type, not just wiring an existing query).

**No charting library exists.** Every "chart" in this codebase, across all four roles, is a hand-rolled `<div style={{width: '${pct}%'}}>` bar component, duplicated with minor variations in `admin/analytics`, `teacher/analytics`, `student/analytics`, and `super-admin/analytics`. There is no line chart, histogram, or pie chart anywhere — meaning items #6's "score distribution" and #8's "grade trend," if built literally, need a genuinely new visualization primitive, not just a new bar. Decision made for Phase 2: introduce Recharts (the task brief's own assumption, which turned out to describe no library currently in use — treated as making the first choice, not introducing a second one alongside an existing pick).

**TanStack Query is a dependency with zero call sites.** Every analytics widget currently fetches data via a plain Next.js server component (fetch-on-render, no client-side caching/revalidation) or, in the few client-component cases (e.g. `teacher/behaviour/page.tsx`), hand-written `useState`/`useEffect`. Phase 2's instruction to "use TanStack Query" for the frontend hooks is straightforward to satisfy since the dependency is already installed — it just hasn't been reached for yet anywhere in the app.

**Assessments/gradebook has a documented history of schema-assumption bugs** (`EXECUTION_PLAN.md`, 2026-07-22 entry: the live `assessments` table's real columns are `teacher_id`/`max_marks`/`assessment_date`, not the `created_by_id`/`max_score`/`date` an earlier migration draft assumed). Any Phase 2 work touching these tables should verify live column names against a real query or the existing, already-correct call sites (e.g. `assessments.service.ts`) rather than trusting migration file comments, which have been wrong here before.

---

## Effort estimate detail

| Item | Effort |
|---|---|
| SEC-1 (RLS tightening) | **Done** (fixed out of band) |
| SEC-2 (parent grades IDOR) | **Done** (fixed out of band) |
| #1/#5 assist-mode allowlist fix | S |
| #2 Admin per-class analytics (new) | L |
| #3 Fees trend | M (possibly XL if no payment-history table exists — needs confirming before committing) |
| #4 Admin attendance page relabel/rebuild | S |
| #6 "Score distribution" relabel or real histogram | S (relabel) |
| #8 "Grade trend" → real time-series | M |
| #9 Parent per-child analytics (new) | L |
| #11 AI-suite usage page (new) | M |
| #12 Report card class-average/rank | M |
| **Total (excluding already-fixed security items and already-working #7/#10/#13)** | **~6 days** |

---

## Definition of done tracking

- [x] Audit doc committed at `docs/audits/2026-Q3-analytics-audit.md`.
- [ ] Audit reviewed by the requester — **pending**.
- [x] Both live security findings (SEC-1, SEC-2) fixed and tested, ahead of normal Phase 2 prioritization, per explicit direction.
- [ ] Every `broken`/`stub`/`not-implemented` item from this audit either wired for real or explicitly deferred with a note in `EXECUTION_PLAN.md` — **Phase 2, not started**.
- [ ] Cross-tenant tests for every analytics endpoint touched in Phase 2.
- [x] No new `supabase.admin` usages introduced by the security patch (the `class_average_scores` function is `SECURITY DEFINER` at the SQL level, not a `supabase.admin` client call, and is scoped to `current_school_id()` internally and returns only an aggregate).
- [ ] p95 < 300ms verification — Phase 2, once real queries replace the remaining stub/broken/missing pages.
- [ ] Loading/error/empty states for every analytics component — Phase 2.
- [ ] `EXECUTION_PLAN.md` updated with Phase 2 checkboxes and backlog — pending Phase 2 kickoff.
