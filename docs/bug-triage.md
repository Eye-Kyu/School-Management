# Bug Triage

Tracks confirmed-real bugs found during development or an audit that are deliberately **not** fixed in the PR that found them, because they're out of scope for that PR's stated task. This is a defect log, not a feature backlog — `EXECUTION_PLAN.md` owns roadmap/feature items.

Each entry: what's wrong, where, why it wasn't fixed on the spot, and enough detail that a future PR can pick it up without re-deriving the root cause.

---

## Open

### BUG-1: `middleware.ts` doesn't redirect when an authenticated session has no resolvable role

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

### BUG-7: Prisma's `Score` model maps to `scores`, but the live table is `grades` — a second, undocumented instance of the sub-sprint-4 drift class

**Found during:** 2026-07-31, Bucket 1 PR 2 Phase 1 audit (`docs/audits/homework-quiz-gradebook-relationship.md`) — surfaced while tracing the gradebook schema to design a homework/quiz linking feature.

**File:** `packages/db/prisma/schema.prisma:373-391` (`model Score`, `@@map("scores")`); every live consumer instead reads/writes `public.grades` (`apps/api/src/assessments/assessments.service.ts:136,165,198,235`).

**What's wrong:** No migration anywhere creates a `public.scores` table (confirmed via `grep -rn "CREATE TABLE.*scores"` across all of `supabase/migrations` — zero results). The actual table, created in `supabase/migrations/20260527000012_gradebook.sql:54-66`, is `public.grades`. Prisma's `@@map("scores")` for this model is simply wrong and has been since the model was written — it doesn't match anything in the live database. This is the same underlying class of problem as the already-fixed `assessments` drift (`20260728000073_fix_assessments_schema_drift.sql`) — a Prisma model asserting a shape/name that was never actually true on the real, migration-built schema — just never caught because nothing in this codebase runs `prisma migrate diff` or equivalent against the live DB to compare the two.

**Impact:** No runtime impact today — no code path ever calls anything that would resolve `Score`/`scores` through Prisma's client against the live DB (Prisma is only used for `prisma generate`/type generation in this project, not as a runtime query layer for this table; confirmed all live reads/writes go through hand-written Supabase-js queries against `grades`). The risk is purely for future work: anyone who trusts the Prisma schema as ground truth (e.g., generating a new service off `model Score`, or writing a migration "to match Prisma") would build against a table name that doesn't exist.

**Why not fixed here:** Out of scope for an audit-only PR phase; not blocking Bucket 1 PR 2's actual work, which reads the real `grades` table directly per this audit's own findings.

