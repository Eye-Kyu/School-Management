# Phase 0, Sub-sprint 4: NEMIS Export, Accessibility, Security, Status Page

**Goal.** Close four smaller compliance/hardening gaps that block enterprise credibility: NEMIS export, WCAG 2.1 AA accessibility, penetration test scoping, and a public status page.

**Status.** Planning only. No code, migrations, or tests in this doc's own PR. (The pentest scope document itself is a separate, standalone deliverable — `docs/phase-0/pentest-scope.md` — and, being pure documentation with no code dependency, is written now rather than deferred; see that file.)

---

## 1. Current state audit

### Existing export code

No CSV/Excel library exists anywhere in the repo (`exceljs`, `papaparse`, `xlsx`, `csv-parse` — zero matches in any `package.json`). Five independent, hand-rolled CSV export/import mechanisms already establish the house style:

| Location | Trigger | Format |
|---|---|---|
| Attendance export — `apps/api/src/attendance/attendance.service.ts:96-170`, `GET /attendance/export` | Admin/Teacher, `/admin/attendance` and `/teacher/attendance` | Hand-built CSV string, escaped, downloaded client-side |
| Grades/assessment export — `apps/api/src/assessments/assessments.service.ts:190-229` | Admin/class-teacher, gradebook UI | Same hand-rolled pattern |
| Gradebook CSV export (frontend-only) — `GradebookClient.tsx:189-198` | Teacher "Export CSV" | Client-built, no backend round-trip |
| Analytics CSV export (frontend-only) — `AnalyticsExport.tsx:5-42` | Admin analytics page | Client-built from already-fetched numbers |
| Students CSV import — `students.service.ts:141+`, `POST /students/import` | Admin bulk-add | Naive `line.split(',')` — no quote/embedded-comma handling, unlike the escaped export paths |
| Fees CSV import — `fees.service.ts:24+`, `POST /fees/import` | Admin bulk fee-set | Same naive parsing |
| Self-service data export — `apps/web/app/api/export/route.ts`, `GET /api/export` | Any authenticated user | Per-user JSON dump (own profile, prefs, notifications, and — students only — grades/attendance/submissions). **Not a whole-school dump** — a different feature entirely |

A prior internal audit (`docs/audits/2026-Q3-analytics-audit.md:68`) independently confirms and flags a mislabeling: the "Attendance Export" page is nav-labeled as analytics but is actually just a CSV export tool.

**NEMIS-specific export: missing entirely.** Grepped the whole repo (code, `.md`, `.sql`) case-insensitively for "nemis" — zero matches anywhere. Fully net new.

### Health check / status page groundwork

Two disconnected things, at different auth levels:

- **`GET /health`** (`apps/api/src/app.controller.ts:1-17`) — public, unauthenticated, **hardcoded** `{status: 'ok', timestamp, version}`. No real DB or dependency check. Used as Render's health-check path (`render.yaml:35`). Proves only that the Node process is alive.
- **`GET /super-admin/system-health/overview`** — fully authenticated (`AuthGuard, SuperAdminGuard, PlatformPermissionGuard('VIEW_SYSTEM_HEALTH')`), rich and real: DB reachability + latency, auth success/failure counts (24h/7d from `audit_logs`), notification backlog + dispatch-cron staleness, payment/webhook delivery counts. No public variant of this data exists.

For a public status page: Better Stack can heartbeat-monitor the existing public `/health` plus the web frontend's root URL with **zero code changes**. A "richer" public status page would need a new, deliberately-limited public endpoint — not the SuperAdmin one, which surfaces business-sensitive payment volume.

### Accessibility

Not a deliberate focus today. Only 5 of 163 `.tsx` files under `apps/web/app` contain any `aria-`, `role=`, or `alt=` attribute at all (`DashboardShell.tsx`, `SuperAdminShell.tsx`, `TeachersClient.tsx`, `ProfileClient.tsx`, `PrefectPowersClient.tsx`, plus 3 shared components). No `jsx-a11y`, `axe-core`, or `jest-axe` in any `package.json`. Typical forms (e.g. `AttendanceExportClient.tsx`) use plain `<label>`/`<select>`/`<input>` with no `htmlFor`/`id` association and no `aria-*`.

Planning docs already acknowledge this as an open, unenforced gap: `EXECUTION_PLAN.md:391` — a WCAG pass listed as an unchecked v0.4 exit criterion. `EXECUTION_PLAN.md:492` — *"every new screen passes axe DevTools before merge"* is written down as a standing always-on policy, unchecked, and — per the file's own evidence — never actually enforced.

### Docs on pentest scope, status page, NEMIS

No file anywhere in `docs/` addresses pentest scope, status page setup, or NEMIS — all three are acknowledged only as unchecked `EXECUTION_PLAN.md`/`ROADMAP.md` checklist items. `docs/runbooks/incident-response.md:51-62` already operationally *assumes* a Better Stack status page exists (instructs updating it during incidents) even though, per the unchecked boxes, it isn't actually set up yet — a documentation/reality mismatch worth closing alongside the real setup.

