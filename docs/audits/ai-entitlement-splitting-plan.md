# AI Entitlement Splitting — Phase 1 Audit

**Scope:** Bucket 1, PR 4b. Splitting the single `ai_features` module toggle into
four independently-toggleable sub-entitlements (AI tutor, AI quiz generation,
AI plagiarism detection, AI report card comments), with `ai_features` retained
as a category master switch. No pricing change in this PR.

**Status:** Phase 1 (audit) complete. **No code changes in this PR.** Awaiting
explicit review before Phase 2 implementation starts.

---

## Phase 2 outcome (implementation)

Implemented as planned, all 3 review refinements included. Deviations and
findings worth recording here:

- **Refinement 1's production check returned both empty arrays** — zero
  schools have `ai_features` enabled at all today, not just the "expected
  safe" case. No compensating step was needed. (Documented in the PR
  description with the exact query results.)
- **A real deployment bug was caught and fixed by Commit 1's own
  before/after verification step, before it ever reached this PR**:
  `CREATE OR REPLACE FUNCTION module_enabled(uuid, text, int)` does not
  replace `module_enabled(uuid, text)` — Postgres treats a changed argument
  list as a new overload, which left the 2-arg signature every existing RLS
  policy and `.rpc()` call depends on ambiguous. Fixed by keeping
  `module_enabled(uuid, text)`'s signature byte-for-byte unchanged (still a
  trivial one-line `sql` wrapper) and moving the actual recursive,
  depth-guarded logic into a new, separately-named function,
  `module_enabled_at_depth(uuid, text, int)`, with no existing dependents to
  break. Verified live: single unambiguous overload, zero behavioral drift
  on the one pre-existing `school_modules` row, and — separately — a real
  master-switch proof against a temporary row on the one live school
  (enable parent, enable child, disable parent retroactively, confirm the
  child's effective state flips to `false` while its own row stays `true`),
  cleaned up immediately after.
- **Two pre-existing tests in `cross-tenant.e2e-spec.ts` referenced the old
  `ai_features → document_library` dependency directly** and needed
  updating for the dependency's move onto `ai_tutor`: the "explicit override
  wins" test (its `document_library`-satisfying setup step is no longer
  needed at all, since `ai_features` now has zero dependencies) and the
  "unmet dependency is rejected" test (now exercises `ai_tutor`'s
  dependency on `document_library` instead, with `ai_features` explicitly
  satisfied first to isolate the check).
- **Commit 5's admin-UI collapsed/expanded semantics**: implemented as
  `<details open={parent.enabled}>` — collapsed while the parent is off
  (children present in the DOM, not visually cluttering the list, per the
  task's own wording), auto-expanded once the parent is on. Parent/child
  grouping is computed generically from `ModuleRow.dependencies` (already
  present in the existing API response — no backend shape change needed),
  not hardcoded to the AI category, so the same admin-UI code will group any
  future parent/child module relationship the same way.
- **Test coverage deliberately avoids live paid Anthropic API calls.**
  `/ai/generate-quiz` and `/ai/detect-plagiarism` have no pre-AI-call
  lookup gate (unlike `/ai/tutor`, `/ai/process-document`, and
  `/ai/report-card-comment`, which 404 on a nonexistent resource before
  ever reaching the AI service) — so "happy path" coverage for those two
  specifically is scoped to entitlement-gating (`403` when disabled) rather
  than a full `200` requiring a real LLM call. This matches the existing
  test suite's own established pattern (the two pre-existing AI tests both
  rely on a 404-before-AI-call to prove the guard passed).
- **New self-contained test school** for the AI-gating e2e cases
  (`AI Entitlement Test School`) — deliberately not reusing `schoolA`/`schoolB`
  or `entitlementSchoolId`, since `cross-tenant.e2e-spec.ts` is heavily
  order-dependent on those fixtures' exact state at each point in the file.

## Summary

