# CLAUDE.md Expansion — Phase 1 Audit

**Scope:** Propose a 9-section structure for expanding `CLAUDE.md` (currently
only §6, bulk-migration verification), based on directly-verified evidence
rather than conventional NestJS/Next.js assumptions.

**Status:** Phase 1 (audit) complete. **No `CLAUDE.md` changes in this PR.**
Awaiting explicit review before Phase 2 writes the actual document.

## Summary

| Finding | |
|---|---|
| Scope correction | `apps/` has **3** directories, not the 2 the task named — `apps/mobile` exists, unaddressed anywhere in the task's framing |
| `packages/ui` | Essentially empty — one commented-out export. Do not document as a working component library |
| Deployment target | **Genuinely conflicting across 5 documents** — Render, Vercel+Railway, and a third Railway-railpack path all have supporting evidence. Open question, not resolved here |
| `current_user_id()` | Silently redefined by a later migration (auth UUID → `users.id`) — the *only* correct version to cite is the later one; citing the original definition would document a function that no longer behaves that way |
| `forUser()` vs `admin` | Stated rule exists and is mostly followed, but real counts (127 vs 189) and several uncommented/inconsistent exceptions found — messier than "clean pattern" |
| No `RolesGuard` anywhere | Confirmed by a zero-match grep — every role check is inline in service methods, not a guard |
| `ZodValidationPipe` dominant but not universal | 26/33 controllers; 7 have zero runtime validation; global `class-validator` `ValidationPipe` is a confirmed no-op (zero DTOs exist for it to validate) |
| Unit tests are not shallow | Hand-rolled `FakeQueryBuilder` DB emulator, copy-pasted across ≥3 spec files rather than shared |
| No shared Modal/Spinner/react-hook-form | All confirmed absent or dead — every form/modal/loading-state is hand-rolled per-component, with real inconsistencies between instances |

---

## §1 Project overview and architecture

**Proposed content:** What SKULI is; the Turborepo/pnpm monorepo layout;
which packages are real vs vestigial; deployment targets (pending the open
question below).

**Evidence gathered:**
- `apps/` has **3** directories: `api`, `mobile`, `web` — the task's framing
  only mentioned 2. `apps/mobile` needs the project owner's call on whether
  it's active (see Open questions).
- `packages/` has 4:
  - `packages/db` — `packages/db/package.json:5-6` (`main`/`types` →
    `dist/index.js`/`src/index.ts`); `packages/db/src/index.ts:3-4` is
    literally `export * from '@prisma/client'; export { PrismaClient }`.
    Confirmed elsewhere in this project's history: not used as a runtime
    query layer by either app — everything queries Supabase directly.
  - `packages/types` — real, actively used (§8).
  - `packages/ui` — **essentially empty**. `packages/ui/src/index.ts:20`'s
    only export is commented out
    (`// export { Button } from '../components/button';`).
    `packages/ui/components/` contains only `badge.tsx` and a README.
  - `packages/config` — `packages/config/package.json:5`,
    `"files": ["eslint", "tsconfig"]` — no `main`, no `src/`; just shared
    ESLint/tsconfig presets consumed via `workspace:*`.

**Inconsistencies found:** None beyond the scope correction above.

**Open questions:**
- **Deployment target — 5 documents disagree, not resolved here:**
  - `RENDER_DEPLOYMENT.md:1,3-9`: "This repo is a pnpm/turborepo monorepo
    with two deployable services: `apps/api`... / `apps/web`..." — both to
    Render. `render.yaml:20-21,72-73` defines both `school-manager-api` and
    `school-manager-web` services.
  - `docs/runbooks/onboard-a-school.md:75-79`: "Deploy `apps/web` to
    Vercel... Add environment variables... plus
    `NEXT_PUBLIC_API_URL=https://your-api.up.railway.app`" — web→Vercel,
    api→**Railway**.
  - `ROADMAP.md:74`: unchecked `- [ ] Deploy apps/web to Vercel, apps/api to
    Railway/Fly`.
  - `docs/runbooks/rotate-secrets.md:18`: "Update in Vercel, Railway/Fly,
    GitHub Actions secrets."
  - `railpack.api.json`/`railpack.web.json` exist at repo root (Railway
    build configs) with no doc explaining when they're used relative to the
    Render blueprint.
  - Root `README.md` makes no deployment-target claim at all
    (`README.md:9,13` only state DB/monorepo facts).
  - This session's own earlier work (`apps/web/README-POSTHOG.md`) assumed
    Vercel for web without knowing about the Render blueprint — an example
    of exactly the kind of drift this section needs to prevent going
    forward. **Needs the project owner to state which is actually current**
    before §1 asserts anything.
