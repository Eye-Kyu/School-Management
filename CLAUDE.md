# CLAUDE.md

Conventions for working in this repo, verified directly against the codebase
(not conventional NestJS/Next.js assumptions). Where a pattern isn't uniform,
that's stated plainly as **known debt** — a false "this is the convention"
claim is worse than an honest "three things coexist here." Evidence for
every claim below lives in `docs/audits/claude-md-expansion-plan.md`.

## 1. Project overview and architecture

**SKULI** is a Kenyan multi-tenant school management platform (Studio
Mizani). Turborepo monorepo, pnpm workspaces (`pnpm-workspace.yaml`:
`apps/*`, `packages/*`).

- `apps/api` — NestJS backend. Deploys to **Railway**.
- `apps/web` — Next.js 14, App Router. Deploys to **Vercel**.
- `apps/mobile` — **reserved for a future mobile app, not active
  development.** Contains only `README.md` (titled "Mobile app (planned for
  v0.5)," a PWA-first rationale, and a *future* `pnpm dlx create-expo-app`
  bootstrap snippet for whenever v0.5a starts) and an empty
  `.placeholder/.gitkeep` — no `package.json`, no Expo config, no `src/`.
  Don't treat it as a working app.
- `packages/db` — thin Prisma re-export (`packages/db/src/index.ts:3-4` is
  literally `export * from '@prisma/client'`). **Not a runtime query
  layer** — no app queries through Prisma; every app talks to Supabase
  directly. Prisma's only live role is `packages/db/prisma/schema.prisma`
  as a second, hand-synced description of the schema (see §5's drift
  warning) and its migration/seed tooling.
- `packages/types` — real, actively shared (§8): Zod schemas
  (`packages/types/src/schemas/`, 34 files) + pure calculators.
- `packages/ui` — **essentially empty**, do not treat as a working
  component library. `packages/ui/src/index.ts:20`'s only export is
  commented out; `packages/ui/components/` has just `badge.tsx`.
- `packages/config` — shared ESLint + tsconfig presets only, no `src/`.
- `supabase/migrations` — the real, additive-only schema history (§6).

Third-party services in use: Supabase (Postgres + Auth + Storage), Africa's
Talking (SMS), Paystack (online payments), M-Pesa Daraja (Paybill), Anthropic
(AI features), PostHog EU (product analytics). See §2 for exactly how each
is wired.

**Known debt:** four other documents (`RENDER_DEPLOYMENT.md`, `render.yaml`,
`ROADMAP.md`, `docs/runbooks/rotate-secrets.md`) describe Render and/or
Railway/Fly as deploy targets, and `railpack.web.json` exists alongside the
Railway config actually in use for `apps/api`. These are stale; Vercel
(web) + Railway (api) is the real, current setup. Correcting those docs is
a separate follow-up PR, not done here.

## 2. Environment and tooling

- **pnpm only** — root `package.json:29` pins `"packageManager": "pnpm@9.0.0"`.
  Node: `.nvmrc` = `20`, root `engines: {node: ">=20.0.0"}`. Not re-declared
  per-app; re-pinned only at deploy time.
  **Known debt:** root `package.json:6-9` still has a stale npm-style
  `"workspaces"` field alongside `pnpm-workspace.yaml` — dead, ignore it.
- **`DATABASE_URL` vs `DIRECT_URL`** — `DATABASE_URL` is the pgbouncer-pooled
  connection (app runtime); `DIRECT_URL` is the direct Postgres connection.
  Any script using `psql` directly (migration/RLS checks) needs the direct
  one — the pooled URL's `?pgbouncer=true` query param makes `psql` reject
  it outright. `infra/scripts/check-migrations.sh`'s header states this
  precisely and gives the exact invocation:
  ```
  # DATABASE_URL must be the DIRECT (non-pooled) connection string, not the
  # Prisma/app-runtime pooled one — psql rejects the pooled URL's
  # ?pgbouncer=true query parameter outright ("invalid URI query parameter").
  #
  # Example (the script itself still reads the env var named DATABASE_URL —
  # "DIRECT_URL" above refers to which connection-string *value* to put in
  # it, not to a literal DIRECT_URL variable this script recognizes):
  #   DATABASE_URL="<your DIRECT_URL value>" bash infra/scripts/check-migrations.sh
  ```
  (That comment's own "from RENDER_DEPLOYMENT.md" pointer is one of §1's
  stale references — the DIRECT_URL/DATABASE_URL semantics above are still
  correct regardless.)