| Finding | |
|---|---|
| Module registry | DB-seeded catalogue (`modules` table), not a hardcoded list — adding 4 new modules is a data migration, not a schema change |
| `school_modules` | Row-per-module boolean, `UNIQUE(school_id, module_key)` — the shape already supports arbitrary additional modules with zero rework |
| **The one real gap**: `dependencies` doesn't do what it looks like it does | Enforced write-time only (blocks *enabling* a module before its dependency), never read-time. `module_enabled()` never consults `dependencies` at all. A literal parent-off-implies-child-off "master switch" does **not** exist today and needs a real logic change, not just new rows |
| `ai_features` enforcement today | A single class-level `@RequireModule('ai_features')` on `AiController`, covering all 5 routes with no per-route granularity |
| **For AI specifically, the API guard is the entire security boundary** | Contrary to the guard/decorator's own doc comments ("real boundary is RLS"), that's only true for the RLS-only module group. `ai_features` has zero RLS policies anywhere — 2 of the 5 AI routes (`generate-quiz`, `detect-plagiarism`) don't even touch a database table, so there is no defense-in-depth at all beneath `FeatureGuard` for those two |
| All 4 features | Fully built, real Anthropic SDK calls — none is a stub. Recommended architecture doesn't need to touch the AI service layer itself |
| UI enforcement today | Only AI Tutor has any gating, and it's nav-link-only — the page itself has zero check, direct navigation bypasses it. Quiz generation, plagiarism, and report comments have **no gating at all** today |
| Recommended architecture | **Option A** (parent + 4 sub-modules), plus a small necessary fix to `module_enabled()` itself — see §2 |
| Tests | One e2e file exercises the generic entitlement engine via `ai_features` as its example key. Zero tests for 3 of 5 AI routes; zero unit tests for the guard; zero frontend tests for any of this |

---

## 1. Current entitlement/module registry audit

### 1.1 Module registry

`supabase/migrations/20260721000023_module_registry.sql` is the single source
of truth. Two tables:

```sql
CREATE TABLE public.modules (
  key TEXT PRIMARY KEY, name TEXT, description TEXT, category TEXT,
  is_core BOOLEAN DEFAULT false, can_disable BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMING_SOON','DEPRECATED')),
  dependencies TEXT[] DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
);
```

This is a **DB-seeded catalogue**, populated only by migration `INSERT`
statements (comment at the top of the file: "no runtime 'create module' UI") —
not a hardcoded TypeScript array and not a CHECK-constraint enum. Adding 4 new
modules is purely a data migration.

The `ai_features` seed row (line 133):
```sql
('ai_features', 'AI Features', 'AI tutor, quiz generation, plagiarism detection, report comments', 'AI', false, true, ARRAY['document_library'])
```

A narrower, parallel list exists at the application layer:
`apps/api/src/common/decorators/require-module.decorator.ts:20-28` — a closed
TypeScript union `ModuleKey` (`'payments' | 'assessments' | 'ai_features' | 'api_webhooks' | 'homework' | 'events' | 'quizzes' | 'document_library'`),
used only to type-check `@RequireModule()` call sites. It only lists
NestJS-guardable modules (RLS-only modules like `behaviour_tracking` aren't in
it) and will need the 4 new keys added.

### 1.2 `school_modules` schema

Same migration, lines 22-35:

```sql
CREATE TABLE public.school_modules (
  id UUID PK, school_id UUID FK→schools, module_key TEXT FK→modules(key),
  enabled BOOLEAN NOT NULL DEFAULT true, config JSONB DEFAULT '{}',
  enabled_at, enabled_by, disabled_at, disabled_by, updated_at,
  UNIQUE (school_id, module_key)
);
```

**Row-per-module boolean**, not a JSONB blob and not an enum. RLS: `SELECT`
open to `SUPER_ADMIN` (any school) or own-school `ADMIN`/`TEACHER`;
`INSERT`/`UPDATE`/`DELETE` restricted to `SUPER_ADMIN` only (lines 92-108).

A `BEFORE INSERT OR UPDATE` trigger, `school_modules_check` (lines 54-89),
rejects: an unknown `module_key` (`RAISE EXCEPTION`), disabling a
core/non-disableable module, and — the piece that matters most for this
audit — **enabling a module whose `dependencies` aren't all currently
enabled**:

```sql
IF NEW.enabled = true AND array_length(v_module.dependencies, 1) > 0 THEN
  SELECT dep INTO v_missing FROM unnest(v_module.dependencies) AS dep
  WHERE NOT public.module_enabled(NEW.school_id, dep) LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Module % requires % to be enabled first', NEW.module_key, v_missing;
  END IF;
END IF;
```

This only fires on the `enabled = true` transition. It does not run on read,
and disabling a parent does not cascade to its dependents. This is the crux
of the finding below.

### 1.3 `module_enabled()` — read directly, both versions

