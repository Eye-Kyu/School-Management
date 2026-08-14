# Exploration Bugs — Phase 1 Audit

**Scope:** 5 bugs reported during platform exploration. Read-only investigation —
no code changes in this pass. Each bug was investigated independently via
direct code reading (parallel research passes, one per bug, synthesized here);
findings are backed by file:line citations, not guesses. Where static reading
couldn't fully confirm a root cause, that's stated plainly rather than
papered over with false confidence, per this doc's own instructions.

**Status:** Phase 1 complete. Awaiting owner review before Phase 2
(implementation).

---

## Bug 1 — Student 360 button broken (teacher interface)

### a. Reproduction

- Teacher navigates to their class roster (there is no dedicated "students
  tab" for teachers — the closest equivalent is the class attendance roster
  at `/teacher/attendance`) and clicks "View 360" next to a student.
- Expected: navigates to that student's Student 360 page.
- Actual (per report): bounces back to the teacher dashboard instead of
  showing Student 360.
- Affected roles: **Teacher** (class teacher only — the link is gated behind
  `isClassTeacher`). Admin has an equivalent, separate "View 360" link
  (`apps/web/app/(dashboard)/admin/students/StudentsClient.tsx:372`) that
  shares the same destination page and is therefore exposed to the same
  underlying defect.

### b. Suspected code location

