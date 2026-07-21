# Adding a new toggleable module

This describes how to add a new feature to the per-school module-entitlement
system (`modules` / `school_modules` tables, `module_enabled()` RLS function,
`FeatureGuard`, SuperAdmin panel). See `EXECUTION_PLAN.md` for what already
ships; see the two migrations `20260721000023_module_registry.sql` and
`20260721000024_module_enforcement_rls.sql` for the reference implementation.

## 1. Decide: does the feature have a NestJS controller, or is it frontend-direct?

A lot of features in this codebase are implemented as the Next.js frontend
talking directly to Supabase (RLS-protected), with no NestJS route at all —
e.g. document library, quizzes, behaviour tracking. Check whether your new
feature has a controller under `apps/api/src/<feature>/` before picking an
enforcement strategy.

## 2. Register the module

Add one row to the `modules` table via a new migration:

```sql
INSERT INTO public.modules (key, name, description, category, is_core, can_disable, dependencies)
VALUES ('your_module_key', 'Display Name', 'One-line description', 'Category', false, true, '{}')
ON CONFLICT (key) DO NOTHING;
```

- `key` — snake_case, stable forever (referenced by code and by existing
  `school_modules` rows if it's ever renamed — don't rename, add a new key
  and migrate instead).
- `is_core=true, can_disable=false` if this is foundational and should never
  be toggleable (auth, students, attendance, etc.).
- `dependencies` — array of other module keys that must be enabled first.
  Only list genuine functional dependencies (e.g. `ai_features` depends on
  `document_library` because the AI tutor's RAG reads document chunks) — not
  core modules, since those are always on anyway.

## 3a. If it has a NestJS controller — add the guard

```ts
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';

@Controller('your-feature')
@UseGuards(AuthGuard, FeatureGuard)
@RequireModule('your_module_key')
export class YourFeatureController { ... }
```

Add your module key to the `ModuleKey` union type in
`apps/api/src/common/decorators/require-module.decorator.ts`.

This is a fast-fail UX layer only (nicer 403 than a silently-empty RLS
response) — **you still need step 3b**, because the guard uses the
service-role client and doesn't go through RLS itself.

## 3b. Fold `module_enabled()` into the table's RLS policies

Every table this feature touches needs its policies updated, in a new
migration:

```sql
DROP POLICY IF EXISTS "your_table_select" ON public.your_table;
CREATE POLICY "your_table_select" ON public.your_table FOR SELECT USING (
  school_id = current_school_id() AND module_enabled(school_id, 'your_module_key')
  -- ...plus whatever role/ownership logic the policy already had
);
```

Do this for every `SELECT`/`INSERT`/`UPDATE`/`DELETE` policy on every table
the module owns. This is the **actual** enforcement boundary — it's what
stops a frontend-direct Supabase call, and it's what backstops the NestJS
guard too (since that guard uses the service-role client).

## 4. Add it to the frontend nav (if it has a page)

In `apps/web/app/(dashboard)/DashboardShell.tsx`, add `moduleKey:
'your_module_key'` to the relevant `NavItem` entries in the `NAV` map. The
existing `.filter()` in the component handles hiding it automatically.

For the page itself, add a check using `useModuleAccess()`
(`apps/web/lib/hooks/useModuleAccess.ts`) and render a "not enabled" state
instead of the normal page content if `!isModuleEnabled('your_module_key')`.
Don't rely on the nav being hidden alone — a user can still type the URL.

## 5. Verify

- `pnpm build` — confirm everything compiles.
- With no `school_modules` row for your key, confirm the feature works
  exactly as before (default-enabled — this is what makes rollout safe for
  existing schools).
- From the SuperAdmin panel, disable it for a test school → confirm the nav
  item disappears, the page shows the disabled state, and (if applicable)
  the NestJS route returns 403 while a direct Supabase call also returns
  nothing.
- Re-enable it → confirm existing data for that feature is still there
  (disabling never deletes data — it's a boolean flip).
