# PostHog Capture Call Audit

**Scope:** Cleanup PR — audit every `posthog.capture()`/`.identify()` call
site added by the unreviewed PostHog bot PR, classify for PII, strip/hash
what's needed, and document Vercel env-var setup. No new instrumentation, no
entitlement/AI changes.

**Status:** Complete. 17 call sites found via a full-repo grep (not trusted
from memory of the earlier PostHog-merge session — re-verified directly).

## Summary

| Finding | |
|---|---|
| Total capture/identify calls | 17 |
| Contain PII or a raw-ID-as-distinct-id | 4 |
| Already clean | 13 |
| **Correction to the task's own framing** | "Events flow on localhost but not on the live URL" doesn't match what the code does — the `/ingest` proxy `PostHogProvider.tsx` depends on doesn't exist anywhere (verified by reading `@posthog/nextjs-config`'s installed source directly: it only handles source-map upload, never touches routing). Capture is likely broken in every environment today, not just missing in production. Fixed in `next.config.js` as part of this PR (Task 4). |
| Related, not PII | `POSTHOG_API_KEY` is documented in `.env.example` but never read by any code — `lib/posthog-server.ts` reads `NEXT_PUBLIC_POSTHOG_KEY` instead. Flagged only; renaming is outside this cleanup's scope. |
| Related, not PII | `login/page.tsx`'s two `identify()` calls (#10/#12) are redundant with `PostHogIdentify` (#17), which fires moments later when the post-login redirect lands on a dashboard page. Both are now fixed to hash correctly, so this isn't a PII issue — left both in place rather than removing the redundancy, since de-duplicating instrumentation is outside "strip/hash PII in existing calls." |

## Call-site table

| # | File:line | Event | Properties | PII? | Recommendation |
|---|---|---|---|---|---|
| 1 | `components/PostHogProvider.tsx:35` | `$pageview` | `$current_url` (raw `window.location.href`) | **Yes, conditionally.** Dynamic route segments put a raw ID in the URL — e.g. `/students/[studentId]/360` contains a real student UUID. | **REDESIGN** — mask UUID-shaped path segments before sending |
| 2 | `app/api/export/route.ts:46` | `user_data_exported` (server-side, `posthog-node`) | `distinctId: user.id`, `{ role }` | `distinctId` is the raw Supabase auth UUID. The task requires hashed identify/distinctId values. | **HASH** the distinctId |
| 3 | `app/(dashboard)/student/quizzes/[id]/QuizTaker.tsx:150` | `quiz_submitted` | `score`, `max_score`, `question_count`, `answered_count` | No — aggregate numbers only | KEEP AS IS |
| 4 | `app/(dashboard)/teacher/attendance/AttendanceClient.tsx:205` | `attendance_submitted` | `student_count` | No | KEEP AS IS |
| 5 | `app/(dashboard)/teacher/attendance/AttendanceClient.tsx:231` | `attendance_remark_requested` | `changed_count` | No | KEEP AS IS |
| 6 | `app/(dashboard)/parent/permission-slips/PermissionSlipSigner.tsx:69` | `permission_slip_signed` | `audience` | No — a scope enum (`SCHOOL_WIDE`/`GRADE`/`CLASS`), verified against `permission_slips`' own schema, not a student identifier | KEEP AS IS |
| 7 | `app/(dashboard)/admin/fees/FeesClient.tsx:77` | `fees_csv_imported` | `imported_count`, `failed_count` | No | KEEP AS IS |
| 8 | `app/(dashboard)/admin/fees/FeesClient.tsx:115` | `fee_payment_recorded` | `payment_method` | No — amount isn't even sent on this event | KEEP AS IS |
| 9 | `app/(dashboard)/teacher/assessments/[id]/GradeEntryClient.tsx:64` | `assessment_grades_saved` | `student_count`, `marked_count` | No | KEEP AS IS |
| 10 | `app/(auth)/login/page.tsx:92` | `identify()` (email path) | `user!.id` as distinctId, `{ role }` | Raw auth UUID as distinctId | **HASH**, add `school_id` |
| 11 | `app/(auth)/login/page.tsx:93` | `user_signed_in` | `login_method` | No | KEEP AS IS |
| 12 | `app/(auth)/login/page.tsx:137` | `identify()` (phone-OTP path) | same as #10 | same | **HASH**, add `school_id` |
| 13 | `app/(auth)/login/page.tsx:138` | `user_signed_in` | `login_method` | No | KEEP AS IS |
| 14 | `app/(dashboard)/admin/payments/PaybillDashboard.tsx:251` | `paybill_payment_matched` | `amount`, `currency` | No — `payment_amount` is explicitly "sensitive but not PII" per this audit's own definition | KEEP AS IS |
| 15 | `app/(dashboard)/admin/payments/PaybillDashboard.tsx:394` | `paybill_overpayment_resolved` | `amount`, `currency` | No | KEEP AS IS |
| 16 | `app/(dashboard)/LogoutButton.tsx:14` | `user_signed_out` | none | No | KEEP AS IS |
| 17 | `components/PostHogIdentify.tsx:9` | `identify()` | `userId` as distinctId, `{ role }` | Same as #10. **Correction made during implementation: this is not dead code.** An initial grep for `<PostHogIdentify` during the audit pass found no matches and this was reported as unused — wrong, caught by `tsc --noEmit` once the props were changed (`app/(dashboard)/layout.tsx:37` renders it, unconditionally, on **every authenticated dashboard page load, for every role**). This is a more consequential call site than the login-page ones (#10/#12), which only fire once at sign-in — `tsc`, not grep, is the reliable way to find every render call site for a component. | **HASH** |