- **Is `apps/mobile` real or scaffolding?** Not investigated this pass —
  flagging its existence is as far as this audit went.

---

## §2 Environment and tooling

**Proposed content:** pnpm + Node version pinning; the real (narrow) scope
of the `dotenv` pattern; Vercel env var conventions; a table of every
third-party service, how each is actually called (SDK vs raw `fetch`), and
what env vars each needs.

**Evidence gathered:**
- pnpm confirmed: `pnpm-workspace.yaml:1-3` (`packages: ["apps/*", "packages/*"]`),
  root `package.json:29` `"packageManager": "pnpm@9.0.0"` (pinned, not just
  "prefer pnpm").
- Node: root `package.json:25-28` `engines: {node: ">=20.0.0", pnpm: ">=9.0.0"}`;
  `.nvmrc` = `20`. **Not re-declared** in `apps/api`, `apps/web`, or
  `apps/mobile`'s own `package.json` files — the only other place Node
  version appears is deploy-time re-pinning at `render.yaml:37-38,86-87`
  (`NODE_VERSION=20.18.0`).
- `dotenv` — **exactly 2 call sites in the entire repository**, both
  `apps/api/scripts/seed-sample-school.ts:48` and
  `apps/api/scripts/teardown-sample-school.ts:40`, both
  `dotenv.config({ path: join(__dirname, '..', '.env') })`. Not yet a
  general "standalone scripts" convention — `packages/db/prisma/seed.ts`
  doesn't call it, nothing under `infra/` does either. Document the pattern
  as scoped to `apps/api/scripts/`, not repo-wide.
- Vercel env var convention — this is already correctly documented in a
  real, existing file, `apps/web/README-POSTHOG.md`, and CLAUDE.md's §2
  should just reference/summarize it rather than duplicate: `NEXT_PUBLIC_*`
  = client-visible by design (`README-POSTHOG.md:12`); non-prefixed =
  server-only, mark Sensitive in Vercel's dashboard (`:14,28-31`); env
  changes require a redeploy (`:34`).
- Third-party services — file:line for each client's actual construction:

  | Service | Mechanism | Init | Env vars |
  |---|---|---|---|
  | Africa's Talking (SMS) | Hand-rolled `fetch`, **no SDK** | `apps/api/src/notifications/africastalking.client.ts:52-61` | `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, `AFRICASTALKING_MODE` |
  | Paystack | Hand-rolled `fetch`, **no SDK** | `apps/api/src/payments/payments.service.ts:68,108,138` | `PAYSTACK_SECRET_KEY` |
  | M-Pesa Daraja | Inbound webhook only — **no outbound client at all** | `apps/api/src/payments/mpesa-daraja.service.ts:50-65` | `MPESA_DARAJA_MODE`, `MPESA_ALLOWED_IPS` |
  | Anthropic (AI) | Real `@anthropic-ai/sdk` | `apps/api/src/ai/ai.service.ts:69-71` | `ANTHROPIC_API_KEY` |
  | PostHog | Real SDKs, both sides | Server: `apps/web/lib/posthog-server.ts:10-14`. Browser: `apps/web/components/PostHogProvider.tsx:25-40` | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (server client reuses the *public* key — see Inconsistencies) |

**Inconsistencies found:**
- Root `package.json:6-9` still has a **stale npm-style `"workspaces"`
  field** alongside `pnpm-workspace.yaml` — dead, potentially confusing to
  a reader who assumes it's load-bearing.
- 3 of 5 third-party integrations have **no SDK at all** — a reader
  expecting "find the SDK client" for Africa's Talking, Paystack, or M-Pesa
  would search for something that doesn't exist. Worth stating explicitly
  so future work doesn't go looking for an SDK to wrap.
- PostHog's server-side client (`posthog-server.ts:10`) reads
  `NEXT_PUBLIC_POSTHOG_KEY`, not a dedicated server key — `POSTHOG_API_KEY`
  is documented in `.env.example` but never read by any code (confirmed
  during the PostHog cleanup PR this session).

**Open questions:** None beyond §1's deployment-target question, which this
section's Vercel-vs-Render framing also depends on.

---

## §3 Multi-tenancy and RLS conventions