- **Loading `.env` in standalone scripts** — NestJS's own bootstrap loads
  env vars automatically via `ConfigModule`, but a standalone `tsx` script
  under `apps/api/scripts/` bypasses that entirely. Load explicitly, before
  importing anything that reads `process.env` at construction time:
  ```ts
  // apps/api/scripts/seed-sample-school.ts:48
  import dotenv from 'dotenv';
  import path from 'path';
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
  ```
  This is currently a narrow pattern — exactly 2 call sites exist in the
  whole repo (`seed-sample-school.ts`, `teardown-sample-school.ts`), both
  identical. `packages/db/prisma/seed.ts` and anything under `infra/`
  don't use it. Follow this pattern for any new standalone script that
  needs Supabase credentials.
- **Vercel env vars (`apps/web`)** — `NEXT_PUBLIC_*` prefix = client-visible
  by design; anything else = server-only, mark **Sensitive** in Vercel's
  dashboard. Full setup already documented in `apps/web/README-POSTHOG.md`
  (env var table, which environments each applies to, `openssl rand -base64 32`
  for generating a secret, and a live-events verification procedure) — that
  file is the source of truth for PostHog specifically; this section is
  just the general Vercel convention.
- **Railway env vars (`apps/api`)** — dashboard-driven; no `railway.json`/
  `.toml` exists in this repo. Build/deploy is defined by `railpack.api.json`:
  install (`corepack enable && corepack prepare pnpm@9.0.0 --activate && pnpm install --frozen-lockfile`)
  → build (`pnpm turbo run build --filter=@school-manager/api...`) → start
  (`pnpm --filter @school-manager/api start:prod`). No committed doc lists
  per-var Railway setup beyond "all non-`NEXT_PUBLIC_` vars from `.env`,
  added via the dashboard" (`docs/runbooks/onboard-a-school.md:69`) —
  `apps/api` has no README of its own. If you need the exact var list,
  read `.env.example`'s non-`NEXT_PUBLIC_` entries.
- **Third-party clients** — 3 of 5 have **no SDK at all**; don't go looking
  for one.

  | Service | Mechanism | Client construction | Env vars |
  |---|---|---|---|
  | Africa's Talking (SMS) | Hand-rolled `fetch`, no SDK | `apps/api/src/notifications/africastalking.client.ts:52-61` | `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, `AFRICASTALKING_MODE` |
  | Paystack | Hand-rolled `fetch`, no SDK | `apps/api/src/payments/payments.service.ts:68,108,138` | `PAYSTACK_SECRET_KEY` |
  | M-Pesa Daraja | Inbound webhook only — no outbound client exists | `apps/api/src/payments/mpesa-daraja.service.ts:50-65` | `MPESA_DARAJA_MODE`, `MPESA_ALLOWED_IPS` |
  | Anthropic (AI) | Real `@anthropic-ai/sdk` | `apps/api/src/ai/ai.service.ts:69-71` | `ANTHROPIC_API_KEY` |
  | PostHog | Real SDKs both sides | Server: `apps/web/lib/posthog-server.ts:10-14`. Browser: `apps/web/components/PostHogProvider.tsx:25-40` | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_HASH_SALT` (server-only) |

  **Known debt:** PostHog's server-side client reuses the *public*
  `NEXT_PUBLIC_POSTHOG_KEY` rather than a dedicated server key —
  `POSTHOG_API_KEY` is documented in `.env.example` but nothing reads it.

## 3. Multi-tenancy and RLS conventions

Every tenant-scoped table has a `school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE`
column. Four RLS helper functions, all `LANGUAGE sql STABLE SECURITY DEFINER`,
originally defined together in `supabase/migrations/20260522000002_enable_rls.sql:16-42`:
`current_user_id()`, `current_school_id()`, `current_user_role()`,
`guardian_student_ids()`.

**`current_user_id()` was silently redefined — always use the current
version.** The original (`_002`) returned `auth.uid()` (the Supabase Auth
UUID). `supabase/migrations/20260723000047_fix_current_user_id.sql:28-33`
redefines it to return `users.id` (the internal row id) instead:
```sql
CREATE OR REPLACE FUNCTION public.current_user_id()
  RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT id FROM public.users
  WHERE auth_id = auth.uid() AND deleted_at IS NULL LIMIT 1;