Two definitions exist; the second (`CREATE OR REPLACE`) supersedes the first
and is what actually runs today. Full body,
`supabase/migrations/20260722000031_entitlement_engine.sql:19-31`:

```sql
CREATE OR REPLACE FUNCTION public.module_enabled(p_school_id UUID, p_module_key TEXT)
  RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.school_modules WHERE school_id = p_school_id AND module_key = p_module_key),
    (SELECT true FROM public.modules WHERE key = p_module_key AND is_core = true),
    (SELECT pm.entitlement = 'INCLUDED'
       FROM public.school_subscriptions ss
       JOIN public.package_modules pm ON pm.package_id = ss.package_id AND pm.module_key = p_module_key
       WHERE ss.school_id = p_school_id AND ss.status = 'ACTIVE'),
    (SELECT false FROM public.school_subscriptions ss WHERE ss.school_id = p_school_id AND ss.status = 'ACTIVE'),
    true
  );
$$;
```

Priority chain, per the migration's own header comment: (1) explicit
`school_modules` override always wins, (2) core → true, (3) active
subscription's package entitlement, (4) active subscription but module absent
from package → false, (5) **no active subscription at all → true** (the
system's default-open behavior, preserved so every pre-existing school with
zero subscriptions sees no change).

**This chain never references `dependencies`.** Combined with §1.2's
write-time-only trigger, the practical consequence: if a school has
`ai_features` explicitly enabled today, then an admin later disables
`document_library` (its current dependency), `module_enabled('ai_features', ...)`
still returns `true` — the explicit override wins outright, unaware the
dependency is now unmet. **The `dependencies` array does not provide "if my
dependency is off, I read as off" semantics. It only ever gated the initial
enable action.** This is a pre-existing latent behavior of the system, not
something this PR introduces — but it directly determines what "parent
master switch" requires (§2).

One more detail worth flagging for commit sequencing (§10): the final
`COALESCE` arm is a literal `true`. A module key with **no row in `modules`
at all** — not merely a disabled one — silently resolves to `enabled = true`
rather than erroring. (The `school_modules` write-path trigger *does* reject
unknown keys; a bare `module_enabled()` read does not.)

### 1.4 `@RequireModule` / `FeatureGuard`

`apps/api/src/common/decorators/require-module.decorator.ts` (full file, 31
lines): `RequireModule(key: ModuleKey) = SetMetadata(REQUIRE_MODULE_KEY, key)`.
Its own header comment:

> This is a fast-fail UX layer only — the actual security boundary is the
> matching `module_enabled()` check folded into RLS policies.

`apps/api/src/common/guards/feature.guard.ts` (full file, 52 lines) —
`FeatureGuard.canActivate()` reads the metadata via
`reflector.getAllAndOverride([handler, class])` (so a per-route
`@RequireModule` cleanly overrides a class-level one), resolves the caller's
`school_id`, then calls RPC `module_enabled` directly — it calls the SQL
function, it does not reimplement its logic.

**The "real boundary is RLS" claim needed direct verification, and it's only
true for one specific group of modules.**
`supabase/migrations/20260721000024_module_enforcement_rls.sql`'s own header
explains why: "These tables have NO NestJS controller — the Next.js frontend
talks to them directly via Supabase, so RLS is the only place module
entitlement can be enforced." It folds `module_enabled()` into RLS policies
for exactly the RLS-only module group: `document_library`, `quizzes`,
`behaviour_tracking`, `permission_slips`, etc. — confirmed by grep, every
`module_enabled(...)` call in that migration file uses one of those keys.

**`ai_features` is a NestJS-controller module, and was never given this
treatment.** Confirmed: zero RLS policies anywhere in the migrations reference
`ai_features`. The tables the AI routes touch are gated on other things
entirely (`documents`/`document_chunks` on `document_library`; `students` on
tenant RLS) or not gated at all, because two of the five routes write to no
table whatsoever. **For AI specifically, `FeatureGuard` is not a "fast-fail
nicety" layered on top of a real boundary — it is the entire entitlement
boundary.** This is more consequential than the code's own comments suggest,
and is worth stating plainly: a mistake in the upcoming per-route decorator
split (§3) would leave a route completely unprotected, with no RLS backstop
at all for `generate-quiz` or `detect-plagiarism` specifically.

### 1.5 Every `ai_features` enforcement point

`apps/api/src/ai/ai.controller.ts` (read in full, 216 lines). Single
class-level gate covers all 5 routes:

