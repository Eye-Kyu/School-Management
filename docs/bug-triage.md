# Bug Triage

Tracks confirmed-real bugs found during development or an audit that are deliberately **not** fixed in the PR that found them, because they're out of scope for that PR's stated task. This is a defect log, not a feature backlog — `EXECUTION_PLAN.md` owns roadmap/feature items.

Each entry: what's wrong, where, why it wasn't fixed on the spot, and enough detail that a future PR can pick it up without re-deriving the root cause.

---

## Open

### BUG-1: middleware doesn't redirect a roleless/soft-deleted-but-authenticated session away from dashboard routes

**Found during:** 2026-07-25, "Cross-account access hardening" audit (bug-fix PR — Task 2).

**File:** `apps/web/middleware.ts`

**What's wrong:** `getUserRole()` returns `null` when an authenticated Supabase-Auth session has no matching `public.users` row (a signup race condition) or when the matching row is soft-deleted (`deleted_at IS NOT NULL`, which the middleware's own `users` lookup doesn't filter out, unlike `current_user_id()`/`current_school_id()` at the RLS layer). When `role` is `null`, the enforcement check at `if (role && expectedPath && roleFromPath !== expectedPath)` is false, so **no redirect happens** — such a session can load the HTML shell of any `/admin`, `/teacher`, `/student`, `/parent`, `/super-admin` route.

**Impact:** No data exposure. Every subsequent Supabase query on any of those pages is still RLS-gated by `current_user_role()`/`current_school_id()`, both of which resolve to `NULL` for a roleless/deleted caller — every tenant-scoped policy evaluates false, so no rows are ever returned. Confirmed by reading every relevant RLS policy, not just RLS's general design. The gap is purely "the page shell loads instead of an immediate redirect to `/login`," not a leak.

**Why not fixed here:** This task's scope was cross-account data/route access; this finding has no cross-account data exposure. Fixing it also risks touching shared middleware logic beyond "the specific found bug," which Task 2 explicitly said not to do.

**Suggested fix:** In `middleware.ts`, when `user` exists but `getUserRole()` returns `null` and the path `isDashboard`, redirect to `/login` (mirroring the existing `!user && isDashboard` branch) instead of falling through silently.

---

### BUG-2: `PATCH /attendance/remark-requests/:id` returns a misleading success when RLS blocks the write

**Found during:** 2026-07-25, "Cross-account access hardening" audit (bug-fix PR — Task 2).

**File:** `apps/api/src/attendance/attendance.service.ts`, `reviewRemarkRequest()`

**What's wrong:** The method has no app-layer role/ownership check of its own (unlike most other services in this codebase, which use `requireAdmin`/`requireSelf`) — enforcement is RLS-only via the `arr_update` policy, which correctly restricts the UPDATE to Admin or the requester's routed Department Head. But the code does `.update(...).eq('id', requestId)` and only checks `error` (which is `null` even when RLS silently matches 0 rows), then unconditionally writes an audit log entry and sends the requester a "your request was approved/denied" notification.

**Impact:** Not a data leak — the actual row is untouched when RLS blocks it, since Postgres RLS simply excludes the row from the UPDATE's affected set rather than throwing. But an unauthorized caller (e.g., a teacher who isn't the routed Department Head) gets back `{updated: true}` as if their review succeeded, an audit log entry is written for an action that didn't happen, and the original requester receives a notification claiming their request was decided when it's still `PENDING`.

**Why not fixed here:** This is a correctness/audit-integrity bug, not a cross-account access bug — nobody's data was read or modified incorrectly. Task 2's scope was specifically unauthorized data access/modification.

**Suggested fix:** After the `.update(...).select()` call, check that a row was actually returned/affected before writing the audit log or queuing the notification; if none, throw `ForbiddenException` (matching the pattern already used elsewhere in this same file, e.g. `_authorizeRemark`).

---

### BUG-3: `cross-tenant.e2e-spec.ts`'s system-health test asserts an auth-login count that fixture logins can never produce

**Found during:** 2026-07-26, Phase 0 sub-sprint 1a (SMS via Africa's Talking) — surfaced as a failing, unrelated test while confirming the full e2e suite stayed green after the SMS changes. Reproduces in complete isolation (`-t "system health overview reports real"`, `beforeAll` fixtures only) — confirmed unrelated to this PR (a new, separate test file; no changes to `cross-tenant.e2e-spec.ts`, `system-health.service.ts`, or auth audit logging this sub-sprint).

**File:** `apps/api/test/cross-tenant.e2e-spec.ts:1706` (the test), `apps/api/src/system-health/system-health.service.ts:34-37` (what it reads).

**What's wrong:** The test asserts `res.body.auth.last24h.logins >= 1`, with a comment claiming *"this run alone has already generated real auth.login events (seedUser signs every fixture in via password auth)"*. That's not how `action: 'auth.login'` rows actually get written — grepped the whole codebase: the **only** place that ever inserts one is `apps/web/app/(auth)/login/page.tsx:81,122`, a fire-and-forget `POST /auth/events` call made by the frontend login page *after* a successful sign-in. Every e2e fixture (`seedUser`'s `anon.auth.signInWithPassword(...)`) authenticates directly against the Supabase Auth SDK — it never goes through the app's login page or calls `/auth/events` — so it can never produce the row this test expects. The count is correctly `0`; the test's premise was wrong from the start.

**Impact:** Test-only. `system-health.service.ts` itself is reading real data correctly (confirmed by the `SELECT` shape) — there's no production bug here, just an e2e assertion resting on a false assumption about how Supabase Auth sign-ins and this app's own audit logging relate.

**Why not fixed here:** Unrelated subsystem (auth audit logging vs. this PR's SMS/notifications scope), and it's a pre-existing test, not code this PR touches.

**Suggested fix:** Either have the test itself call `POST /auth/events` (matching what a real login does) before asserting the count, or relax the assertion to `>= 0` and instead assert the *shape* of the response (the fields exist and are numbers) — the current assertion tests something the test's own fixtures cannot produce.

---

## Resolved / re-verified (not bugs)

For traceability — items raised as open questions in a prior PR's follow-up notes, re-examined during the 2026-07-25 audit and confirmed safe, not touched:

- **`report-card/[studentId]` and `print/report-card/[studentId]` route param trust** — confirmed the `studentId` URL param is used unvalidated in app code, but is protected transitively: the first query in both pages is against `students`, gated by `students_select` RLS (own-row for STUDENT, guardian-linked for PARENT), so a tampered ID returns `student: null` before any grade/attendance data is ever fetched. `grade_select` and `attendance_records_select` independently enforce the same restriction on the data itself. Matches and confirms the identical conclusion already recorded for these two routes in `docs/audits/2026-Q3-analytics-audit.md`.
- **`middleware.ts`'s `user_metadata.role` fast path** — re-examined for staleness risk (a role change not yet reflected in session metadata). The fast path only trusts a `user_metadata`/`app_metadata` role value if it matches a known `ROLE_HOME` key, and any unrecognized/stale value falls through to a live `users.role` DB lookup. The residual gap that *does* exist (a `null` role result not being redirected) is BUG-1 above, not a staleness issue specifically.
