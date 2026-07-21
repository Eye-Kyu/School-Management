# Deploying School Manager to Render

This repo is a pnpm/turborepo monorepo with two deployable services:

- `apps/api` — NestJS backend (Prisma + Supabase)
- `apps/web` — Next.js frontend (Supabase SSR)

A `render.yaml` Blueprint is already committed at the repo root, so both
services can be created together instead of configuring each by hand.

## 0. Fixes already applied in this pass

- `apps/web/app/(auth)/reset-password/page.tsx`, `update-password/page.tsx`,
  and `apps/web/app/safety/page.tsx` now export `dynamic = 'force-dynamic'`.
  These pages create a Supabase browser client at render time; without this,
  Next tries to prerender them at build time and crashes if
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` aren't present
  during the build — which is the error from your last deploy log.
- `apps/web/package.json` — `start` script now binds to
  `next start -p ${PORT:-3000}` instead of a hardcoded port, so it works with
  whatever port Render assigns.
- `.env.example` — added the missing `NEXT_PUBLIC_API_URL` var (used by
  `apps/web/lib/api/index.ts` to reach the API).
- `render.yaml` — new Blueprint defining both services (below).

Commit and push these before deploying.

## 1. Prerequisites

- Push this repo to GitHub/GitLab (Render deploys from a connected repo).
- Have your Supabase project's URL + keys ready (Project Settings → API, and
  Settings → Database for the connection strings).

## 2. Create the Blueprint on Render

1. Render Dashboard → **New** → **Blueprint**.
2. Connect the repo. Render detects `render.yaml` and shows both services
   (`school-manager-api`, `school-manager-web`) for review.
3. Click **Apply** — this creates both services but the first deploy will
   fail until you fill in the secrets below (that's expected).

## 3. Fill in environment variables

`render.yaml` marks secrets as `sync: false`, meaning Render creates the key
but leaves the value blank for you to paste in the dashboard.

**On `school-manager-api`:**

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase → Settings → Database → Connection string, **Transaction pooler**, port `6543`, append `?pgbouncer=true` |
| `DIRECT_URL` | Same page, **Session/Direct connection**, port `5432` (used only for migrations) |
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key (keep secret) |
| `JWT_SECRET` | Any long random string (`openssl rand -base64 32`) |
| `SENTRY_DSN` | Optional — from your Sentry project, leave blank to disable |

**On `school-manager-web`:**

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` above |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as `SUPABASE_ANON_KEY` above |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional |
| `POSTHOG_API_KEY` | Optional — only if PostHog analytics is wired up |

Both `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_API_URL` are already set as
plain (non-secret) values in `render.yaml`, pointing at each other's
`onrender.com` URLs. Update them if you rename the services or add a custom
domain.

> `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` are read by
> `payments.service.ts` but fail gracefully with a 400 if unset — add them
> only once you're ready to accept payments. Redis, R2, Resend, and
> Africa's Talking/WhatsApp vars aren't referenced by any code yet, so skip
> them for now.

## 4. Why the monorepo build is set up this way

- **`corepack prepare pnpm@9.0.0`** in the build command pins the exact pnpm
  version from `packageManager` in `package.json`, so Render doesn't fall
  back to a different pnpm version.
- **`pnpm install` runs at the repo root**, not inside `apps/api` or
  `apps/web`, because pnpm needs the workspace root to resolve
  `workspace:*` dependencies between `apps/*` and `packages/*`.
- **`DATABASE_URL`/`DIRECT_URL` must be set on *both* services**, even
  though only the API uses Prisma at runtime. `packages/db` has a
  `postinstall: prisma generate` script, and `prisma generate` reads
  `schema.prisma`, which references `env("DATABASE_URL")` /
  `env("DIRECT_URL")`. Since `pnpm install` at the workspace root runs every
  package's `postinstall`, the web build will fail at `pnpm install` if
  these are missing — not because web uses the database, but because the
  install step touches the whole workspace. `render.yaml` already includes
  placeholders for both on the API service; if the web build ever fails
  during install with a Prisma env error, add the same two vars there too.
- **`turbo run build --filter=@school-manager/api...`** (with the trailing
  `...`) builds that package *and its workspace dependencies*
  (`@school-manager/db`, `@school-manager/types`) in the right order,
  without also building the unrelated web app.
- **`preDeployCommand: pnpm --filter @school-manager/db migrate:deploy`**
  runs `prisma migrate deploy` after a successful build but before the new
  instance receives traffic — this is how schema migrations get applied on
  every deploy without running them from your laptop.
- **`healthCheckPath: /health`** on the API matches the endpoint already
  defined in `apps/api/src/app.controller.ts`.

## 5. First deploy checklist

1. Push the fixes from step 0.
2. Fill in all `sync: false` env vars on both services (step 3).
3. Trigger **Manual Deploy** on `school-manager-api` first, confirm
   `/health` returns `{"status":"ok"}` and the Prisma migration ran (check
   the "Pre-Deploy" log tab).
4. Deploy `school-manager-web`, confirm the build completes without the
   Supabase prerender error, and that `/login`, `/reset-password`, and
   `/safety` all load.
5. Log in through the deployed web app and confirm it reaches the API (no
   CORS errors in the browser console — `NEXT_PUBLIC_APP_URL` on the API
   service must exactly match the web service's real URL, protocol
   included).

## 6. Common errors to watch for

- **CORS errors in the browser**: `apps/api/src/main.ts` only allows the
  single origin in `NEXT_PUBLIC_APP_URL`. If you add a custom domain, update
  that env var on the API service to match exactly (including `https://`,
  no trailing slash).
- **"Environment variable not found: DATABASE_URL" during `pnpm install`**:
  means one of the two services is missing `DATABASE_URL`/`DIRECT_URL` —
  see the explanation in step 4.
- **Migrations not applied**: check the API service's "Pre-Deploy" log —
  `preDeployCommand` failures block the deploy from going live, which is
  intentional (better than serving with a stale schema).
- **Free/starter plan cold starts**: Render's free tier spins down after
  inactivity; the first request after idle can take 30–60s. Upgrade the
  plan if that's not acceptable for production.