**Proposed content:** The 4 RLS helper functions and where they're really
defined (including a critical later redefinition); the real split between
`forUser()` and `admin`; the cross-tenant 404-not-403 convention;
service-role-bypasses-RLS-but-not-triggers; the `module_enabled()` /
`module_enabled_at_depth()` split from this session's own B1-4b work as a
concrete worked example.

**Evidence gathered:**
- All 4 helpers defined together in `supabase/migrations/20260522000002_enable_rls.sql:16-42`,
  all `LANGUAGE sql STABLE SECURITY DEFINER`: `current_user_id()` (:16-18),
  `current_school_id()` (:20-25), `current_user_role()` (:27-32),
  `guardian_student_ids()` (:34-42).
- **Critical correction, must be gotten right in the final doc**:
  `current_user_id()` was **redefined** in
  `supabase/migrations/20260723000047_fix_current_user_id.sql:28-33`. The
  original (`_002`) returned `auth.uid()` — the Supabase Auth UUID. The
  real, currently-active version returns `users.id` — the internal row id.
  That migration's own header states every RLS policy comparing
  `current_user_id()` against a `users.id`-typed column was **silently
  non-functional for real, non-service-role writes** from the moment it was
  introduced until this fix landed, masked because write paths mostly used
  the service-role client. CLAUDE.md must cite `_047` as the current
  definition — citing `_002` would document a function that no longer
  behaves that way.
- `forUser()` vs `admin`: real counts — **127 `.forUser(` occurrences across
  29 files, 189 `.admin.` occurrences across 30 files** (admin genuinely
  outnumbers forUser). Stated rule, `apps/api/src/supabase/supabase.service.ts:1-13`:
  "Almost every endpoint should reach for `forUser()` first. Reaching for
  `admin` is a code-review red flag — it should come with a comment
  explaining why." Legitimate concentration in `super-admin.service.ts`
  (84 occurrences — platform-tier code with no tenant JWT to scope by) and
  auth-user creation (`students/students.service.ts:107,299`,
  `guardians/guardians.service.ts:65`, which genuinely needs
  `admin.auth.admin.createUser`).