$$;
```
Per that migration's own header: every RLS policy comparing
`current_user_id()` against a `users.id`-typed column (`parent_user_id`,
`teacher_user_id`, `sender_id`, etc.) was silently non-functional for real,
non-service-role writes from the moment it was introduced until this fix
landed — masked because every historical write path used the service-role
client. **If you're tracing what `current_user_id()` actually returns,
grep for the latest `CREATE OR REPLACE FUNCTION current_user_id` occurrence,
not the original migration** (see BUG-13 in `docs/bug-triage.md`).

**Standard RLS shape:** SELECT is same-school scoped
(`school_id = current_school_id()`); INSERT/UPDATE/DELETE is typically
same-school **and** `current_user_role() = 'ADMIN'` (sometimes `TEACHER`
too, depending on the table). **Cross-tenant lookups return 404, not 403**
— deliberate, to avoid revealing that a resource exists in a different
school. Confirmed consistent across services, not a one-off:
```ts
// apps/api/src/attendance/attendance.service.ts:131-132
if (!student || student.school_id !== userRow.school_id) {
  throw new NotFoundException('Student not found');
}
```
Same shape in `students/student-360.service.ts:37-38`,
`notifications/notifications.service.ts:393-394`, and — for assist-mode's
target-school axis rather than the caller's own school —
`classes/classes.service.ts:131-132,146-147`.

**Module-gated RLS** — for modules with no NestJS controller at all (the
frontend talks to their tables directly via Supabase), `module_enabled()`
is folded straight into the RLS policy, e.g.
`supabase/migrations/20260721000024_module_enforcement_rls.sql`'s
`document_library`/`quizzes`/`behaviour_tracking` policies. This is **not**
how NestJS-controller-backed modules like `ai_features` are gated — those
rely on `FeatureGuard` at the API layer instead (§4). Don't assume every
module has an RLS-level check; only the RLS-only ones do.

**`module_enabled()` vs `module_enabled_at_depth()`** — as of the B1-4b AI
sub-module split, `module_enabled(school_id, module_key)` keeps its
original 2-argument signature (every RLS policy and `.rpc()` call site
depends on that exact signature) and internally delegates to a
separately-named, depth-guarded recursive helper,
`module_enabled_at_depth(school_id, module_key, depth)`
(`supabase/migrations/20260728000088_module_enabled_recursive_dependencies.sql`),
which walks a module's `dependencies` array so that disabling a parent
module (e.g. `ai_features`) correctly disables its dependents even if a
dependent's own `school_modules` row is still `enabled = true`. **Always
call `module_enabled()`** (2 args) from application code or new RLS
policies — never call `module_enabled_at_depth()` directly, and never add
a 3rd argument to `module_enabled()` itself (see §6's function-overload
gotcha for why).

**Service-role bypasses RLS, never triggers.** `supabase.admin` skips every
RLS policy, but a `BEFORE INSERT/UPDATE` trigger still fires regardless of
caller role. Three confirmed examples: `homework_grade_within_max_check`,
`grades_block_direct_edit_on_linked`, and `school_modules_check`
(`supabase/migrations/20260721000023_module_registry.sql:54-89`, rejects
an unknown module key or an unmet dependency on every `school_modules`
write, admin client included).

**`supabase.forUser()` vs `supabase.admin`** — stated rule
(`apps/api/src/supabase/supabase.service.ts:1-13`): reach for `forUser()`
first; `admin` is "a code-review red flag — it should come with a comment
explaining why." Real counts: **127 `forUser()` call sites across 29
files, 189 `admin` call sites across 30 files** — admin outnumbers forUser
overall, mostly legitimately concentrated in platform-tier code with no
tenant JWT to scope by (`super-admin.service.ts` alone: 84) and
service-role-only operations like `admin.auth.admin.createUser`.

**Known debt:** the rule is followed loosely, not strictly — several
`admin` calls inside otherwise-`forUser`-scoped tenant methods carry no
explaining comment, and two services handle the identical situation two
different ways:
- `attendance/attendance.service.ts:171,207` uses `admin` uncommented
  (role hydration, an `audit_logs` insert) inside an otherwise
  `forUser`-scoped method.
- `quizzes/quizzes.service.ts:117,156` writes to the **same** `audit_logs`
  table, for the same kind of action, via the **user-scoped client**
  instead — a direct inconsistency between two services, not a
  one-off oversight in one file.
- `homework/homework.service.ts:129-134`: within one `create()` method, the
  ADMIN-role branch queries `teachers` via `admin` while the TEACHER-role
  branch (`:124-125`) does the identical lookup via the user client.

Don't copy any single one of these as "the" pattern without checking
whether the comment-explaining-admin-usage rule is actually being followed
at that call site.

## 4. API module conventions (NestJS)

**Module-per-feature is the common case, not a strict rule.** Most modules
under `apps/api/src/<feature>/` are an exact
`<feature>.module.ts`/`.controller.ts`/`.service.ts` triad (e.g. `ai/`,
`super-admin/`). Real exceptions: `attendance/` adds a `fetchers.ts` (§8,
intentional); `students/` has a second, bolted-on service
(`student-360.service.ts` + its own cache/types files); `payments/` has 8
files total. **`privileged-access/` breaks the naming convention
outright** — its module file is `privileged-access.module.ts`, but the
controller/service in the same directory are prefixed
`platform-privileged-access.*`. **`audit/` and `schools/` exist as
directories but contain zero `.ts` files** — dead, not real modules; don't
assume either is wired into anything.

**Guards:** `AuthGuard` precedes `FeatureGuard` in every combination found
— **100%, zero reversals** — though nothing enforces this ordering beyond
convention (`common/guards/feature.guard.ts:4-5`'s own comment: "Must run
after AuthGuard (needs req.user)"). Combinations seen: `AuthGuard` alone
(16 controllers class-level, 3 more method-level-only); `AuthGuard,
FeatureGuard` (6 class-level); `AuthGuard, SuperAdminGuard,
PlatformPermissionGuard` (7, platform-tier controllers). Module gating is
`@RequireModule('key')` (`common/decorators/require-module.decorator.ts`)
alongside `FeatureGuard`. **No `RolesGuard`/`@Roles()` decorator exists
anywhere** — confirmed by a zero-match repo-wide grep. Every role check is
inline in a service method, not guard-enforced (see below).

**Validation: `ZodValidationPipe`, not `class-validator`.**
```ts
// apps/api/src/common/pipes/zod-validation.pipe.ts
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): unknown {
    try { return this.schema.parse(value); }
    catch (err) {
      if (err instanceof ZodError) throw new BadRequestException({ message: 'Validation failed', issues: [...] });
      throw err;
    }
  }
}
```
Used on **26 of 33 controllers, 100 call sites**. `class-validator`
decorators (`@IsString`, `@IsUUID`, etc.) are **never used anywhere** —
despite `main.ts:49` installing a global
`new ValidationPipe({transform:true, whitelist:true})`, which, with zero
class-validator DTOs anywhere for it to validate, is a confirmed no-op
(`main.ts:48`'s own comment acknowledges Zod is the real, per-route
mechanism — don't assume the global pipe is doing anything).

**Known debt:** 7 controllers have **zero runtime request validation** —
raw inline `@Body() body: {...}` TypeScript types with no check at all:
`ai`, `auth`, `notifications`, `notifications-aggregation`, `payments`,
`audit-logs`, `system-health`. Several other controllers are a genuine
mix — Zod on some routes, nothing on others — rather than cleanly one or
the other.

**Service access-check pattern — three shapes coexist, document don't
prescribe:**
1. Resolve via `currentUserRow(accessToken, 'id, role')`, throw inline —
   `apps/api/src/quizzes/quizzes.service.ts:19,22-25`.
2. Raw-query `users` by `auth_id` directly instead of using
   `currentUserRow()` — `apps/api/src/homework/homework.service.ts:109,112-113`.
3. Centralize into a `requireAdmin(accessToken)` helper called from
   specific methods — `apps/api/src/students/students.service.ts:95,97,172,174,209,211`
   — but that same file's own `list()` method (`:80-93`) has **no access
   check at all**, relying purely on RLS.

All three take `accessToken: string` (never a pre-resolved user object) and
self-authorize inline — guards only ever prove authenticated +
module-enabled, per `feature.guard.ts:4-8`'s own comment: "Not the real
security boundary — that's `module_enabled()` folded directly into RLS."
When writing a new service method, pick whichever of the 3 shapes matches
the file you're already in; don't invent a 4th.

**Fetcher pattern** — pure, exported async functions (not NestJS
providers) taking a `SupabaseClient` as the first argument, living in
`apps/api/src/<feature>/fetchers.ts`, mirrored (not shared — see §8) by
per-function files in `apps/web/lib/<feature>/`. Example:
`apps/api/src/attendance/fetchers.ts` exports `fetchAttendanceRateInputs`
(takes **two** clients — user + admin, since `absence_requests` needs
service-role) and `fetchStudentTermAverageInputs`.

## 5. Schema conventions

- **Table naming is mostly snake_case, with one unresolved inconsistency**:
  `behaviour_points` (British spelling) vs `behavior_incident_reports`
  (American spelling) — both are the real, correct table names as written;
  this isn't a typo to "fix," just a historical inconsistency to be aware
  of when searching for either table.
- **Timestamps**: `created_at TIMESTAMPTZ DEFAULT NOW()` is close to
  universal. `updated_at` is not — several tables have it as `NOT NULL`
  with **no default**: `classes`, `subjects`, `fee_balances`. This isn't
  theoretical: it crashed the sample-school seed script's first live run
  (`null value in column "updated_at"… violates not-null constraint`),
  fixed in `apps/api/scripts/lib/seed-structure.ts`. Any new INSERT against
  these three tables must supply `updated_at` explicitly.
- **Soft delete**: nullable `deleted_at TIMESTAMPTZ`, application code
  filters `deleted_at IS NULL` (not verified as RLS-enforced on every
  table).
- **Tenant column**: `school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE`.
- **Linked-assessment pattern**: `assessments.source_type`/`source_id`
  (`supabase/migrations/20260728000081_assessments_source_link.sql`) marks
  an assessment as derived from a homework/quiz rather than teacher-entered
  directly. These columns live on `assessments`, **not** `grades` — a real
  bug (BUG-12 in `docs/bug-triage.md`) shipped from exactly this confusion,
  live in production for ~17.5 hours before being caught by a live e2e run.

**Known debt — schema drift between migration files and the live database
is a recurring, confirmed pattern in this project, not a one-off:**
- `payment_records.payment_method` has an **untracked CHECK constraint**
  requiring lowercase values (`'cash'`, not `'CASH'`) — discovered during
  the sample-school seed script, 2026-08-10, only by querying
  `pg_constraint` directly against the live database; no migration file
  documents its exact allowed values. Flagged for future migration
  normalization, not fixed here.
- `current_user_id()`'s silent redefinition (above) is the same class of
  issue for a function rather than a constraint.
- Earlier project history (BUG-5, BUG-7, BUG-8, BUG-9) — a migration
  claiming to have been applied when it wasn't, and Prisma/live-schema
  disagreements — are the same pattern again.

**Rule of thumb: when a schema question actually matters (a constraint's
exact allowed values, whether a column is nullable, whether a function
does what its name implies), verify live** — query `pg_constraint`,
`pg_proc`, or `information_schema` directly — **rather than trusting a
migration file is still ground truth for current behavior.**

## 6. Database migrations

**Bulk migration operations require per-file verification.** A single
commit adding or modifying more than 5 migrations must include, in its
commit message or PR description, explicit per-file evidence that each
migration's schema effect was verified live — not a blanket "all verified"
assertion. The migration parity check catches drift in single migrations
but not in bulk backfills where the drift and the check are introduced
together (see BUG-5 for the case study that motivated this rule).

Additive-only — **never edit an existing, already-merged migration file**,
even to fix a mistake in it; write a new migration instead. Numbering:
`YYYYMMDDHHMMSS_snake_case_description.sql`. CI enforces migration/registry
parity via `infra/scripts/check-migrations.sh` (§2 for the DIRECT_URL
gotcha when running it locally).

**Before/after verification query is mandatory for any non-trivial
migration**, not optional: capture a `SELECT` that reflects current
behavior, apply the migration, re-run the identical `SELECT`, diff the two
result sets. Treat any unexpected difference as a blocking finding. This
exact discipline is what caught the function-overload bug below before it
shipped — not a hypothetical benefit.

**Function-overload gotcha**: `CREATE OR REPLACE FUNCTION foo(a, b, c)`
does **not** replace `foo(a, b)` — Postgres treats a changed argument list
as a distinct overload, which leaves every existing 2-argument caller
suddenly ambiguous ("function ... is not unique"). Real incident, fully
documented in
`supabase/migrations/20260728000088_module_enabled_recursive_dependencies.sql`'s
own header: the fix kept `module_enabled(uuid, text)`'s original signature
completely unchanged and moved the new recursive logic into a
separately-named function instead (§3). If a migration needs to change a
function's argument list, either keep a same-signature wrapper that
delegates to a differently-named function, or explicitly `DROP FUNCTION`
the old signature first — never assume `CREATE OR REPLACE` alone handles
it.

**Service-role bypasses RLS, never triggers.** Any migration that adds a
`BEFORE INSERT/UPDATE` trigger fires on every write regardless of caller
role, `supabase.admin` included — see §3 for 3 concrete examples. This
also cuts the other way: **a migration file's function/trigger definition
can silently stop matching production reality** — `current_user_id()`'s
redefinition (§3, `docs/bug-triage.md` BUG-13) is the concrete case study.
When behavior actually matters, verify live, don't trust the original
migration file in isolation.

## 7. Testing conventions

**File layout — two conventions coexist, neither is "the" one:**
`apps/api/src/__tests__/` — 19 flat `*.spec.ts` files, no subdirectories.
`apps/api/test/` — 14 files, e2e specs + Jest config. `apps/web` has
**both** colocated (`Foo.tsx` + `Foo.test.tsx` in the same folder — e.g.
`components/DashboardFeed/`, `app/(dashboard)/student/tutor/page.tsx`) and
centralized (`lib/__tests__/{api,days,middleware,roleBadges,schoolTime}.test.ts`)
tests simultaneously.

**Unit tests here are not "shallow logic-only" tests** — don't assume the
conventional narrative. `apps/api/src/__tests__/homework.service.spec.ts:1-32`
hand-builds a real `FakeQueryBuilder` implementing
`select/update/insert/delete/eq/not/limit/order/maybeSingle/single` — a
genuine in-memory DB emulator, not a thin jest mock.

**Known debt:** that exact ~30-line `FakeQueryBuilder` is copy-pasted
across at least 3 spec files (`homework.service.spec.ts`,
`quizzes.service.spec.ts`, `notifications-aggregation.service.spec.ts`) —
each file's own header comment acknowledges the duplication and cites the
"established pattern" in the others, rather than extracting a shared test
helper. Extraction is deferred, not planned; new service specs should
follow the existing copy-paste pattern for now rather than either
inventing a 4th copy with different behavior or unilaterally extracting a
shared helper mid-PR.

**Cross-tenant e2e (`apps/api/test/cross-tenant.e2e-spec.ts`) is the
highest-value tier in this codebase** — its own header states plainly:
"Uses the real Supabase project — creates isolated test data in
`beforeAll`, fires real HTTP requests, deletes everything in `afterAll`."
Real RLS, real triggers, real HTTP — nothing mocked at this tier. This is
also where several real production bugs were actually caught (BUG-3, -4,
-5, -6, -12), not the unit tier.

**Rule: verify third-party integrations actually deliver end-to-end —
passing `tsc`/lint is necessary, not sufficient.** This session's PostHog
cleanup found the `/ingest` reverse-proxy rewrite didn't exist in
`next.config.js` at all — a stale comment claimed a dependency provided it
automatically, but that dependency's own source only handles source-map
upload. This had presumably shipped and passed every prior type-check and
lint pass, since neither would ever catch a missing runtime route. Caught
only by reading the installed package's actual source, then proving the
fix live (`POST /ingest/decide` returning PostHog's own 401, not Next's
404).

**Rule: for destructive/irreversible operations, verify results via an
independent code path, not the operation's own self-check.** The
sample-school seed/teardown 3-cycle live verification deliberately used
raw `curl` against Supabase's PostgREST/GoTrue REST APIs directly to
confirm teardown left zero residual rows, rather than trusting the
teardown script's own internal verification function — specifically so a
bug present in both the delete logic and its own check couldn't produce a
false "all clear."

## 8. Shared code patterns

**`packages/types/src/`** is for pure functions with no I/O — no Supabase
client, no `fetch`, nothing async that touches a network. Real contents:
`attendance-rate.ts`, `grading.ts`, and a `schemas/` directory (34 files,
one per domain — `assessments`, `attendance`, `billing`, `fees`,
`gradebook-link`, `homework`, etc.), all re-exported from `index.ts:15-42`.
Concrete calculators: `calculateAttendanceRate` (`attendance-rate.ts:52`),
`calculateStudentTermAverage` (`grading.ts:133`), `normalizeScore`
(`grading.ts:53`), `calculateSubjectAverage` (`grading.ts:26`),
`assignLetterGrade` (`grading.ts:34`).

**The actual rule for what gets promoted here: pure functions (no I/O) →
`packages/types`; anything that constructs or calls a Supabase client
stays app-local**, even when both apps need conceptually the same thing.
Concrete negative example: `hashForAnalytics`
(`apps/web/lib/analytics/anonymize.ts:14`) is `apps/web`-only, not in
`packages/types`, because it deliberately uses Node's `crypto` module
directly and must never be bundled into client code — it couldn't live in
a package shared with a browser bundle regardless of how "shared" the
concept is.

**Fetchers (§4) are per-app duplication, not sharing.** Only the pure
calculators in `packages/types` are genuinely shared code.
`apps/api/src/attendance/fetchers.ts` and
`apps/web/lib/attendance/fetchAttendanceRateInputs.ts` independently
reimplement near-identical Supabase-querying logic (confirmed
near-verbatim duplicate date-range-expansion loops) — each app's version
takes whichever Supabase client(s) it actually has available. This is the
established, deliberate pattern, not accidental drift
(`apps/api/src/attendance/fetchers.ts:10-18`'s own header explains why) —
don't try to unify the two into one shared fetcher.

## 9. Frontend conventions (Next.js 14 App Router)

Tailwind for styling; **no shadcn/ui anywhere** — this is deliberate, not
an oversight, and matches this project's stage.

**Server-component-first is the dominant, strongly-followed pattern** —
only 7 of 74 `page.tsx` files under `app/(dashboard)/` are `'use client'`.
Server pages fetch directly via `createClient()` from
`apps/web/lib/supabase/server` (69 files import it); client components
fetch via `apiFetch()` (`apps/web/lib/api/index.ts:66` — adds the Supabase
session token, `X-Assist-Token` header, and `API_BASE` prefix).

**Known debt:** a third data-fetching mechanism also exists — 27 files
import `apps/web/lib/supabase/client` for direct client-side Supabase
queries, alongside `apiFetch`. `lib/api/index.ts:4`'s own header comment
claims TanStack Query is the client-fetching convention, but only 2 files
actually call `useQuery`/`useMutation`
(`teacher/TodaysChecklist.tsx:108`, `lib/hooks/useDashboardFeed.ts`) — the
real dominant client-side pattern is plain `useEffect` + `useState` +
`apiFetch`, not what that comment claims. Document current state; don't
assume TanStack Query is idiomatic here just because one file's comment
says so.

For new client-side data fetching, prefer `apiFetch()` + `useEffect`/
`useState` as the default — it's the dominant existing pattern (100+ call
sites vs. 2 for TanStack Query) and the only one of the three that
consistently routes through the NestJS API's own auth/guard layer rather
than querying Supabase directly from the client. Existing code using
direct `lib/supabase/client` queries or TanStack Query should not be
refactored purely for consistency.

**`useModuleAccess()`** (`apps/web/lib/hooks/useModuleAccess.ts`) returns
`{isModuleEnabled, loading}`, fetches `/auth/me` once, and **fails open**
while loading (`isModuleEnabled` returns `true` until the fetch resolves —
avoids a nav-item flash; the server is the real boundary regardless, per
its own header comment). **"Hide entirely," never disable/grey-out**, is
the universal convention across all 6 real call sites:
```tsx
// apps/web/app/(dashboard)/teacher/quizzes/[id]/QuizBuilderClient.tsx:265
{isModuleEnabled('ai_quiz_generation') && (<AiQuizGenerator ... />)}
```
The one deliberate exception in *shape* (not in the hide-vs-disable rule):
`student/tutor/page.tsx:98` does an early-return blocked-state instead of
hiding an element, and is the only call site that reads `loading` — it
exists specifically to close a direct-URL-navigation bypass that nav-link
filtering alone doesn't (`DashboardShell.tsx:131,142`).

**`DeniedBanner`** (`apps/web/components/DeniedBanner.tsx`) is the only
access-denial UX component in the app — currently supports exactly one
reason code (`'student-360'`). Both call sites
(`teacher/page.tsx:79`, `admin/page.tsx:105`) pass it a `?denied=` search
param identically. If you need a new denial reason, add a key to its
`MESSAGES` map rather than building a second banner component.

**Known debt — no shared building blocks for 3 common UI needs:**
- **No shared Modal/Dialog component.** At least 5 independently
  hand-rolled overlays exist (`documents/RetagModal.tsx`,
  `admin/payments/PaybillDashboard.tsx` ×2, `admin/events/EventsClient.tsx`,
  `messages/MessagesClient.tsx` ×2, `teacher/homework/HomeworkClient.tsx` ×2,
  `teacher/quizzes/QuizzesTeacherClient.tsx`), inconsistent on backdrop
  opacity, `role="dialog"` presence, and backdrop-click-to-close — none
  have a focus trap or Escape handling. If you need a new modal, match
  `RetagModal.tsx`'s shape (it's the most complete of the existing ones,
  and its own comment calls out `PaybillDashboard.tsx`'s as the original
  precedent) rather than inventing a 6th variant.
- **`react-hook-form` is a fully dead dependency** —
  `apps/web/package.json:28` declares it, but there are **zero imports and
  zero `useForm()` calls anywhere in the app**. Every form is hand-rolled
  per-field `useState` plus a manual `try/catch/finally` submit handler and
  a local `error`/`err` string rendered as a red/rose `<p>`. Don't assume
  react-hook-form is available/idiomatic here just because it's installed
  — follow the per-field `useState` pattern instead, or raise removing the
  dependency as a separate cleanup if it's ever actually adopted.
- **No shared Spinner/loading component.** `animate-spin` appears in only
  2 files; the real convention is ad-hoc inline `Loading…` text (~20
  occurrences, independently-styled). The one genuinely shared piece is
  `app/(dashboard)/loading.tsx` (Next's own route-level loading
  convention) — but it's the *only* `loading.tsx` in the entire `app/`
  tree, no per-route skeletons anywhere else.

Consolidating any of the three above is real, worthwhile follow-up work —
not done as part of writing this document, per this PR's own scope (docs
only, no refactors).