**Suggested fix:** `packages/db/prisma/schema.prisma`'s `model Score` should be `@@map("grades")`, and its field names/mappings should be reconciled against `grades`'s actual columns (`assessment_id`, `student_id`, `score`, `comment`, `graded_by_id`, `graded_at`) the same way `20260728000073_fix_assessments_schema_drift.sql` reconciled `Assessment`. No migration needed (Prisma schema is not itself a migration source in this project's workflow) — just a Prisma schema edit plus `prisma generate`.

---

### BUG-8: `assessments.term_id`'s nullability/cascade behavior was never reconciled between the original migration and Prisma, unlike `teacher_id`/`max_marks`

**Found during:** 2026-07-31, Bucket 1 PR 2 Phase 1 audit — surfaced while checking whether `assessments.term_id` could safely be relied on as NOT NULL for a homework/quiz linking feature.

**File:** `supabase/migrations/20260527000012_gradebook.sql:44` (original: `term_id UUID REFERENCES public.terms(id) ON DELETE SET NULL` — nullable); `packages/db/prisma/schema.prisma:349` (`termId String` — non-optional, `onDelete: Cascade` at line 361); `supabase/migrations/20260728000073_fix_assessments_schema_drift.sql` (the sub-sprint-4 drift fix, which explicitly reconciled `teacher_id`/`max_marks` to NOT NULL at lines 43-51, but never touches `term_id` at all, since `term_id`'s *name* matched between the buggy original and the real Prisma-built table, so it fell outside that migration's detection scope, which was column-existence based).

**What's wrong:** The original migration and Prisma disagree on whether `term_id` is nullable and what happens to an `assessments` row when its term is deleted (`SET NULL` vs. `Cascade`). The live database — built originally via `prisma db push` before the migration-file workflow existed — presumably matches Prisma (NOT NULL, Cascade), consistent with the API layer treating `term_id` as always required (`CreateAssessmentInput.termId` has no `.optional()` in `packages/types/src/schemas/assessments.ts:5`). But no migration file ever asserts this the way `20260728000073` explicitly did for `teacher_id`/`max_marks` — so a from-scratch bootstrap replaying only the migration files from empty would produce a table with nullable `term_id`/`ON DELETE SET NULL`, silently diverging from both Prisma and from what the application code assumes.

**Impact:** No live impact on the existing, already-bootstrapped production database (which almost certainly already has the Prisma-shaped column, same reasoning as the other columns `20260728000073` fixed). The risk is confined to a genuinely fresh bootstrap (a new deployment target, a disaster-recovery rebuild from migrations alone, or a test database built the same way) ending up with a different `term_id` shape than production has — the same category of risk the original `assessments` drift incident was.

**Why not fixed here:** Out of scope for an audit-only PR phase.

**Suggested fix:** A small additive migration, following the exact pattern `20260728000073_fix_assessments_schema_drift.sql` already established: conditionally `ALTER TABLE assessments ALTER COLUMN term_id SET NOT NULL` (guarded by a check for existing NULLs, matching how that migration handled `teacher_id`/`max_marks`), and separately reconcile the `ON DELETE` behavior if it matters operationally (dropping and re-adding the FK with `ON DELETE CASCADE` to match Prisma, or leaving `SET NULL` and updating Prisma to match — whichever is actually true in production should be verified live first, the same way `20260728000073`'s own postmortem recommends verifying rather than assuming).

---

### BUG-9: `assessments.max_marks` has no DB-level positivity guard, and one of the two grade-entry paths doesn't guard it at the app layer either

**Found during:** 2026-07-31, Bucket 1 PR 2 Phase 1 audit — surfaced while checking whether a future score-normalization formula (`score / max_marks`) could safely assume a positive `max_marks`.

**File:** `supabase/migrations/20260527000012_gradebook.sql:39-52` / `20260728000073_fix_assessments_schema_drift.sql` (no `CHECK` constraint on `max_marks` in either); `packages/types/src/schemas/assessments.ts:10` (`maxMarks: z.number().int().positive().max(1000)` — the only positivity guard, and it only applies to `POST /assessments`); `apps/web/app/(dashboard)/teacher/gradebook/GradebookClient.tsx:91` (`max_marks: parseFloat(aMax) || 100` — the direct-Supabase creation path, which does not reuse the Zod schema).

**What's wrong:** There is no `CHECK (max_marks > 0)` anywhere at the database level, so the only thing standing between a zero-or-negative `max_marks` and a live `assessments` row is app-layer validation — and that validation exists on exactly one of the two paths that can create an assessment. `GradebookClient.tsx:91`'s `parseFloat(aMax) || 100` only catches falsy results (`0`, `NaN`, empty string) by falling back to `100` — it does **not** catch a genuinely negative input like `"-5"`, which `parseFloat` returns as `-5` (truthy, so the `||` fallback never triggers), and there is nothing else in that write path to reject it before the `insert()` call.

**Impact:** Already-live: `packages/types/src/grading.ts`'s `calculateSubjectAverage()` already has to defensively drop any row with `maxMarks <= 0` from its term-average calculation (confirmed during this audit) — meaning this exact gap has presumably already been anticipated by whoever wrote that function, even though the root cause (no DB guard, one incomplete app-layer guard) was never itself fixed or documented until now. Not a security issue — worst case is a malformed assessment silently excluded from term averages, not incorrect data exposure.

**Why not fixed here:** Out of scope for an audit-only PR phase — directly relevant to (and should inform) Bucket 1 PR 2's own Phase 2 score-normalization work, which will need its own explicit zero/negative guard regardless of whether this underlying gap is ever closed, since it can't assume `max_marks` is trustworthy.

**Suggested fix:** Add `CHECK (max_marks > 0)` to `assessments` via an additive migration (idempotent `ALTER TABLE ... ADD CONSTRAINT ... CHECK (max_marks > 0) NOT VALID` then `VALIDATE CONSTRAINT` if any existing bad rows need tolerating, otherwise a plain `ADD CONSTRAINT`), and fix `GradebookClient.tsx:91` to reuse the same `.positive()` validation `CreateAssessmentInput` already has, rather than a bespoke `parseFloat(...) || 100` fallback.

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

### BUG-5: `notifications.acknowledged_at` migration was never actually applied to production, despite `_migration_log` claiming it was

**Found during:** 2026-07-29/30, Bucket 1 PR 1 (unified dashboard feed) — surfaced as a live e2e test failure (`PATCH /dashboard-feed/read` test) when porting the `/notifications` page's existing Alerts query into a new backend service. The query is unchanged from what the page has been running in production — this bug predates this PR entirely, it was just never caught by an e2e test until now.

**File:** `supabase/migrations/20260527000019_notification_ack.sql` (the migration, never actually run), `apps/api/src/notifications-aggregation/notifications-aggregation.service.ts`'s `buildAlerts()` (where it surfaced), `apps/web/app/(dashboard)/notifications/NotificationsView.tsx`'s `AcknowledgeButton` (the feature this column exists for).

**What was wrong:** `public.notifications` did not have an `acknowledged_at` column in the live database — confirmed directly via a `SELECT acknowledged_at FROM notifications LIMIT 1` probe, which returned Postgres error `42703: column notifications.acknowledged_at does not exist`. But `_migration_log` had a row for `20260527000019_notification_ack.sql` (which does `ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ`), so `infra/scripts/check-migrations.sh` reported no drift — a **false negative**. Almost certainly explained by how the log was built: sub-sprint 4's migration-tracking system backfilled all 72 pre-existing filenames into `_migration_log` on the assumption each had already been applied (verified in bulk by checking most tables existed, not by checking every single column of every single migration) — this is the one column that assumption got wrong.

**Impact:** Real, was live. Any query anywhere that selected `notifications.acknowledged_at` — the `/notifications` page's Alerts section (`apps/web/app/(dashboard)/notifications/page.tsx`) being the main one — had been failing/returning no rows in production the whole time. `AcknowledgeButton` (used for `ABSENT_STUDENT` notifications) could never have actually rendered correctly, since the page-level query it depends on errored out first.

Broader than initially scoped: `buildAlerts()`'s `notifications`-table query failing meant **regular `notifications` rows never contributed to the dashboard feed or the bell's unread count at all** (platform messages, conversations, and reminders were unaffected — separate queries within the same function/service). Confirmed via three live e2e failures, all with the identical shape ("expected count to include a just-queued notification, got the pre-existing count unchanged"), all blocked on this one column, none a regression from Bucket 1 PR 1's own logic:
- `apps/api/test/dashboard-feed.e2e-spec.ts` — `PATCH /dashboard-feed/read marks a notification read...`
- `apps/api/test/cross-tenant.e2e-spec.ts` — `Notification bubble: a new notification takes the count from 0 to 1...`
- `apps/api/test/cross-tenant.e2e-spec.ts` — `Notification bubble: marking one notification read never affects another user's count...`

**Fix (2026-07-31, applied directly by the project owner against production):** `ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;` — the exact statement `20260527000019_notification_ack.sql` already contained. Idempotent, safe, no data migration needed since the column is purely additive and nullable.

**Verification:** Live column-existence probe against production (`SELECT acknowledged_at FROM notifications LIMIT 1`) confirmed the column now exists. Re-ran the three previously-blocked tests live: `dashboard-feed.e2e-spec.ts` went from 4/5 to **5/5 passing**; `cross-tenant.e2e-spec.ts -t "Notification bubble"` went from 1/3 to **3/3 passing**. Full live e2e regression (`pnpm test:e2e`, all spec files) re-run afterward to confirm no other drift — see `EXECUTION_PLAN.md`'s Bucket 1 entry for the final suite-wide count.

**Follow-up done (2026-07-31):** investigated why `check-migrations.sh` — the tool built specifically to catch this class of drift — missed it. Root cause: the registry row for this migration and the check itself were both introduced in the *same* commit (`20260728000072_migration_log.sql`'s 72-file backfill, 2026-07-29); the backfill's claim of having verified every column was a manual, unchecked assertion, wrong for this one file, so the check was structurally blind to this specific drift from the moment it existed — never a failure that got ignored. Full postmortem now lives in `check-migrations.sh`'s own header comment. The suggested spot-check was also done, in full rather than "a handful": every `ADD COLUMN` target across all 76 migration files on disk was extracted and individually verified live — **24/24 present, no second instance found.** The script itself was fixed with a new heuristic (`STALE_COLUMN`) that checks the 5 most recent migrations' `ADD COLUMN` targets against the live schema on every CI run going forward, plus a new regression test suite (`infra/scripts/tests/check-migrations.test.sh`) so the checker's own correctness is no longer untested. See the `EXECUTION_PLAN.md` entry dated 2026-07-31 for the full writeup.

---

### BUG-6: a new message inflates the unread badge by 2, not 1, and reading the thread only clears half of it

**Found during:** 2026-07-31, Bucket 1 PR 1 (unified dashboard feed) e2e verification — a newly-written test (`cross-tenant.e2e-spec.ts`, "Task 7: unread-count includes unread conversations, and drops after marking read") asserted `withUnread.count === baseline.count + 1` after one fresh message; it consistently got `+2` instead, even in isolation with no other tests running (ruled out as a flake). Root-caused by reading the actual query paths, not by adjusting the assertion until it passed.

**File:** `apps/api/src/messaging/messaging.service.ts`'s `_insertMessage()` (queued the duplicate signal) and `markRead()` (only cleared one of the two), `apps/api/src/notifications-aggregation/notifications-aggregation.service.ts`'s `getUnreadCount()` (summed both without deduping).

**What was wrong:** Sending a message created **two independent, never-reconciled "you have an unread message" signals** for the recipient:
1. `_insertMessage()` incremented the conversation's own `{parent,teacher,admin}_unread_count` column (counted by `buildConversations()`).
2. The same call also did `this.notifications.queue([{ type: 'NEW_MESSAGE', ... }])`, inserting an unread row into the plain `notifications` table (counted by `buildAlerts()`, since `buildAlerts()` fetches all `notifications` rows with no `type` filter).

`getUnreadCount()` summed `unreadAlerts + feed.conversations.length + feed.reminders.length` — both signals counted, so one message added 2 to the badge, not 1. Confirmed pre-existing, not introduced by Bucket 1 PR 1: `git diff HEAD` on the now-deleted `NotificationsService.unreadCount()` showed the exact same shape — `alertsUnreadCount()` (all unread `notifications`, no type filter) added to `conversationsUnreadCount()` — so this double-count was live since before that PR touched anything.

Worse, they never reconciled: `messaging.service.ts`'s `markRead()` (called by `PATCH /messaging/conversations/:id/read`, which is all `ThreadClient.tsx` called when a user opened a conversation) only zeroed the conversation's unread counter — it never touched the paired `NEW_MESSAGE` row in `notifications`. That row only cleared via a separate, explicit `PATCH /dashboard-feed/read` call, which nothing in the message-reading flow triggered. So after a user read a message thread normally, the badge dropped by 1 (the conversation's contribution) but stayed permanently inflated by 1 per message ever received, until the user separately found and dismissed each `NEW_MESSAGE` alert in the feed/notifications page.

**Impact:** Real, live, user-facing — the bell badge and dashboard feed's unread count both over-counted and under-cleared for every message anyone received. Not a security/data issue.

**Fix (2026-07-31, Option B from the review — cascade, not dedupe):** `NEW_MESSAGE` notification rows stay in `notifications` (the unified feed needs them to show messages as feed items), but read-state is now cascaded between the two signals in both directions. New plain module `apps/api/src/messaging/message-read-cascade.ts` (not a NestJS provider — matches the `feed-cache.ts` precedent, avoids any circular-module risk) exports two single-table-`UPDATE` functions:
- `cascadeConversationReadToNotifications()` — called from `MessagingService.markRead()` (every surface that marks a conversation read already funnels through this one method), marks the matching unread `NEW_MESSAGE` row(s) read.
- `cascadeNotificationReadToConversation()` — called from `NotificationsAggregationService.markRead()` (every surface that marks a notification read, including bulk "mark all," already funnels through this one method), zeroes the caller's own unread column on the linked conversation.

Neither function calls the other or calls back into either service's `markRead()` — each is a targeted single-table write, so there is no code path for a cascade to re-trigger a cascade. This is a structural guarantee, not a runtime flag. Both use the caller's RLS-scoped client, so a crafted/guessed id from another user or school naturally matches zero rows (`notif_update`/`conv_update` RLS policies), with no new app-level tenant check needed.

**Verification:** new unit tests (`apps/api/src/__tests__/message-read-cascade.spec.ts`, 7 cases — asserts the exact filters each direction builds) and a `markRead()`-level unit test in `notifications-aggregation.service.spec.ts` (2 cases — cascades only when a `NEW_MESSAGE` id is present); 142/142 API unit tests passing. Five new live e2e cases in `apps/api/test/dashboard-feed.e2e-spec.ts` (forward cascade, reverse cascade, bulk, idempotency, cross-tenant) — **10/10 passing** against real Supabase. `cross-tenant.e2e-spec.ts`'s "Task 7: unread-count includes unread conversations..." test (the one that originally caught this bug) updated to assert full reconciliation (`baseline + 2` after sending, back to exactly `baseline` after conversation mark-read) instead of the previously-documented broken `+1` floor. See `EXECUTION_PLAN.md`'s entry dated 2026-07-31 for the full writeup.

---

## Resolved / re-verified (not bugs)

For traceability — items raised as open questions in a prior PR's follow-up notes, re-examined during the 2026-07-25 audit and confirmed safe, not touched:

- **`report-card/[studentId]` and `print/report-card/[studentId]` route param trust** — confirmed the `studentId` URL param is used unvalidated in app code, but is protected transitively: the first query in both pages is against `students`, gated by `students_select` RLS (own-row for STUDENT, guardian-linked for PARENT), so a tampered ID returns `student: null` before any grade/attendance data is ever fetched. `grade_select` and `attendance_records_select` independently enforce the same restriction on the data itself. Matches and confirms the identical conclusion already recorded for these two routes in `docs/audits/2026-Q3-analytics-audit.md`.
- **`middleware.ts`'s `user_metadata.role` fast path** — re-examined for staleness risk (a role change not yet reflected in session metadata). The fast path only trusts a `user_metadata`/`app_metadata` role value if it matches a known `ROLE_HOME` key, and any unrecognized/stale value falls through to a live `users.role` DB lookup. The residual gap that *does* exist (a `null` role result not being redirected) is BUG-1 above, not a staleness issue specifically.