---

## 2. Gap-to-goal analysis

| Goal | Gap size | Dependencies | Risk | Testability |
|---|---|---|---|---|
| NEMIS export (admin-facing, one-click) | **M** | Current NEMIS field spec (blocks accuracy, not plumbing) | Submitting Ministry-facing data in a subtly wrong format — moderate, recoverable (re-export once corrected) | e2e: export contains exactly the calling admin's own school's active students, cross-tenant isolated, correctly reflects a known guardian's contact info, handles a student with no linked guardian without crashing |
| WCAG 2.1 AA sweep, 15 pages × 4 roles | **S–M per individual fix**, but the sweep itself requires real browser + axe access | A human (or a future session with browser-automation tooling) must physically run axe DevTools — **this cannot be completed as pure static-code planning** | Some contrast/layout issues may need real redesign — explicitly flagged as follow-ups per the task's own instruction, not fixed here | Axe DevTools reports zero critical/serious violations post-fix — inherently a manual verification step, not covered by the existing vitest/jest suites |
| Penetration test scoping | **S–M** | None blocking | None — pure documentation | N/A — documentation deliverable |
| Public status page | **S** (Better Stack against existing `/health`, zero code) **to M** (if a new limited public metrics endpoint is also wanted) | Better Stack account | A status page watching the current **hardcoded-always-OK** `/health` provides false assurance — worth a minimal real DB-ping fix to that one endpoint as part of this work | Deliberately induce a controlled outage (stop the API briefly in a test environment), verify the status page reflects it within Better Stack's polling interval |

---

## 3. Implementation plan

**Migrations**: none required. Status page recommendation (below) needs zero schema/code changes; NEMIS export is a pure read/export of existing data. This sub-sprint is notably migration-light compared to sub-sprints 2 and 3.

**RLS**: NEMIS export follows the existing ADMIN-only, own-school-scoped house pattern (`requireAdmin()` + `forUser`, matching every other export endpoint above) — no new policies needed.

**Tasks** (as they'd appear in the implementation prompt):
- New `GET /students/nemis-export` (or similar) endpoint, ADMIN-only, own-school-scoped, following the exact hand-rolled-CSV pattern already used by attendance/grades export. Fields: admission number, full name, gender, date of birth (**verify this column actually exists on `students` before assuming it — not independently confirmed this pass**), class/grade, parent/guardian contact (joined through `guardians` → `users`, matching the existing guardian-resolution pattern used elsewhere).
- If NEMIS requires XLSX specifically rather than accepting CSV, add `exceljs` (or equivalent) as a new dependency — a real decision point, since every existing export in this codebase is CSV-only today.
- Minimal real health check on `GET /health`: replace the hardcoded `'ok'` with an actual cheap DB ping (a `SELECT 1`-equivalent), so a status page watching it means something.
- Configure Better Stack (or equivalent) to monitor the (now-real) `/health` endpoint and the web frontend's root URL. Add the status page link to the marketing site if it exists outside this repo, or to `CLAUDE.md` if not.
- Manually run axe DevTools across the 15 most-used pages per role (estimated by dashboard-home/nav-prominence, since no page-view analytics exist in this codebase to measure actual usage) and fix contrast/label/focus/heading issues found. Flag anything needing real redesign as a separate follow-up rather than fixing it here, per the task's own instruction.

**Audit logs**: `student.nemis_export` (admin_id, school_id, student_count, exported_at) — matches the convention of logging bulk/sensitive data exports.

**Cross-tenant test coverage plan**: NEMIS export for one school never includes another school's students — standard RLS-backed isolation, same shape as every other cross-tenant test in this codebase's `cross-tenant.e2e-spec.ts`.

**Explicit anti-scope** (restated from the task spec):
- Do not book or run the pentest — produce the scope document only (see `docs/phase-0/pentest-scope.md`).
- Do not fix accessibility issues that require redesign (e.g. a full color-scheme change) — flag as separate follow-ups.
- Do not add real-time uptime alerting to team members — status page only.

---

## 4. External dependencies

| Dependency | Blocks implementation? | Notes |
|---|---|---|
| Current NEMIS export format specification from the Ministry of Education | **Partial** | Blocks field accuracy, not the plumbing — the export can be built against a best-guess field list and corrected once the spec is confirmed |
| Better Stack (or equivalent) account | **YES** (for the status page specifically) | Blocks nothing else |
| Pentester shortlist / booking | **No** | Explicitly manual, post-PR, human action — the scope document itself doesn't need it |
| **Human decision**: CSV-only vs. XLSX for NEMIS export | — | A dependency-adding decision if XLSX is required |
| **Execution gap, not just a dependency**: someone with actual browser access must physically run axe DevTools | — | Flagged plainly rather than faked — no browser-automation capability has been available in any planning session so far |