- **Button/link:** `apps/web/app/(dashboard)/teacher/attendance/AttendanceClient.tsx:405-412`
  ```tsx
  {isClassTeacher && (
    <Link href={`/students/${student.id}/360`} className="ml-2 text-xs text-violet-600 hover:text-violet-800 transition-colors">
      View 360
    </Link>
  )}
  ```
  A plain, correctly-formed `next/link`. Not nested in a `<form>` in any way
  that would submit it (it's an `<a>`, not a `<button>`) — confirmed by
  reading the full component; the roster table it lives in is inside a
  `<form onSubmit={handleSubmit}>` (opens at line 343) whose handler does
  correctly call `e.preventDefault()`, but this is a red herring since
  `<a>` clicks never trigger form submission.
- **Destination page:** `apps/web/app/(dashboard)/students/[studentId]/360/page.tsx:68-80`
  ```tsx
  export default async function Student360Page({ params }: { params: { studentId: string } }) {
    let data: Student360View;
    try {
      data = await serverApiFetch<Student360View>(`/students/${params.studentId}/student-360`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        redirect('/dashboard?denied=student-360');
      }
      if (err instanceof ApiError && err.status === 404) {
        notFound();
      }
      throw err;
    }
    ...
  ```

### c. Root cause hypothesis — confirmed by static reading

Line 74 redirects to **`/dashboard?denied=student-360`. `/dashboard` is not
and has never been a route in this app** (`git log --all -- "*/dashboard/page.tsx"`
returns nothing; `apps/web/middleware.ts:43`'s dashboard-route regex
`/^\/(admin|teacher|student|parent|super-admin)/` doesn't match it either).
Chain of events on a genuine 403:

1. Next.js has no route for `/dashboard` → falls through to
   `apps/web/app/not-found.tsx` (generic 404, "Back to dashboard" link → `/`).
2. `/` for an authenticated user is caught by `middleware.ts:64-68`, which
   immediately redirects to the role home (e.g. `/teacher`) — **discarding
   the `?denied=student-360` query param** in the process.
3. `DeniedBanner` (`apps/web/components/DeniedBanner.tsx`) only reads
   `searchParams.denied` at its two wired call sites,
   `apps/web/app/(dashboard)/teacher/page.tsx:79` and
   `apps/web/app/(dashboard)/admin/page.tsx:105` — never mounts, since the
   param never survives the redirect chain.

End-to-end this presents exactly as "bounces back to the dashboard with no
explanation" — a 404 flash (easy to miss) followed by a silent bounce to
`/teacher`, matching the report even though the literal mechanism is a 404,
not a direct reload.

**This is not a regression.** `git log` shows `apps/api/src/students/student-360.service.ts`
and this page have exactly two commits ever, both from the original B1-4a
merge (`4844ff5`, `e49edab`, 2026-08-07) — the same commit's message even
claims *"redirects to /dashboard... picked up by DeniedBanner,"* which was
never true since `DeniedBanner` was only ever wired to `/teacher` and
`/admin`. `middleware.ts` and `not-found.tsx` haven't changed since. The bug
has been latent since merge, not introduced later — normal use likely never
exercised the 403 branch (frontend's `isClassTeacher`/backend's
`is_class_teacher_of` check use the same underlying data and should
normally agree, so 403 is an edge case, not the common path).

### d. Proposed fix scope

`apps/web/app/(dashboard)/students/[studentId]/360/page.tsx:74` needs to
redirect somewhere that actually renders `DeniedBanner`. Two options for
Phase 2 to choose between:

- **Option A:** Resolve the caller's own role in the catch block (a small
  additional lookup) and redirect to `` `/${role.toLowerCase()}?denied=student-360` ``
  — matches the existing pattern exactly, no changes to `middleware.ts` or
  `DeniedBanner`.
- **Option B:** Redirect to `/` (which middleware already correctly routes
  to the role home) and modify `middleware.ts:64-68` to forward the
  `?denied=` query param through that redirect — more general (fixes this
  class of bug for any future denied-redirect), touches shared middleware
  code so carries slightly more blast radius.

**Estimate: medium (30-90 min)** — not a single-line fix; requires deciding
between the two approaches, resolving role correctly for both teacher and
admin callers, and testing both.

### e. Testing approach

- `apps/api/test/student-360.e2e-spec.ts:218-222` already covers the 403
  case **at the API level** ("a Class Teacher of a DIFFERENT class... gets
  403") — confirms the backend behavior this bug depends on, but there is
  **no frontend test at all** for this page or its redirect behavior.
- New test needed: a check that the redirect target actually renders
  `DeniedBanner` for both `/teacher` and `/admin` callers. Given this repo
  has no wired-up Playwright config despite the `test:e2e` script existing
  in `apps/web/package.json` (`playwright test` — no `playwright.config.*`
  or spec files found anywhere in `apps/web`), this would need to be either
  a lightweight component/route test or manual QA, not a new browser e2e
  suite from scratch.

### f. Risk of regression

**Low.** Change is isolated to one page's `catch` block. `DeniedBanner` and
its two existing call sites are unmodified either way. Option B touches
`middleware.ts`, which is shared by every dashboard route — low complexity
change (forwarding one query param) but worth a careful read of the whole
middleware file before touching it, since it's high-traffic shared code.

---

## Bug 2 — Notification bubble persists after view

### a. Reproduction

- Any authenticated user opens `/notifications`, reads a message thread
  (`/messages/[id]`), or acknowledges an absence alert.
- Expected: the unread badge on the avatar (top-right profile bubble)
  decreases/clears.
- Actual: badge count stays stale until an unrelated event (tab
  switch/refocus, 60+ seconds passing, or full reload) happens to trigger a
  refetch.
- Affected roles: **all** — the badge and all three broken surfaces are
  role-agnostic.

### b. Suspected code location

- **Badge:** `apps/web/components/AvatarDropdown.tsx:27-28` — reads count
  from `useDashboardFeedUnreadCount()`
  (`apps/web/lib/hooks/useDashboardFeed.ts:28-35`), a TanStack Query hook
  (`queryKey: DASHBOARD_FEED_UNREAD_COUNT_QUERY_KEY`, `staleTime: 60_000`,
  `refetchOnWindowFocus: true`, hitting `GET /dashboard-feed/unread-count`).
  There's also a dead, never-imported `apps/web/components/NotificationBell.tsx`
  with its own independent `/notifications/unread-count` fetch — not
  actually rendered anywhere (repo-wide grep confirms zero import sites),
  a red herring, not the real badge.
- **Correctly-wired reference implementation:**
  `apps/web/components/DashboardFeed/DashboardFeed.tsx:66-75` uses the
  shared mutation hooks `useMarkFeedItemsRead`/`useMarkConversationRead`/`useMarkAllFeedRead`,
  each of which calls `invalidateFeedQueries(qc)` in `onSettled`
  (`useDashboardFeed.ts:37-40,62,85,115`) — this correctly invalidates both
  the feed and unread-count query keys.
- **Broken surfaces** (all call `apiFetch` directly, bypassing TanStack
  Query entirely — no `useQueryClient`, no `invalidateQueries`, no shared
  mutation hook):
  - `apps/web/app/(dashboard)/notifications/NotificationsView.tsx:31-37,39-42,44-61`
    — raw `apiFetch('/dashboard-feed/read', ...)` /
    `apiFetch('/messaging/conversations/${id}/read', ...)`, own local
    `useState` fed from server-rendered props.
  - `apps/web/app/(dashboard)/notifications/AcknowledgeButton.tsx:18` —
    raw `apiFetch('/notifications/${id}/acknowledge', ...)`, own local
    `useState('done')`.
  - `apps/web/app/(dashboard)/messages/[id]/ThreadClient.tsx:44,67` —
    marks conversation read on mount and on incoming realtime message via
    raw `apiFetch`, no query invalidation.

### c. Root cause hypothesis

**Confirmed, not speculative.** This is a genuine "two independent data
sources" bug: the badge's TanStack Query cache entry is only invalidated by
the one correctly-wired path (`DashboardFeed.tsx`'s own mark-read actions).
The three most common actual "viewing" surfaces — the Notifications page,
the acknowledge button, and message threads — mutate the backend correctly
but never tell the shared query cache anything changed. Since these are
all client-side navigations (no window blur/focus cycle), `refetchOnWindowFocus`
never fires either, so the badge is stuck until its 60s `staleTime` elapses
*and* some other trigger causes a refetch.

### d. Proposed fix scope

Wire `NotificationsView.tsx`, `AcknowledgeButton.tsx`, and `ThreadClient.tsx`
to invalidate `DASHBOARD_FEED_UNREAD_COUNT_QUERY_KEY` (and
`DASHBOARD_FEED_QUERY_KEY` where relevant) after their `apiFetch` calls
succeed — either by switching them onto the existing `useMarkFeedItemsRead`/`useMarkConversationRead`
hooks (more consistent, larger diff) or by adding a direct
`useQueryClient().invalidateQueries(...)` call after each existing `apiFetch`
(smaller diff, less consistent). **Estimate: medium (30-90 min)** — three
separate call sites, needs a consistent approach decided up front, plus
manual verification across all three surfaces.

Also worth flagging in the PR (not required for the fix): investigate
whether `apps/web/components/NotificationBell.tsx` should be deleted as
dead code while touching this area, or left for a separate cleanup — see
"Additional findings" below.

### e. Testing approach

- `apps/web/components/DashboardFeed/DashboardFeed.test.tsx` exists and
  covers the *correctly-wired* path as a reference for what "right" looks
  like, but there is **no test coverage at all** for
  `NotificationsView.tsx`, `AcknowledgeButton.tsx`, or `ThreadClient.tsx`.
- New tests needed: component-level tests asserting `invalidateQueries`
  (or the shared hook) is called after each of the three actions succeed —
  mirroring the pattern already established in `DashboardFeed.test.tsx`.

### f. Risk of regression

**Low-medium.** Touches the same shared TanStack Query cache keys
`DashboardFeed.tsx` already invalidates successfully — the pattern to copy
is proven and low-risk. Main risk is redundant/duplicate fetches if
invalidation is added inconsistently across the three sites (e.g. double
invalidation firing two near-simultaneous refetches) — worth a quick check
of network activity during manual testing.

---

## Bug 3 — Clicking a message from dashboard does nothing (page refreshes)

### a. Reproduction

- On a role's home page (`/admin`, `/teacher`, `/student`, or `/parent`,
  all of which render the shared `DashboardFeed` widget), click an
  alert/conversation/reminder row.
- Expected: navigates to the item (e.g. `/messages/[id]`).
- Actual (per report): page refreshes, no navigation occurs.
- Affected roles: reported role unspecified — `DashboardFeed` is shared
  across all four dashboard home pages, so potentially all.

### b. Suspected code location

- `apps/web/components/DashboardFeed/FeedCard.tsx:38` — each feed row is
  wrapped in a genuine `next/link`:
  ```tsx
  <Link href={entry.href} className="flex items-start gap-3 min-w-0">
  ```
- The "Mark read" button (`FeedCard.tsx:64-73`) is a **DOM sibling** of the
  `<Link>`, not nested inside it, and its handler correctly calls both
  `e.preventDefault()` and `e.stopPropagation()` — defensive, not
  load-bearing, since sibling elements can't intercept each other's clicks.
- `entry.href` values are built server-side in
  `apps/api/src/notifications-aggregation/notifications-aggregation.service.ts`
  (`notifHref()` at lines 109-128 for alerts, line 198 for conversations,
  literal per-role paths for reminders) — all confirmed non-empty,
  well-formed, real routes (`/messages/[id]`,
  `/admin/messages/[id]` etc. both confirmed to exist as actual pages).

### c. Root cause hypothesis — **not confirmed; requires runtime investigation**

Static reading of `DashboardFeed.tsx`, `FeedCard.tsx`, all four role
`page.tsx` files, and `DashboardShell.tsx` found:

- No `<form>` ancestor anywhere in the render tree (ruling out native
  form-submission reload).
- No stray `router.refresh()`/`window.location` call anywhere in this
  component tree.
- No click-handler race between the mark-read button and the link.
- No empty/malformed `href` values in the backend service that generates
  them.

**In short: the navigation code, as written, looks correct.** This is
being reported honestly rather than forcing a false-confidence diagnosis.
Plausible explanations that static reading cannot rule in or out:

- A CSS overlay/hit-testing issue (e.g. the "Mark read" button's hover
  hitbox at `FeedCard.tsx:67` intercepting clicks meant for the link) —
  needs browser DevTools element inspection at the actual click point.
- The destination route redirecting/erroring in a way that *looks* like a
  refresh (needs a Network tab trace: Doc request vs. XHR/fetch, full
  reload vs. SPA transition).
- A data edge case (untested notification `type`/metadata combination)
  producing an empty `href` in production that wasn't found while reading
  the reviewed service code paths.

### d. Proposed fix scope

**Cannot be scoped until reproduced.** Recommend a timeboxed ~30-minute
runtime investigation session first: reproduce in a real browser, check
DevTools Network tab (full document load vs. client transition) and
Elements tab (hit-test at click point), then re-scope the actual fix based
on what's found. Estimate for the investigation itself: **quick (<30 min)**;
the fix that follows could be quick or medium depending on findings.

### e. Testing approach

`DashboardFeed.test.tsx` exists but (per its own test name, "renders
alerts, conversations, and reminders for a role") appears to be a
render-only test, not a click/navigation test — needs verification during
Phase 2 whether it exercises actual click behavior at all. If not, a new
test asserting click-through navigation (or, more realistically given this
repo's current lack of Playwright infra, manual browser QA) will be needed
regardless of what the runtime investigation finds.

### f. Risk of regression

**Unknown until root cause is found.** If the eventual fix is CSS/hitbox
related, risk is low and localized to `FeedCard.tsx`. If it turns out to be
a backend `href`-generation edge case, risk is still fairly contained to
`notifications-aggregation.service.ts`.

---

## Bug 4 — Leaderboard requires refresh to load

### a. Reproduction

- Navigate to `/leaderboard` for the first time in a session.
- Expected: leaderboard data loads and renders.
- Actual (per report): stays blank/loading; a manual refresh makes it
  appear.
- Affected roles: role-gated feature (school/class/grade scopes vary by
  role), presumably reproducible across roles.

### b. Suspected code location

- `apps/web/app/(dashboard)/leaderboard/page.tsx` — a Server Component
  (no `'use client'`), resolves `role`/`teachableClasses`/`classTeacherOfId`/`gradeLevels`
  fully server-side (lines 6-41) and passes them as static props to
  `LeaderboardClient`. **No client-side auth/role hook is involved on this
  page at all.**
- `apps/web/app/(dashboard)/leaderboard/LeaderboardClient.tsx` — the actual
  client component (157 lines, confirmed real path). Three effects:
  - Lines 45-51: restore `window`/`scope` prefs from `localStorage`
    (`leaderboard-prefs`), mount-only.
  - Lines 53-55: persist `win`/`scope` back to `localStorage` on change.
  - Lines 57-69: **the data fetch** —
    ```tsx
    useEffect(() => {
      if (scope === 'class' && !classId) { setResult(null); return; }
      if (scope === 'grade' && !gradeLevel) { setResult(null); return; }
      setLoading(true);
      setError('');
      // ...apiFetch(`/behaviour/leaderboard?...`).then(setResult).catch(...).finally(() => setLoading(false));
    }, [win, scope, classId, gradeLevel]);
    ```

### c. Root cause hypothesis

The dependency array on the fetch effect is **complete** — every free
variable it reads (`win`, `scope`, `classId`, `gradeLevel`) is listed, and
the component has no async-resolving auth/role dependency of its own (role
data arrives as static server-resolved props). **The "missing dependency /
client auth race" framing in the original bug report is not supported by
this code.**

The best statically-confirmed defect found, which produces a genuinely
stuck-loading symptom: **neither early-return branch at lines 58-59 calls
`setLoading(false)`.** `loading` starts `true` (line 41). If a user's
persisted `localStorage['leaderboard-prefs']` has `scope: 'class'` or
`'grade'` (only `window`/`scope` are persisted, not `classId`/`gradeLevel`
— see line 54), the restore effect sets `scope` accordingly on mount while
`classId`/`gradeLevel` remain `''`, the fetch effect hits its early return,
and the UI is stuck permanently on "Loading…" instead of falling through
to the "Select a class or grade" empty state.

**Caveat, stated honestly:** this reproduces identically on every mount
*including after a refresh* for affected users, so it only partially
matches "refresh fixes it" — it may explain some but not all reports. A
secondary, lower-confidence observation: the fetch effect has no
cancellation guard (unlike `useModuleAccess.ts:17-23`'s `cancelled` flag),
so if prefs-restore changes `win`/`scope` immediately after mount, two
concurrent `apiFetch` calls can race and the wrong one can "win" — this is
intermittent, not a clean match for a *consistent* "always needs refresh"
report, and is listed as a related-but-separate finding, not the primary
fix target.

### d. Proposed fix scope

Add `setLoading(false)` to both early-return branches at
`LeaderboardClient.tsx:58-59`. **Estimate: quick (<30 min)** — a two-line
change. **Flag for Phase 2:** if this doesn't fully resolve reported cases
in QA, runtime investigation is needed (Network tab timing on first load
vs. refresh; check whether `GET /behaviour/leaderboard` fires at all on
first load, and its response status) — the cold-start timing right after a
fresh login redirect is a plausible alternate cause not ruled out by static
reading.

### e. Testing approach

**No test coverage exists at all** for the leaderboard, frontend or
backend (`find` for leaderboard-related test files returned nothing). New
test needed: a component test for `LeaderboardClient` covering the
class/grade-selected-but-no-id-yet path, asserting `loading` resolves to
`false` and the empty-selection state renders instead of an infinite
spinner.

### f. Risk of regression

**Low.** Two-line change, isolated to one component's own effect; no
shared state or cache touched.

---

## Bug 5 — Dashboard header shows previous user's name/role after logout+login

### a. Reproduction

- User A logs out, User B (different account/role) logs in on the same
  browser session.
- Expected: header immediately shows User B's name and role.
- Actual: header still shows User A's name/role until a manual refresh.
- **Scope confirmed narrow by the reporter:** only name and account type,
  only in the header/nav — not a systemic caching issue (i.e. actual
  dashboard *data* for User B is correct; just the header display lags).

### b. Suspected code location

- **Rendering:** `apps/web/app/(dashboard)/DashboardShell.tsx:164-173`
  (role badge + name span, feeding `AvatarDropdown`) and
  `apps/web/components/AvatarDropdown.tsx:69-70` (name/role repeated in
  the dropdown panel). Both are pure props — neither component fetches
  identity data itself.
- **Source of the props:** `apps/web/app/(dashboard)/layout.tsx:9-36` — a
  shared Server Component layout used by **every** dashboard role
  (`/admin`, `/teacher`, `/student`, `/parent` all route through this one
  layout segment), which does `supabase.auth.getUser()` +
  `users` row lookup and passes `full_name`/`role` down as props. No
  Context/Provider for user identity exists anywhere in `apps/web` (grep
  for `createContext|UserProvider|AuthProvider|AuthContext` returns
  nothing), and no `localStorage`/module-level cache holds this value —
  ruling out those as the mechanism.
- **Logout:** `apps/web/app/(dashboard)/LogoutButton.tsx:8-19` (note:
  actual path differs slightly from how it's commonly referenced — it
  lives under `app/(dashboard)/`, not `components/`):
  ```tsx
  async function handleLogout() {
    apiFetch('/auth/events', { method: 'POST', body: JSON.stringify({ action: 'auth.logout' }) }).catch(() => {});
    posthog.capture('user_signed_out');
    posthog.reset();
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  }
  ```
- **Login:** `apps/web/app/(auth)/login/page.tsx:109-112` (email path,
  OTP path is identical at lines 154-157):
  ```tsx
  const next = searchParams.get('next');
  const destination = next || (role && ROLE_HOME[role]) || '/';
  router.push(destination);
  ```
  A **soft** client-side navigation — no `window.location.href`, no
  `router.refresh()` around it.

### c. Root cause hypothesis

`apps/web/app/(dashboard)/layout.tsx` is dynamically rendered (uses
`cookies()`) and, under Next.js 14.2's App Router default Router Cache
behavior (`staleTimes.dynamic` = 30s, no override in `next.config.js`),
its rendered output for the shared `(dashboard)` layout **segment** can be
reused across different leaf pages within that staleness window — this
matches the bug's own confirmed scope exactly (only the shared
layout-sourced header is stale; each leaf page is its own fresh cache node
and renders correctly).

`LogoutButton.tsx:17`'s `router.refresh()` only refreshes the route
displayed *at the moment of logout* — it does not flush the `(dashboard)`
layout segment as a general cache entry for whatever *different* route the
next login's `router.push(destination)` (a soft navigation) lands on. If
that next login happens within the ~30s window, the previously-cached
layout output — old `displayName`/`role` — can be reused.

**Stated honestly:** this is a well-supported hypothesis grounded in
documented Next.js Router Cache behavior, but two things need runtime
confirmation before treating it as certain: (1) whether the actual repro
timing in the field falls within the 30s window, and (2) whether
`router.refresh()`'s invalidation scope in this exact installed Next
14.2.x patch matches the documented behavior — this has been described
inconsistently across Next.js versions/issues. Browser back/forward-cache
(bfcache) restoration was also flagged as a possible visually-similar but
mechanistically distinct contributor, worth ruling out during runtime
verification.

### d. Proposed fix scope

Force the post-login navigation to bypass any stale cached layout segment
— either add `router.refresh()` immediately after `router.push(destination)`
at both `login/page.tsx:112` and `:157` (lower UX cost, but its
effectiveness here needs the same runtime confirmation noted above since
it's the same primitive already used by logout), or replace `router.push`
with `window.location.href = destination` for guaranteed correctness at
the cost of a full page reload. **Estimate: quick (<30 min)** for either
option — a one-line change at two call sites; the `router.refresh()`
option should be tried and verified first given the smaller UX cost, with
the hard-reload option as a fallback if verification shows it doesn't
fully resolve the issue.

### e. Testing approach

No automated browser test infrastructure currently exists for this repo
despite `apps/web/package.json`'s `test:e2e` script referencing
`playwright test` — no `playwright.config.*` or spec files were found
anywhere under `apps/web`. Recommend manual QA repro for Phase 2
verification (log in as User A, log out, log in as User B on the same
role, inspect header before any refresh). Building out a first real
Playwright suite is a reasonable stretch goal but a materially bigger lift
than this fix and shouldn't block it.

### f. Risk of regression

**Low.** Both fix options are isolated to the login page's post-auth
navigation call, touching no auth/session logic itself — just how the
resulting redirect is performed. `window.location.href` trades a small
perceived-performance cost (full reload) for certainty; worth an explicit
owner call in Phase 2 on which tradeoff to accept.

---

## Additional findings — not in scope for this audit

Per instructions, flagged here rather than folded into any bug's fix scope:

- **`apps/web/components/NotificationBell.tsx` is dead code.** Confirmed
  via repo-wide grep — it defines its own independent
  `/notifications/unread-count` fetch but is never imported/rendered
  anywhere. Found while investigating Bug 2; unrelated to Bug 2's actual
  fix (which touches `AvatarDropdown`'s real data source, not this file).
  Candidate for a future dead-code cleanup, matching this repo's existing
  precedent (e.g. the `react-hook-form` removal).
- **Bug 4's secondary race condition** (no `AbortController`/cancellation
  guard on `LeaderboardClient.tsx`'s fetch effect, lines 57-69) — a real
  but lower-confidence, intermittent issue distinct from the primary
  `setLoading(false)` defect. Not proposed as part of Bug 4's fix scope
  since it's a different failure mode (an occasional race, not a
  consistent stuck-loading state) and the task's own instructions caution
  against combining distinct issues into one fix.
- **`apps/web/package.json`'s `test:e2e` script (`playwright test`) has no
  backing config or spec files anywhere in the repo.** Surfaced while
  scoping testing approaches for Bugs 1, 3, and 5. Not a "bug" per se, but
  worth the owner's awareness — any browser-level QA for this batch of
  fixes will currently have to be manual.

---

## Summary table

| Bug | Severity | Estimated fix time | Suggested commit order | Dependencies |
|---|---|---|---|---|
| 1 — Student 360 dead-end redirect | Medium | Medium (30-90 min) | 3rd | None |
| 2 — Notification badge stale count | High | Medium (30-90 min) | 4th | None |
| 3 — Dashboard click does nothing | Unknown (pending investigation) | Investigation first (~30 min), then TBD | Deferred (separate mini-session, not Phase 2) | Runtime investigation must precede any fix |
| 4 — Leaderboard needs refresh | Medium | Quick (<30 min) | 1st | None (may need follow-up if partial) |
| 5 — Stale header after login switch | Medium-High (trust impact) | Quick (<30 min) | 2nd | None |

## Suggested commit structure for Phase 2

All 5 bugs live in **entirely separate code paths** — no two share a file
or a root cause, including Bugs 2 and 3, which both touch
notification/messaging UI on the surface but were confirmed to be
different components (`DashboardFeed`/`FeedCard` for Bug 3 vs.
`NotificationsView`/`AcknowledgeButton`/`ThreadClient` for Bug 2) with
independent defects. Per the instruction not to combine bugs across
different code paths even when they seem related, **recommend 4
independent commits** for Phase 2, each individually revertable:

1. `fix(leaderboard): clear loading state when scope selection is incomplete`
2. `fix(auth): force fresh dashboard layout render after login`
3. `fix(students): redirect to a valid route on Student 360 access denial`
4. `fix(notifications): invalidate unread-count cache on mark-read/acknowledge`

**Bug 3 deferred to a separate mini-session for runtime investigation. Not
part of Phase 2's implementation. Tracked in personal notes for later.**

## Recommended fix order

Ordered ease-first, banking wins early rather than tackling the largest
fix first:

1. **Bug 4 (leaderboard)** — a 2-line fix (`setLoading(false)` in two
   early-return branches), fully isolated, no dependencies.
2. **Bug 5 (stale header)** — a 1-line change at two call sites
   (`router.refresh()` after `router.push()` in the login page), low-risk,
   high trust impact.
3. **Bug 1 (Student 360 dead-end)** — medium effort: requires deciding
   between Option A (role-aware redirect) and Option B (middleware
   query-param forwarding) before implementing, but the change itself is
   contained to one or two files either way.
4. **Bug 2 (notification badge)** — the largest of the four: three files
   need consistent treatment, plus an up-front decision on shared-hook vs.
   direct `invalidateQueries` calls. Placed last so its complexity and
   coordination overhead don't block the simpler wins ahead of it.

Starting with the two quick fixes (4 and 5, both under 15 min each) banks
progress early. Bug 1 (medium, 30-60 min) comes third. Bug 2 (largest of
the four, 60-90 min, three files, needs coordination on shared-hook vs.
direct invalidation) is last so its complexity doesn't block simpler wins.

No bug in this batch depends on another — all fixes can proceed in
parallel if the owner prefers to split work across contributors; the order
above reflects an ease-first sequencing for a single contributor working
serially.