- Cross-tenant 404-not-403 — confirmed real and consistently applied, 5
  concrete examples:
  1. `apps/api/src/attendance/attendance.service.ts:131-132` —
     `if (!student || student.school_id !== userRow.school_id) throw new NotFoundException('Student not found')`.
  2. `apps/api/src/students/student-360.service.ts:37-38` — same shape.
  3. `apps/api/src/notifications/notifications.service.ts:393-394` — same
     shape.
  4. `apps/api/src/classes/classes.service.ts:131-132` — assist-mode
     variant, comment at `:129-130` ("a cross-school class id smuggled into
     the URL while in assist mode").
  5. `apps/api/src/classes/classes.service.ts:146-147` — same, for teacher.
- Service-role-bypasses-RLS-not-triggers: `homework_grade_within_max_check`
  and `grades_block_direct_edit_on_linked` (both cited in earlier session
  work), plus a third example from this session's own B1-4b work:
  `school_modules_check` (`supabase/migrations/20260721000023_module_registry.sql:54-89`)
  fires on every `school_modules` write regardless of caller role,
  including service-role.
- The `module_enabled()`/`module_enabled_at_depth()` split
  (`supabase/migrations/20260728000088_module_enabled_recursive_dependencies.sql`,
  from this session's own B1-4b implementation) is a real, directly-lived
  example of a function-signature gotcha — cited fully in §6.

**Inconsistencies found:**
- The `forUser()`/`admin` split is **messier than the stated rule**, not a
  clean pattern to present without caveats:
  - `apps/api/src/attendance/attendance.service.ts:171` uses `admin` with
    **no explaining comment**, mid-way through an otherwise `forUser`-scoped
    method, purely to hydrate reviewer roles.
  - `attendance.service.ts:207` writes an `audit_logs` row via `admin`,
    while `apps/api/src/quizzes/quizzes.service.ts:117,156` write to the
    **same table for the same kind of action** via the user-scoped client —
    two services doing the identical thing two different ways.
  - `apps/api/src/homework/homework.service.ts:129-134`: inside one
    `create()` method, the ADMIN-role branch queries `teachers` via `admin`
    while the TEACHER-role branch (`:124-125`) does the identical lookup
    via the user client.
  - `apps/api/src/guardians/guardians.service.ts:78,104,134,135`: post-signup
    writes all via `admin`, only `:76` carries an explaining comment.

**Open questions:** None — this section's findings are conclusive enough to
write directly, caveats and all.

---

## §4 API module conventions (NestJS)

**Proposed content:** The module-per-feature triad as the common case, with
its real exceptions; guard usage and ordering; the real (Zod-based, not
class-validator) validation mechanism and its gaps; the 3 different service
access-check shapes that coexist.

**Evidence gathered:**
- `apps/api/src/` has 38 feature-named subdirectories (full list in the
  raw investigation notes). 4 checked in detail:
  - `ai/`, `super-admin/` — exact `<feature>.{module,controller,service}.ts`
    triads.
  - `attendance/` — triad **+ `fetchers.ts`** (extra file, intentional
    pattern, see §8).
  - `students/` — triad **+ a second bolted-on service**
    (`student-360-cache.ts`, `student-360.service.ts`, `student-360.types.ts`).
  - `payments/` — 8 files (`ip-allowlist.ts`, `mpesa-daraja.service.ts`,
    `paybill-reconciliation.service.ts`, `receipt-pdf.service.ts`,
    `receipt-token.ts` + the triad).
- Guards: `AuthGuard` precedes `FeatureGuard` in **100% of the combinations
  found — zero reversals**. Combinations: `AuthGuard` alone (16 controllers
  class-level + 3 method-level-only: `auth`, `notifications`,
  `notifications-aggregation`); `AuthGuard, FeatureGuard` (6 class-level:
  `ai`, `homework`, `quizzes`, `events`, `documents`, `assessments`);
  `AuthGuard, SuperAdminGuard, PlatformPermissionGuard` (7: `super-admin`,
  `platform-users`, `platform-messages`, `platform-privileged-access`,
  `audit-logs`, `billing`, `system-health`).
  **No `RolesGuard`/`@Roles()` decorator exists anywhere** — a repo-wide
  grep for `RolesGuard|@Roles\(` returns zero matches. Role checks are
  100% inline in service methods (see below), not guard-enforced.
- Validation: `ZodValidationPipe`
  (`apps/api/src/common/pipes/zod-validation.pipe.ts:14-33`, throws
  `BadRequestException` on a `ZodError`) is the real, dominant mechanism —
  **26 of 33 controllers, 100 call sites total**. `class-validator` is
  **never used anywhere** (zero matches for `@IsString|@IsUUID|@IsNumber|@IsOptional`
  or `from 'class-validator'`), despite `apps/api/src/main.ts:49` installing
  a global `new ValidationPipe({transform:true, whitelist:true})` — with no
  class-validator DTOs anywhere for it to validate, this is a confirmed
  no-op (`main.ts:48`'s own comment acknowledges Zod is the real, per-route
  mechanism). 7 controllers have **zero runtime validation** at all — raw
  inline `@Body() body: {...}` types: `ai`, `auth`, `notifications`,
  `notifications-aggregation`, `payments`, `audit-logs`, `system-health`.
  Several other controllers are a genuine mix (Zod on some routes, none on
  others) rather than cleanly one or the other.
- Service access-check pattern — **3 different shapes coexist**:
  1. `apps/api/src/quizzes/quizzes.service.ts:19,22-25` — resolves via
     `this.supabase.currentUserRow(accessToken, 'id, role')`, throws
     `ForbiddenException` inline.
  2. `apps/api/src/homework/homework.service.ts:109,112-113` — raw-queries
     `.from('users').eq('auth_id', authUserId)` directly instead of using
     `currentUserRow()`, for the same kind of check.
  3. `apps/api/src/students/students.service.ts:95,97,172,174,209,211` —
     centralizes into a `requireAdmin(accessToken)` helper called from 3
     methods — but that same file's `list()` method (`:80-93`) has **no
     access check at all**, relying purely on RLS.

  All service methods take `accessToken: string` (never a pre-resolved
  user object) and self-authorize; guards only ever prove
  authenticated + module-enabled, confirmed by
  `apps/api/src/common/guards/feature.guard.ts:4-8`'s own comment: "Not the
  real security boundary — that's `module_enabled()` folded directly into
  RLS."

**Inconsistencies found:**
- `apps/api/src/privileged-access/` **breaks the module-naming convention
  outright** — the module file is `privileged-access.module.ts`, but its
  controller and service are `platform-privileged-access.controller.ts`/
  `.service.ts` (a different prefix within the same module directory).
- `apps/api/src/audit/` and `apps/api/src/schools/` exist as directories
  but contain **zero `.ts` files** — dead/empty, worth flagging so future
  work doesn't assume they're real modules.
- `apps/api/src/payments/payments.controller.ts` applies
  `@UseGuards(AuthGuard, FeatureGuard)` **11 separate times at method
  level** (lines 28, 40, 105, 114, 123, 137, 150, 164, 173, 183, 191, 202)
  instead of once at class level, unlike every other multi-guard
  controller.
- The 3 service-access-check shapes above, and `students.service.ts:list()`'s
  missing check specifically, are worth a direct callout — a reader copying
  any *one* of the 3 patterns as "the" convention would be wrong for at
  least 2 of them.

**Open questions:** Should CLAUDE.md pick one of the 3 access-check shapes
as the go-forward standard, or just document that all 3 currently exist?
Recommend documenting current state only in Phase 2, since picking a
winner is a design decision for the project owner, not something an audit
should decide.

---

## §5 Schema conventions

**Proposed content:** Naming inconsistencies, timestamp/soft-delete
conventions, the tenant column, and — the most valuable content for this
section — concrete, previously-undocumented schema drift discovered by
querying the live database directly rather than trusting migration files.

**Evidence gathered (all from this session's own direct, live work — seed
script and B1-4b sessions, not re-derived from grep this pass):**
- Table naming: `behaviour_points` (British) vs `behavior_incident_reports`
  (American) — real, unresolved inconsistency, both spellings correct as
  written in their respective files.
- Missing `updated_at NOT NULL` defaults on `classes`, `subjects`,
  `fee_balances` — this is not a theoretical concern, it **crashed the
  sample-school seed script's first live attempt** this session
  (`Missing required environment variable` was a separate, later bug; this
  one was `null value in column "updated_at"... violates not-null
  constraint`), root-caused and fixed in
  `apps/api/scripts/lib/seed-structure.ts`.
- `payment_records.payment_method` has an **untracked, lowercase-only CHECK
  constraint** (`'cash'`, not `'CASH'`) — discovered only by querying
  `pg_constraint` directly against the live database via a throwaway Prisma
  script; no migration file documents this constraint's exact allowed
  values.
- `source_type`/`source_id` linked-assessment pattern on `assessments` —
  added by `supabase/migrations/20260728000081_assessments_source_link.sql`,
  enforced by the `grades_block_direct_edit_on_linked` trigger referenced
  in §3/§6.
- Standard, unremarkable-but-worth-stating conventions: tenant column
  `school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE`;
  soft-delete via nullable `deleted_at TIMESTAMPTZ`, filtered with
  `deleted_at IS NULL` in application code (not RLS-enforced universally —
  didn't verify this claim exhaustively this pass).

**Inconsistencies found:**
- **Schema drift between migration files and the live database is a
  recurring, confirmed pattern in this project**, not a one-off — the
  `payment_records.payment_method` constraint above, and (from earlier
  session context, referenced but not re-verified this pass)
  `documents.scope_type`-related drift. This is worth its own callout as a
  standing operating principle: **when in doubt, verify live via direct SQL
  (`pg_constraint`, `pg_proc`, `information_schema`) — do not assume a
  migration file is ground truth for what's actually enforced today.**

**Open questions:** None — recommend writing this section largely as-is
from the above, since every claim is already independently verified from
direct experience rather than a single investigation pass.

---

## §6 Database migrations (extends the existing §6)

**Proposed content:** Keep the existing bulk-migration-verification
paragraph unchanged; add 3 new subsections, each anchored to a real
incident from this session rather than generic advice.

**Evidence gathered:**
1. **Before/after verification query pattern.** Concrete template: capture
   a `SELECT` reflecting current behavior, apply the migration, re-run the
   identical `SELECT`, diff the two result sets — treat any unexpected
   diff as a blocking finding, not a warning. This exact discipline is what
   caught the function-overload bug below, in this session, before it
   shipped.
2. **Function-overload gotcha.** `CREATE OR REPLACE FUNCTION foo(a, b, c)`
   does **not** replace `foo(a, b)` — Postgres treats a changed argument
   list as a distinct overload, leaving the original signature's callers
   (in this case, 30+ RLS policies and every `FeatureGuard`/`.rpc()` call
   site) suddenly ambiguous ("function ... is not unique"). Real incident,
   fully documented in
   `supabase/migrations/20260728000088_module_enabled_recursive_dependencies.sql`'s
   own header comment: the fix kept the original 2-argument
   `module_enabled(uuid, text)` signature completely unchanged and moved
   the new recursive logic into a separately-named function,
   `module_enabled_at_depth(uuid, text, int)`, specifically to avoid this
   trap. This is the single best concrete example available in this
   codebase for this rule — cite it directly rather than describing the
   gotcha abstractly.
3. **Service-role bypasses RLS, never triggers.** Three concrete triggers
   to cite: `homework_grade_within_max_check`,
   `grades_block_direct_edit_on_linked`, and `school_modules_check`
   (`supabase/migrations/20260721000023_module_registry.sql:54-89`) — all
   fire regardless of caller role, including service-role, which is easy to
   forget when writing an admin-only script that assumes `admin` means
   "bypasses everything."
4. **`current_user_id()`'s silent redefinition** (§3) is a second worked
   example for the same underlying principle as #1/#2: a migration file
   describes intent at the time it was written, not necessarily what's
   true in production today. Recommend citing both incidents together as
   "why this project verifies live, not just reads migration files."

**Inconsistencies found:** N/A — this section only adds new content to an
existing, already-approved paragraph.

**Open questions:** None.

---

## §7 Testing conventions

**Proposed content:** Real file-layout conventions (both of them — this
codebase doesn't have just one); an honest, corrected characterization of
what each test tier actually mocks; two new rules, each anchored to a
specific incident from this session.

**Evidence gathered:**
- File layout: `apps/api/src/__tests__/` — 19 flat `*.spec.ts` files
  (no subdirectories). `apps/api/test/` — 14 files, e2e specs plus Jest
  config (`jest-e2e.json`, `jest.setup.ts`). `apps/web` has **both**
  colocated and centralized tests simultaneously: colocated examples
  confirmed by directory listing — `components/DashboardFeed/DashboardFeed.tsx`
  + `DashboardFeed.test.tsx`; `app/(dashboard)/student/tutor/page.tsx` +
  `page.test.tsx`; `app/print/report-card/[studentId]/CommentForm.tsx` +
  `CommentForm.test.tsx`. Centralized: `lib/__tests__/{api,days,middleware,roleBadges,schoolTime}.test.ts`.
- **Correction to the conventional "unit tests are shallow" narrative**:
  `apps/api/src/__tests__/homework.service.spec.ts:1-32` hand-builds a real
  `FakeQueryBuilder` implementing `select/update/insert/delete/eq/not/limit/order/maybeSingle/single`
  — a genuine in-memory DB emulator, not a thin jest mock. This exact
  ~30-line class is **copy-pasted across at least 3 spec files**
  (`homework.service.spec.ts`, `quizzes.service.spec.ts`,
  `notifications-aggregation.service.spec.ts`) — each file's own header
  comment acknowledges the duplication and cites the "established pattern"
  in the others, rather than extracting a shared helper.
- e2e tier: `apps/api/test/cross-tenant.e2e-spec.ts:1-8`'s own header
  states, verbatim, that it "Uses the real Supabase project — creates
  isolated test data in `beforeAll`, fires real HTTP requests, deletes
  everything in `afterAll`." Confirmed real `createClient`/`AppModule`
  imports, no mocking at this tier at all.

**Inconsistencies found:**
- The 3-file `FakeQueryBuilder` duplication above is real, acknowledged debt
  (each file admits it in its own comments) — worth naming directly rather
  than presenting the unit-test tier as cleanly organized.
- `apps/web`'s dual colocated/centralized test-file convention — neither is
  "the" pattern; both coexist today.

**New rules to add, each with the incident that motivated it (not generic
testing advice):**
- **Verify third-party integrations actually deliver end-to-end — passing
  type-check and lint is not sufficient.** This session's PostHog cleanup
  found the `/ingest` reverse-proxy rewrite didn't exist in
  `next.config.js` at all (a stale comment claimed a dependency provided it
  automatically; reading that dependency's actual source showed it only
  handles source-map upload). This had presumably shipped and passed every
  prior `tsc`/lint check, since neither would ever catch a missing runtime
  route. Caught only by reading the actual installed package source and
  then proving the fix live — `POST /ingest/decide` returning PostHog's own
  401 response, not Next.js's 404.
- **For destructive/irreversible operations, verify results via an
  independent code path, not the operation's own self-check.** This
  session's sample-school seed/teardown 3-cycle live verification
  deliberately used raw `curl` against Supabase's PostgREST/GoTrue REST
  APIs directly to confirm teardown left zero residual rows, rather than
  trusting the teardown script's own internal verification function — so
  that a bug present in both the delete logic and its own check couldn't
  produce a false "all clear."

**Open questions:** Should the 3 duplicated `FakeQueryBuilder` copies be
extracted into a shared test helper as part of this doc's own
recommendations, or is documenting the current duplication as a known,
accepted pattern sufficient for now? Recommend leaving this as an explicit
open question rather than prescribing a refactor inside a documentation PR.

---

## §8 Shared code patterns

**Proposed content:** What's actually in `packages/types/src/`; the real,
narrow rule for what gets promoted there; a corrected description of the
"fetcher" pattern as per-app duplication of *logic* alongside genuine
sharing of pure calculations.

**Evidence gathered:**
- `packages/types/src/` contains `attendance-rate.ts`, `grading.ts`,
  `index.ts`, and a real `schemas/` directory with **34 files** organized
  by domain (announcement, assessments, attendance, billing, fees,
  gradebook-link, homework, etc.) — `index.ts:15-42` re-exports all of
  them plus the two calculator modules.
- Concrete calculator signatures, all pure (no I/O):
  `calculateAttendanceRate(input): AttendanceRateResult` (`attendance-rate.ts:52`),
  `calculateStudentTermAverage(input): StudentTermAverageResult` (`grading.ts:133`),
  `normalizeScore(sourceScore, sourceMaxScore, assessmentMaxMarks): number` (`grading.ts:53`),
  `calculateSubjectAverage(scores): number | null` (`grading.ts:26`),
  `assignLetterGrade(pct): 'A'|'B'|'C'|'D'|'E'` (`grading.ts:34`).
- **`hashForAnalytics` is deliberately NOT in `packages/types`** — it lives
  at `apps/web/lib/analytics/anonymize.ts:14`, using Node's `crypto` module
  directly, which cannot be bundled into client code. A useful negative
  example: not everything reusable-in-principle belongs in the shared
  package — anything that must stay server-only, or that depends on a
  runtime one app has and the other doesn't, stays app-local by necessity.
- Fetcher pattern: only one file is literally named `fetchers.ts`
  (`apps/api/src/attendance/fetchers.ts`); the web equivalents are
  per-function files (`apps/web/lib/attendance/fetchAttendanceRateInputs.ts`,
  `fetchAttendanceData.ts`, `apps/web/lib/grading/fetchStudentTermAverage.ts`).
  Confirmed **near-verbatim duplicate logic** between the API and web
  versions of `fetchAttendanceRateInputs` (the date-range-expansion loop in
  particular) — each independently reimplements the same Supabase query
  shape, with the API version taking 2 clients (user + admin, since
  `absence_requests` needs service-role) and the web version taking 1.

**Inconsistencies found:** None structural — the duplication above is
consistent and deliberate (documented in the API fetcher's own header,
`apps/api/src/attendance/fetchers.ts:10-18`), not accidental drift.

**Open questions:** None. Recommend stating the actual rule plainly:
**pure functions with no I/O → `packages/types`; anything that constructs
or calls a Supabase client stays app-local**, even if the two apps'
versions look nearly identical — this corrects the task's own vaguer "if
both apps need it, packages/types" framing, which doesn't match what this
codebase actually does.

---

## §9 Frontend conventions (Next.js 14 App Router)

**Proposed content:** Server-component-first as the dominant pattern with
its real fetching-mechanism split; `useModuleAccess()` and the "hide
entirely" gating convention (already precisely re-established by this
session's own recent work); `DeniedBanner`; and — the most actionable
content for this section — confirmed absence of shared Modal/Spinner/form
infrastructure, with concrete counts.

**Evidence gathered:**
- Server-component-first confirmed strongly: only **7 of 74** `page.tsx`
  files under `app/(dashboard)/` carry `'use client'`. Server pages fetch
  via `createClient()` from `apps/web/lib/supabase/server` (69 files import
  it); client components fetch via `apiFetch()`
  (`apps/web/lib/api/index.ts:66`, adds the Supabase session token +
  `X-Assist-Token` header + `API_BASE` prefix).
- `useModuleAccess()` (`apps/web/lib/hooks/useModuleAccess.ts:14`) returns
  exactly `{isModuleEnabled, loading}` — 6 real call sites, all confirmed
  this session (`DashboardShell.tsx:131` for nav filtering,
  `student/tutor/page.tsx:23,98` for a whole-page early-return guard —
  the only site that reads `loading` to avoid a flash — plus
  `SubmissionsClient.tsx:24,183`, `QuizBuilderClient.tsx:117,265`,
  `CommentForm.tsx:21,93`, `TodaysChecklist.tsx:106,136`). "Hide entirely,"
  never disable/grey-out, confirmed as the universal convention across all
  6.
- `DeniedBanner` (`apps/web/components/DeniedBanner.tsx`) — single-purpose,
  currently supports exactly one reason code (`'student-360'`,
  `:13-15`); both call sites (`teacher/page.tsx:79`, `admin/page.tsx:105`)
  are structurally identical.

**Inconsistencies found:**
- **A third client-side data-fetching mechanism exists** beyond
  server-Supabase and `apiFetch`: 27 files import
  `apps/web/lib/supabase/client` for direct client-side Supabase queries.
  And `apps/web/lib/api/index.ts:4`'s own header comment claims TanStack
  Query is the client-fetching convention, but only 2 files actually call
  `useQuery`/`useMutation` (`TodaysChecklist.tsx:108`,
  `lib/hooks/useDashboardFeed.ts:20,29,46,69,92`) — the real dominant
  client-side pattern is plain `useEffect` + `useState` + `apiFetch`, not
  what the code's own comment claims.
- **No shared Modal/Dialog component exists anywhere in
  `apps/web/components/`.** At least 5 independently hand-rolled overlay
  implementations found: `components/documents/RetagModal.tsx:46` (whose
  own comment at `:8-9` calls `PaybillDashboard.tsx`'s modal "the one
  existing 'real modal' precedent"), `PaybillDashboard.tsx:261` and a
  second, differently-shaped one at `:454` in the same file,
  `admin/events/EventsClient.tsx:171`, `messages/MessagesClient.tsx:254,391`,
  `teacher/homework/HomeworkClient.tsx:181,446`,
  `teacher/quizzes/QuizzesTeacherClient.tsx:363`. Inconsistent on
  `bg-black/30` vs `/40`, `role="dialog"` present in some and absent in
  others, backdrop-click-to-close present in some and absent in others; no
  focus trap or Escape-key handling found in any of them.
- **`react-hook-form` is a fully dead dependency** —
  `apps/web/package.json:28` declares `^7.52.0`, but a repo-wide grep finds
  **zero imports and zero `useForm(` calls anywhere**. Every form is
  hand-rolled per-field `useState` (e.g. `StudentsClient.tsx:33-40`, 8
  consecutive `useState('')` calls) plus a manual `try/catch/finally`
  submit handler and a local `error`/`err` string rendered as a red/rose
  `<p>` (`RetagModal.tsx:53`, `EventsClient.tsx:174`).
- **No shared Spinner/loading component exists.** `animate-spin` appears in
  only 2 files. The real convention is ad-hoc inline `Loading…` text
  (~20 occurrences, each with independently-chosen Tailwind classes — early
  return, nested ternary, and inline string interpolation all seen as
  different shapes for the same idea). The one genuinely shared piece is
  `apps/web/app/(dashboard)/loading.tsx` (Next.js's own route-level
  loading-UI convention), but it is the **only** `loading.tsx` in the
  entire `app/` tree — no per-route skeletons anywhere else.

**Open questions:** Should CLAUDE.md prescribe a single client-side
data-fetching mechanism going forward, given `apiFetch`+`useEffect`, direct
`lib/supabase/client`, and TanStack Query all currently coexist? Recommend
documenting the current state (and which one actually dominates) rather
than picking a winner unprompted — that's a framework-direction decision
for the project owner, not something this audit should decide.

---

## Open questions requiring the project owner's judgment (consolidated)

1. **Which deployment story is actually current** — Render (per
   `render.yaml`/`RENDER_DEPLOYMENT.md`), Vercel+Railway (per the
   onboarding runbook), or something else? Five documents give three
   different answers; §1/§2 cannot be written accurately without this.
2. **Is `apps/mobile` real/active or scaffolding?** Not addressed anywhere
   in the original task; needs a decision before §1 documents it either
   way.
3. **Should the 3 duplicated `FakeQueryBuilder` unit-test fakes be
   extracted to a shared helper**, or is documenting the duplication as a
   known, accepted pattern sufficient for §7?
4. **Should CLAUDE.md prescribe one client-side data-fetching mechanism**
   for §9, given `apiFetch`+`useEffect`, direct `lib/supabase/client`, and
   TanStack Query all currently coexist — or just document the current
   state without prescribing a winner?
5. **Should §4 pick one of the 3 service-access-check shapes** as the
   standard going forward, or document all 3 as currently coexisting?