```ts
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(AuthGuard, FeatureGuard)
@RequireModule('ai_features')
@Controller('ai')
export class AiController { ... }
```

| Route | Handler:line | Persists to a table? |
|---|---|---|
| `POST /ai/generate-quiz` | `generateQuiz` :30 | No — ephemeral, questions returned to the client only |
| `POST /ai/report-card-comment` | `reportCardComment` :49 | No — reads `students`/`assessments`/`grades` (RLS-scoped by tenant, not by `ai_features`), returns text |
| `POST /ai/process-document` | `processDocument` :126 | Writes `document_chunks` (RLS-gated on `document_library`, not `ai_features`) — this is tutor-RAG ingestion |
| `POST /ai/tutor` | `tutor` (SSE) :152 | Reads `document_chunks`; writes `tutor_logs` |
| `POST /ai/detect-plagiarism` | `detectPlagiarism` :211 | No — ephemeral |

No route has its own `@RequireModule` override today — there is no per-route
granularity to build on, only the one class-level gate to split apart.

**Also confirmed, unrelated to the split but worth flagging as a related
finding (not proposed for fixing in this PR):** none of the 5 routes has a
role guard. Any authenticated user of an entitled school — including a
STUDENT — can call the three "teacher-facing" routes
(`generate-quiz`/`detect-plagiarism`/`report-card-comment`) today. Also: none
of the 5 routes has Zod/DTO request validation (inline TS type literals
only). Both pre-date and are orthogonal to this PR's scope per the task's own
instruction not to touch the AI service layer.

Registry/packaging: `20260721000023_module_registry.sql:133` (registry row,
`dependencies: ARRAY['document_library']`); `20260722000030_packages.sql:105`
(Professional package: `ai_features` = `OPTIONAL_ADD_ON`), `:120` (Enterprise:
`INCLUDED`).

Nav-level reference: `apps/web/app/(dashboard)/DashboardShell.tsx:74` — the
only frontend module-key reference to `ai_features` anywhere (see §1.7/§4).

### 1.6 Admin modules UI

Two distinct pages; only one actually toggles anything:

- **`apps/web/app/(super-admin)/super-admin/modules/page.tsx`** —
  read-only catalogue/adoption view. Fetches `GET /super-admin/modules` +
  `GET /super-admin/analytics/modules`, groups by `category`, shows
  dependency lists and per-school adoption percentages. Explicitly states
  (line 41): "To toggle a module for a specific school, go to Schools →
  select a school."
- **`apps/web/app/(super-admin)/super-admin/schools/[schoolId]/page.tsx`** —
  the real toggle UI, "Modules" section (lines 1042-1085). Loads via
  `GET /super-admin/schools/${schoolId}/modules`. `toggle()` (lines 908-928)
  confirms via `confirm()`, calls `PATCH /super-admin/schools/${schoolId}/modules/${key}`
  with `{ enabled: next }`, routed to
  `SuperAdminController.@Patch('schools/:id/modules/:key')`
  (`apps/api/src/super-admin/super-admin.controller.ts:130-137`) →
  `SuperAdminService.toggleModule()` (`super-admin.service.ts:411-475`), which
  re-validates the dependency/core rules server-side, upserts
  `school_modules` (`onConflict: 'school_id,module_key'`), and writes an
  `audit_logs` row.

The render (lines 1042-1085) is a **strictly flat list**, one `<div>` per
`ModuleRow` keyed by `m.key`, grouped only by `m.category` — there is no
parent/child concept anywhere in this component today. The toggle itself is a
text button (`disabled={m.is_core || !m.can_disable || busyKey === m.key}`),
not a switch component.

Since `school_modules` is already row-per-module, this page will show 4 new
rows automatically the moment the registry migration lands — no code change
is *required* for baseline functionality, only for the richer parent+nested
UX the product spec calls for (§5).

### 1.7 Frontend `useModuleAccess` hook

`apps/web/lib/hooks/useModuleAccess.ts` (full file, 33 lines): fetches
`GET /auth/me` once, builds a `Set<string>` from `data.enabledModules`,
exposes `isModuleEnabled(key: string)` and `loading`. Fail-open while loading
(line 27-29: returns `true` for everything, with a comment that the server is
the real boundary — consistent with §1.4's finding that for most modules RLS
backs this up, but not for AI). Backing endpoint:
`apps/api/src/auth/auth.controller.ts:53-56`, calls RPC
`effective_enabled_modules`.