## Why #10/#12/#17 need hashing, specifically

`user.id`/`userId` here is each user's Supabase Auth UUID — not literally
`student_id`/`admission_number` from this audit's PII list, but the task's
own instruction is explicit and separate from that list: *"The `identify()`
call should identify by hashed user_id and safe properties only (role,
school_id) — not by email."* Followed literally. A student's auth UUID,
used as their permanent PostHog distinct ID, is exactly the kind of stable
per-person identifier hashing exists to protect — it would let anyone with
both PostHog access and a way to look up a specific student's auth UUID (any
admin, via the `users` table) directly attribute every event that student
ever generates to their real identity, permanently.

## Why hashing can't happen directly in the client call sites

`POSTHOG_HASH_SALT` is deliberately not `NEXT_PUBLIC_`-prefixed, unlike
every other PostHog env var in this codebase — the only reasonable read is
that it's meant to stay server-only. A salt that ships in client JS is
exactly as public as the raw ID it's supposed to obscure (visible in dev
tools, greppable in the bundle). But `posthog.identify()` must run in the
browser (posthog-js owns the session), and 2 of the 3 identify call sites
(`login/page.tsx`, `PostHogIdentify.tsx`) are `'use client'` components.

Resolved with a new authenticated route, `GET /api/analytics/identity`
(Task 2): it reads the caller's own verified session server-side, computes
the hash there, and returns `{ hashedId, role, schoolId }`. It never accepts
a client-supplied ID to hash — only ever the caller's own — which also
closes off the "hashing oracle" a generic hash-anything endpoint would be
(anyone who already knew a target's real auth UUID could otherwise fetch its
hash and correlate it against PostHog data).

## Verification plan (post-merge, per Task 3)

1. Confirm the 3 required env vars are set in Vercel (see `apps/web/README-POSTHOG.md`).
2. After deploy, open PostHog → Activity → Live events, click through the
   production site, confirm `$pageview` events arrive with masked URLs
   (`/students/:id/360`, not a real UUID) and that a signed-in session's
   events show a hashed distinct ID, not a readable Supabase UUID.
