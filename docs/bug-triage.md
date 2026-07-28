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

---

## Fixed

### BUG-3: `cross-tenant.e2e-spec.ts`'s system-health test asserted an auth-login count that fixture logins could never produce

**Found during:** 2026-07-26, Phase 0 sub-sprint 1a (SMS via Africa's Talking) — surfaced as a failing, unrelated test while confirming the full e2e suite stayed green after the SMS changes.

**File:** `apps/api/test/cross-tenant.e2e-spec.ts` (the test, and the `seedUser`/`createExtraUser` sign-in fixtures across this and 3 other e2e spec files), `apps/api/src/system-health/system-health.service.ts` (what it reads, never itself buggy).

**What was wrong:** The test asserted `res.body.auth.last24h.logins >= 1`, on the false premise that fixture sign-ins already generate `auth.login` audit rows. The **only** place that ever writes one is `apps/web/app/(auth)/login/page.tsx`'s fire-and-forget `POST /auth/events` call, made by the frontend login page *after* a successful sign-in. Every e2e fixture authenticated directly against the Supabase Auth SDK (`anon.auth.signInWithPassword(...)`), never through the app's login page or `/auth/events` — so the count was correctly `0` and the assertion could never pass.

**Fix (2026-07-29, Phase 0 closure PR):** every e2e spec file's inline sign-in fixture (`seedUser` in `cross-tenant.e2e-spec.ts`, `notifications-sms.e2e-spec.ts`; `seedAdmin` in `payments-paybill.e2e-spec.ts`, `nemis-export.e2e-spec.ts`; `createExtraUser` in `cross-tenant.e2e-spec.ts`) now makes the same `POST /auth/events` call right after signing in, mirroring the real login page exactly. No frontend code or `/auth/events` endpoint changed — fixture-only fix. Deliberately not extracted into a shared helper module; this codebase already duplicates its sign-in fixture per spec file as an established convention.

**Verification:** live run of the full `cross-tenant.e2e-spec.ts` file (2026-07-29, 150/151 passing — the 1 failure was an unrelated scoping bug in a newly-added test, immediately fixed) confirms the pre-existing `auth.last24h.logins >= 1` assertion now passes for real, not by coincidence — `beforeAll` alone calls the fixture ~10 times before that test runs. New dedicated regression test added: `'BUG-3 regression: signing in through the fixture writes a real auth.login audit_logs row'`, seeds one user and asserts its `audit_logs` row exists directly.

---

### BUG-4: `NotificationsService.dispatch()` could double-send an SMS under real dispatcher concurrency

**Found during:** 2026-07-28, Phase 0 sub-sprint 4 (NEMIS export/accessibility/hardening) — surfaced in the full `pnpm --filter @school-manager/api test:e2e` run as an SMS-dedup test flake (`logRows` length 2 instead of 1). Initially triaged (in this same doc) as "test-only, unrelated subsystem, isolated run passes clean" — that triage was **wrong**. A deeper investigation during Phase 0 closure (2026-07-28) read `dispatch()` and `notifications.scheduler.ts` in full and found a genuine, code-level concurrency bug, not a test-infrastructure artifact.

**File:** `apps/api/src/notifications/notifications.service.ts` (`dispatch()`), `apps/api/src/notifications/notifications.scheduler.ts`.

**What was wrong:** `dispatch()` SELECTed up to 100 PENDING rows, then for each one called the paid, external `AfricasTalkingClient.sendSms()` **before** ever writing `sms_status` back — the only write was a final, unconditional `UPDATE ... eq('id', row.id)` with no `WHERE sms_status='PENDING'` guard. `NotificationsScheduler`'s `@Cron(EVERY_MINUTE)` handler had no overlap guard, so a tick that took longer than 60 seconds (plausible under load) could still be running when the next minute's tick fired — a same-process self-overlap, not dependent on horizontal scaling (`render.yaml` confirms single-instance deployment for both services, which rules out cross-process races but not this one). Two overlapping `dispatch()` calls that both SELECT the same row before either writes could both send it.

**Fix (2026-07-28, Phase 0 closure PR):**
- **Atomic claim-before-send** (the load-bearing fix): before calling `sendSms()`, the SMS branch now atomically claims the row via `supabase.admin.from('notifications').update({sms_status:'SENDING'}).eq('id', row.id).eq('sms_status','PENDING').select('id')` — PostgREST executes this as a single atomic UPDATE+RETURNING statement. Zero rows returned means another `dispatch()` run already claimed it, so this run skips it entirely (no send, no further write). On a retryable send failure, the claim is explicitly released back to `'PENDING'` for the next tick to retry. Migration `supabase/migrations/20260728000075_notifications_sms_status_sending.sql` adds `'SENDING'` to the `notifications_sms_status_check` CHECK constraint (exact constraint name confirmed live via a deliberate invalid-insert probe, not guessed).
- **Scheduler overlap guard** (defense in depth, not a replacement for the above): `NotificationsScheduler` now has a `private running` flag, set/cleared around the `@Cron` handler in a try/finally, skipping (and logging) any tick that fires while the previous one is still in flight.
- **Scope boundary, deliberately not fixed:** the identical theoretical race exists on the email path (`email_sent_at IS NULL` → send → write) — email has no per-message cost and no existing retry-attempt-count field to build the same claim pattern onto without a new column, so this is a documented, accepted, lower-severity gap (see the doc comment above `dispatch()` in the source), not fixed in this pass.

**Verification:** new concurrency regression test in `apps/api/test/notifications-sms.e2e-spec.ts` ("BUG-4 regression: two concurrent dispatch() calls never both send the same SMS") calls `Promise.all([notifications.dispatch(), notifications.dispatch()])` against one queued PENDING SMS-eligible notification and asserts `sendSmsMock` was called exactly once, `message_send_log` has exactly one row, and `sms_status` ends at `'SENT'`. New unit test `apps/api/src/__tests__/notifications-scheduler.spec.ts` covers the scheduler's overlap guard in isolation (mocks `svc.dispatch()` to hang, fires the decorated method twice, asserts the service method was invoked once) — passing, 127/127 API unit tests green. **Live-verified 2026-07-29** after the user applied migration `20260728000075`: full `notifications-sms.e2e-spec.ts` run, 7/7 passing, including the new concurrency test. One unrelated issue surfaced and was fixed during that verification — the new test's hardcoded phone number (`+254712345680`) collided with the pre-existing "retries a provider failure" test's own hardcoded number in the same school, tripping the `users(school_id, phone)` unique index and silently leaving that other test's user with `phone: null` (the seed fixture's upsert doesn't check its own error). A test-fixture bug, not a dispatch-logic bug — fixed by giving the new test its own phone number (`+254712345682`).

---

## Resolved / re-verified (not bugs)

For traceability — items raised as open questions in a prior PR's follow-up notes, re-examined during the 2026-07-25 audit and confirmed safe, not touched:

- **`report-card/[studentId]` and `print/report-card/[studentId]` route param trust** — confirmed the `studentId` URL param is used unvalidated in app code, but is protected transitively: the first query in both pages is against `students`, gated by `students_select` RLS (own-row for STUDENT, guardian-linked for PARENT), so a tampered ID returns `student: null` before any grade/attendance data is ever fetched. `grade_select` and `attendance_records_select` independently enforce the same restriction on the data itself. Matches and confirms the identical conclusion already recorded for these two routes in `docs/audits/2026-Q3-analytics-audit.md`.
- **`middleware.ts`'s `user_metadata.role` fast path** — re-examined for staleness risk (a role change not yet reflected in session metadata). The fast path only trusts a `user_metadata`/`app_metadata` role value if it matches a known `ROLE_HOME` key, and any unrecognized/stale value falls through to a live `users.role` DB lookup. The residual gap that *does* exist (a `null` role result not being redirected) is BUG-1 above, not a staleness issue specifically.