**Only two call sites exist app-wide**: `DashboardShell.tsx` and
`teacher/TodaysChecklist.tsx`. The hook itself is fully generic — it takes
any string key — so it needs zero code changes for the split; only new call
sites are needed (§4).

### 1.8 Existing tests

Exactly one test file references any part of this system:
`apps/api/test/cross-tenant.e2e-spec.ts`. It's an entitlement-engine test
suite that happens to use `ai_features` as its example module key throughout
— package membership, default-enabled behavior, package-downgrade,
SuperAdmin modules list, the `document_library` dependency-trigger check,
override-beats-package, `/auth/me` reflection, package-swap preview/persistence,
and one blocked-`PATCH` case (~13 assertions total, lines 843-2014).

**No unit tests** reference `RequireModule`, `FeatureGuard`, `module_enabled`,
or `school_modules` (zero `*.spec.ts` matches). **No route-specific tests**
exist for `/ai/tutor`, `/ai/generate-quiz`, or `/ai/detect-plagiarism` at all
— only `/ai/process-document` and `/ai/report-card-comment` have a
cross-tenant-404 case each. **No frontend tests** reference `useModuleAccess`,
`DashboardShell`'s nav filtering, or any AI component.

---

## 2. Proposed sub-entitlement architecture

### 2.1 Recommendation: Option A, plus one necessary extension

**Option A** — extend the registry with 4 new sub-modules, `ai_features`
remains as parent/master-switch — confirms the stated lean. But §1.3's
finding changes what "Option A" has to include: the `dependencies` mechanism
that looks like it should deliver master-switch semantics for free does not.
Recommend pairing Option A with a small, targeted change to
`module_enabled()` itself:

> Extend `module_enabled()` so that, after resolving a module's own state, it
> additionally requires every entry in that module's `dependencies` array to
> itself be `module_enabled()` — recursive, short-circuiting AND. One
> `CREATE OR REPLACE FUNCTION`, no schema change, no new table.

This is a genuine correctness fix, not just plumbing manufactured for this
PR: it also closes the *existing* latent gap in `ai_features`'s current
`document_library` dependency (§1.3) — today that dependency has never
actually been enforced at read time; this fix makes it real for the first
time, for both the pre-existing relationship and the 4 new ones.

### 2.2 Why not Option B

Replacing `ai_features` with 4 flat sub-modules loses the literal
master-switch the product spec requires ("if off, all 4 sub-modules are
treated as off regardless of their own state") — B would need a *different*
mechanism to express that, since there'd be no parent row to depend on.
`modules.category` already provides UI grouping (§1.6) without needing B's
flattening, so B buys nothing A doesn't already have except a data model that
doesn't match the product requirement.

### 2.3 Why not Option C

A JSONB `ai_settings` column would bypass the entire working entitlement
stack: the registry, the dependency trigger, `module_enabled()`,
`effective_enabled_modules()`, `@RequireModule`/`FeatureGuard`, the SuperAdmin
toggle UI (§1.6 — which picks up new `modules` rows with zero code changes),
and the audit-log-on-toggle behavior already built into
`SuperAdminService.toggleModule()`. C would need a parallel guard type (since
`@RequireModule` is keyed to `modules`/`school_modules`) and a bespoke admin
UI path instead of the flat-list-that-just-works behavior Option A gets for
free. Confirmed this isn't a marginal preference — C genuinely duplicates
real, already-built infrastructure.

### 2.4 Schema changes

- New migration inserts 4 `modules` rows:

  | key | category | dependencies |
  |---|---|---|
  | `ai_tutor` | `AI` | `ARRAY['ai_features', 'document_library']` |
  | `ai_quiz_generation` | `AI` | `ARRAY['ai_features']` |
  | `ai_plagiarism_detection` | `AI` | `ARRAY['ai_features']` |
  | `ai_report_comments` | `AI` | `ARRAY['ai_features']` |

  All `is_core: false`, `can_disable: true`, `status: 'ACTIVE'`.

- `ai_tutor` alone carries the `document_library` dependency — confirmed via
  §1.5's table that only the tutor/process-document routes touch
  `document_chunks`; quiz generation, plagiarism detection, and report
  comments never do.
- Correspondingly, **remove `document_library` from `ai_features`'s own
  `dependencies`** (becomes `'{}'`) — it was really the tutor's requirement,
  not the whole bucket's. Safe to change: §1.2 confirmed dependency checking
  is write-time-only, so this doesn't retroactively affect any
  already-enabled school; it only changes what a *future* enable-attempt
  validates.
- `module_enabled()`: the recursive-dependency extension from §2.1.
- `ModuleKey` TS union (`require-module.decorator.ts:20-28`): add the 4 new
  keys.
- **No RLS changes.** §1.4 confirmed AI never had module-level RLS and
  doesn't need it for the split — `FeatureGuard` remains the sole boundary,
  exactly as it is today, just with finer-grained keys.

---

## 3. API-layer enforcement points

| Feature | Route | New `@RequireModule` key |
|---|---|---|
| AI tutor | `POST /ai/tutor` | `ai_tutor` |
| AI tutor (RAG ingestion) | `POST /ai/process-document` | `ai_tutor` |
| AI quiz generation | `POST /ai/generate-quiz` | `ai_quiz_generation` |
| AI plagiarism detection | `POST /ai/detect-plagiarism` | `ai_plagiarism_detection` |
| AI report card comments | `POST /ai/report-card-comment` | `ai_report_comments` |

All 5 are fully implemented today (§1.5) — none is aspirational or stubbed.
The class-level `@RequireModule('ai_features')`
(`ai.controller.ts:18-19`) is removed; each of the 5 handlers gets its own
per-route `@RequireModule(...)`. `FeatureGuard`'s existing
`getAllAndOverride([handler, class])` call already supports a per-route
decorator cleanly overriding a class-level one (§1.4), so no guard code
changes beyond what §2.4 already covers.

Master-switch behavior (parent off ⇒ child reads as off) is handled entirely
*inside* `module_enabled()` via §2.1's fix — the per-route guard only ever
needs to check the specific sub-module key, never both keys.

---

## 4. UI-layer enforcement points

| Feature | Component | Rendered from | Gating today |
|---|---|---|---|
| AI tutor | `app/(dashboard)/student/tutor/page.tsx` | Direct route | Nav-link filtered only (`DashboardShell.tsx:74`, `isModuleEnabled('ai_features')`) — **the page itself has no check; direct navigation to `/student/tutor` renders the full chat regardless** |
| AI quiz generation | `app/(dashboard)/teacher/quizzes/[id]/AiQuizGenerator.tsx` | `QuizBuilderClient.tsx:263` | **None at all** — renders unconditionally |
| AI plagiarism detection | `app/(dashboard)/teacher/assignments/[id]/SubmissionsClient.tsx` | Direct route | **None at all** — no `useModuleAccess` import in the file |
| AI report card comments | `app/print/report-card/[studentId]/AiCommentButton.tsx` | `CommentForm.tsx:91` | **None at all** — only conditional is `!readOnly` (sign-off lock state), unrelated to modules |

This is a materially bigger gap than "split existing gating": 3 of 4 features
have zero entitlement UI today, and the one that has something is trivially
bypassed by direct navigation. Phase 2's UI work is mostly **adding** gating
that doesn't exist yet, not refining what's there — worth stating plainly so
it isn't scoped as a smaller change than it is.

**Recommendation: hide entirely for all 4**, matching the task's own default
and the only existing precedent in this codebase (nav-link filtering).
Concretely:

- **Tutor**: add a real page-level check at the top of `student/tutor/page.tsx`
  (redirect or empty state) — closes the direct-nav bypass. The nav-link
  filter's `moduleKey` also changes from `'ai_features'` to `'ai_tutor'`.
- **Quiz generation, plagiarism, report comments**: wrap the existing render
  call at each call site in `{isModuleEnabled('ai_quiz_generation') && <AiQuizGenerator .../>}`
  (and the equivalent for the other two) — no restructuring of the
  components themselves needed, since none of them currently reads
  `useModuleAccess` at all.

---

## 5. Admin toggle UI

- **Reuse verbatim**: `schools/[schoolId]/page.tsx`'s existing `ModuleRow`
  type, `byCategory` grouping, and `toggle()` optimistic-update logic
  (server truth via the unchanged `PATCH .../modules/:key` endpoint). No new
  state-management approach is needed — the existing pattern already does
  "optimistic local update, server-confirmed truth."
- **New**: a parent/child render branch, grouping any `ModuleRow` whose
  `dependencies` includes `ai_features` underneath the `ai_features` row
  itself. Reuse the native `<details>/<summary>` pattern already established
  in `NotificationsView.tsx` (confirmed precedent) rather than building a
  custom accordion component from scratch — no `Accordion`/`Collapsible`
  component exists anywhere in this codebase today.
- **New**: extract the inlined pill-switch from `ProfileClient.tsx:386-397`
  (`<button role="switch" aria-checked={...} className="relative inline-flex h-5 w-9 ...">`)
  into `apps/web/components/ui/Toggle.tsx`. Use it for the 4 new sub-toggle
  rows; retrofitting the existing flat toggle buttons to use it too is
  optional, not required for this PR.
- **Parent-off state**: show sub-toggles **disabled, not hidden** — an admin
  needs to see the 4 sub-modules exist and understand why they're currently
  inert (a short inline note, e.g. "Enable AI Features first"). This is
  deliberately the *opposite* of §4's "hide entirely" recommendation for
  end-user-facing feature affordances — worth stating explicitly why the two
  surfaces differ: one is a discoverability surface for an admin configuring
  the school, the other is a feature affordance for an end user who has no
  reason to know a disabled feature exists at all.
- **Each sub-toggle row**: label (`modules.name`) + one-line description
  (`modules.description`, already a column that exists) + toggle switch.
  "Learn more" affordance: skip — no existing precedent anywhere in this UI
  for that pattern, and nothing in the source data (`modules` table has no
  long-form-help column) to back it with content.

---

## 6. Migration strategy

**Up migration:**

```sql
INSERT INTO school_modules (school_id, module_key, enabled, enabled_at, config)
SELECT school_id, 'ai_report_comments', true, now(), '{}'
FROM school_modules WHERE module_key = 'ai_features' AND enabled = true
ON CONFLICT (school_id, module_key) DO NOTHING;

INSERT INTO school_modules (school_id, module_key, enabled, config)
SELECT school_id, unnest(ARRAY['ai_tutor', 'ai_quiz_generation', 'ai_plagiarism_detection']), false, '{}'
FROM school_modules WHERE module_key = 'ai_features' AND enabled = true
ON CONFLICT (school_id, module_key) DO NOTHING;
```

**Explicit `enabled = false` rows for the other three, not silent absence.**
This refines the task's own literal Section 6 text, which only calls for
inserting the one `true` row — but §1.3 established that `module_enabled()`'s
rule 5 ("no active subscription → true") would otherwise silently default
any school *without* an active subscription to enabled for the other three,
directly contradicting "admins opt into the other three explicitly." Writing
explicit `false` rows makes the outcome deterministic regardless of a
school's subscription state.

Idempotent via `ON CONFLICT ... DO NOTHING` — safe to rerun. Schools that
never had `ai_features` enabled get no rows from this migration at all,
either way.

**Down migration:** delete the 4 sub-module rows from `school_modules` (and
optionally their `modules` catalogue rows). `ai_features` itself is never
touched by the up-migration, so there's nothing to restore on it —
"consolidating back to the parent" is simply discarding the sub-toggle
preferences and letting the pre-existing `ai_features` state stand on its
own, which is the expected/acceptable behavior for a rollback.

**Not the migration script's job, but worth planning for in Phase 2:** when
an admin enables `ai_features` fresh in the future (after this PR ships),
the toggle-on flow should seed the same defaults
(`ai_report_comments: true`, others `false`) so new adopters land in the same
state as the backfilled cohort, rather than falling through to whatever the
subscription-based default happens to be.

---

## 7. Testing strategy

- **Guard/master-switch e2e** (extend `cross-tenant.e2e-spec.ts`'s existing
  AI section): per-sub-module gating for all 5 routes, plus — the case that
  actually proves §2.1's fix works, not just documents intent — parent
  `ai_features` disabled + a sub-module explicitly `enabled = true` in its
  own row → still blocked.
- **Missing baseline coverage**, added while these routes' guards are being
  touched anyway (not scope creep — every one of these routes' decorators is
  already being edited in this PR): happy-path and cross-tenant-404 cases for
  `/ai/tutor`, `/ai/generate-quiz`, and `/ai/detect-plagiarism`, none of
  which have any test today (§1.8).
- **Cross-tenant**: a school with `ai_tutor` disabled cannot reach another
  school's `ai_tutor`-enabled endpoint — extend the existing cross-tenant
  404 pattern (already used for `process-document`/`report-card-comment`) to
  the other 3 routes.
- **Frontend**: first-ever tests for `useModuleAccess` (none exist today),
  plus gating-branch tests for the 3 newly-gated components
  (`AiQuizGenerator`, `SubmissionsClient`, `AiCommentButton`) and the tutor
  page's new page-level check.
- **Migration test**: apply to a fixture school with `ai_features = true`
  pre-existing; assert exactly `ai_report_comments = true` and the other 3
  explicitly `false` afterward; assert a second run is a no-op; assert the
  down-migration cleanly removes all 4 rows.

Proposed files: extend
`apps/api/test/cross-tenant.e2e-spec.ts` (guard/master-switch/cross-tenant
cases); new `apps/api/test/ai-entitlement-migration.e2e-spec.ts` (migration
idempotency/reversal); new
`apps/web/lib/hooks/useModuleAccess.test.ts`; gating-branch cases added to
each of the 3 components' existing test files if any exist, else new
`*.test.tsx` files colocated per this codebase's existing convention.

---

## 8. Rollout considerations

- **No pilot schools are currently active.** If one signed up mid-development
  (between the registry/migration commits and the guard-split commit
  landing), it's unaffected either way: a brand-new school has no
  pre-existing `ai_features` state for the backfill to touch, and the
  class-level `@RequireModule('ai_features')` gate keeps working exactly as
  it does today right up until the commit that replaces it — as long as
  §10's commit order is respected, there's no window where a route is
  ungated or incorrectly gated.
- **No deprecation needed.** Option A keeps `ai_features` — the class-level
  decorator is *refactored* into 5 per-route ones within this same PR, not
  scheduled for later removal.
- **Frontend hook**: `useModuleAccess()`/`isModuleEnabled()` needs zero code
  changes (§1.7) — it's already fully generic. Only new call sites are
  needed, per §4.

---

## 9. Future work: bundle pricing readiness

Option A supports bundle pricing with **zero schema rework**: a future "AI
Basic/Plus/Full" bundle is just new `package_modules` rows for the 4 new
sub-keys per package — the exact same mechanism `ai_features` itself already
uses today (`OPTIONAL_ADD_ON`/`INCLUDED` per package, §1.5) and the exact
mechanism `module_enabled()`'s priority-chain rule 3 already implements
(§1.3). No new table, no new concept — a school subscribing to a bundle is
just a `package_modules` row per sub-module it includes, resolved by
existing code the moment those rows exist. This is the clean path; Option C
would have required inventing a separate bundle concept outside the JSONB
column entirely, one more reason Option A is the better foundation
regardless of whether bundle pricing ships soon.

---

## 10. Phase 2 implementation plan

7 commits, sequenced — the ordering constraints are not cosmetic: §1.3
established that an unregistered module key silently resolves to
`enabled = true` rather than erroring, so guard commits must never land
ahead of the registry commit, and the backfill must land before schools can
have sub-modules enforced against them with no row in place.

1. **`feat(entitlements): extend module registry with 4 AI sub-modules + recursive dependency enforcement in module_enabled()`**
   Registry migration (4 new `modules` rows, `document_library` dependency
   moved from `ai_features` to `ai_tutor`) + the `module_enabled()` SQL
   change (§2.1) + `ModuleKey` TS union update. Must land first.
2. **`feat(entitlements): migration backfill for existing schools`**
   The data migration (§6, up + down). Lands before the guard-split so no
   school is ever gated against a sub-module with no backfilled row.
3. **`feat(entitlements): per-route API gates for AI sub-modules`**
   `ai.controller.ts` decorator split — class-level → 5 per-route (§3).
4. **`feat(entitlements): admin UI parent/child submodule toggle chooser`**
   SuperAdmin schools-detail page restructure (§5) + extracted `Toggle`
   component. Depends on commit 1 (needs real rows to group/render).
5. **`feat(entitlements): frontend gating for AI tutor/quiz-gen/plagiarism/report-comment UI`**
   The 4 component-level gates (§4), including the tutor direct-nav-bypass
   fix.
6. **`test(entitlements): unit/e2e coverage for sub-module guards, master-switch dependency, migration idempotency, cross-tenant isolation, plus missing baseline coverage for tutor/quiz-gen/plagiarism routes`**
   §7 in full.
7. **`docs: backlog updates for B1-4b`**
   `EXECUTION_PLAN.md` entry (gitignored, local-only per this repo's
   established convention) + `docs/phase-1/00-backlog.md` if this item is
   tracked there.
