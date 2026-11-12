# Finishing the V1 security fixes: owner checklist

Companion to `docs/audits/security-audit-2026-11-tracker.md`. Code for every V1 and V2 item is on branch `security/audit-v1-fixes`. Migrations 091–101 are **already applied to the live database**. The steps below are the parts only you can do: credentials, dashboards, approvals and the deploy.

> **Deploy soon (step 2).** Migration 099 hides the quiz answer key from direct reads. The live teacher quiz page and the student quiz review page still run code that selects `correct_option_id`, so they error until the web app on this branch is deployed. Quiz submission itself works now (migration 101).

Do the steps in this order. Each has a "done when" check.

---

## Step 1: Set Railway variables (before deploying)

The new API code fails closed. Set these first, or the deploy will switch features off.

In **Railway → the `apps/api` service → Variables**:

| Variable | Value | If you skip it |
|---|---|---|
| `NOTIFICATION_HMAC_SECRET` | A new random value: run `openssl rand -hex 32` locally and paste the output | Payment notifications go out **without** receipt links, and old links are rejected (SA-05) |
| `MPESA_ALLOWED_IPS` | Safaricom's published callback IP ranges as comma-separated CIDRs (from the Daraja portal or Safaricom support) | **Every Paybill callback is rejected** and payments stop reconciling (SA-04) |
| `MPESA_DARAJA_MODE` | `production` (anything except the exact word `sandbox` enforces the allowlist) | Allowlist is enforced anyway; set it explicitly for clarity |
| `PAYSTACK_SECRET_KEY` | Confirm it exists and is not empty | Paystack webhooks and verify are refused (SA-07) |
| `NODE_ENV` | `production` | `sandbox` mode would be allowed to skip the IP check |
| `TRUST_PROXY_HOPS` | Optional. Leave unset (= 1, the previous behaviour) until you've checked step 1a | Nothing changes; the default is the old value (SA-22) |

**Done when:** the first five show in the Railway Variables tab for the production API service.

### Step 1a: Confirm Railway's proxy hop count (SA-22)

The Paybill IP check uses the client IP taken from `X-Forwarded-For`. If Railway puts more than one proxy in front of the API, the hop count must match, or a caller could spoof a Safaricom IP.

1. On a **staging** API service, deploy a temporary route that logs `req.ip`, `req.socket.remoteAddress` and the raw `X-Forwarded-For` header. Or ask Claude to add one behind an env flag.
2. Send one request with a fake header: `curl -H "X-Forwarded-For: 1.2.3.4" https://<staging-api>/<route>`.
3. Set `TRUST_PROXY_HOPS` to the number of proxy entries Railway itself appends: usually 1. If `req.ip` comes out as `1.2.3.4`, the value is too high.
4. Remove the diagnostic route.

**Done when:** `req.ip` shows your real public IP, not `1.2.3.4`. SA-22 can then be ticked.

---

## Step 2: Commit, push and deploy the branch

The live database already has the new rules, so deploy promptly.

1. Tell Claude to commit, or run `git add` and `git commit` yourself on `security/audit-v1-fixes`.
2. Push and open a pull request into `main`.
3. Merge once CI's `build` job is green. The `database-checks` job will wait for your approval: see step 4.
4. Let Railway (API) and Vercel (web) deploy `main`.

**Done when:**
- Creating a super-admin from the super-admin UI works.
- A student can upload an assignment file, and the teacher can open it. The link opens through a short-lived signed URL.

---

## Step 3: Create a non-production Supabase project for CI

CI's e2e suite creates and deletes real rows. It should never point at production.

1. In the **Supabase dashboard**, create a new project, e.g. `skuli-ci`.
2. Apply all migrations to it in filename order (`supabase/migrations/*.sql`), the same way you applied 091–096.
3. In **Project Settings → API**, note the project URL, the `anon` key and the `service_role` key.
4. In **Project Settings → Database**, copy the **direct** connection string (port 5432, not the pooler).
5. Pick a `JWT_SECRET` for CI. Any long random string works (`openssl rand -hex 32`), because CI only signs test assist tokens.

**Done when:** the new project has all migrations applied, and you have the 5 values ready.

---

## Step 4: Put the 5 secrets in the `ci-database` environment

The environment already exists, with you as required reviewer.

**Easiest:** tell Claude "set the CI secrets". It runs `gh secret set NAME --env ci-database` for each name, and you paste each value when prompted. Values are not echoed or kept in the chat.

**Or yourself:** in **GitHub → repo Settings → Environments → `ci-database` → Environment secrets**, add:

- `DATABASE_URL`: the **direct** connection string from step 3 (the scripts use `psql`, which rejects pooled URLs)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`

**Done when:** a CI run on a PR shows `database-checks` waiting. Click **Review deployments → Approve**, and the RLS check, migration parity check and e2e pass against the CI project.

---

## Step 5: Delete the repository-level copies

Do this **only after** the new `ci.yml` is on `main` (step 2) **and** step 4 passes. Deleting earlier breaks CI. It can't be undone, but you can always re-add a secret.

In **GitHub → Settings → Secrets and variables → Actions → Repository secrets**, delete:
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`.

Leave `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SENTRY_AUTH_TOKEN` alone. No workflow uses them, and they're outside SA-03.

Or tell Claude "delete the repo-level CI secrets". It lists them and asks before running `gh secret delete`.

**Done when:** `gh secret list` no longer shows those five, and the next CI run still passes `database-checks`. That proves the job reads the environment's copies. SA-03 can then be ticked.

---

## Step 6: Decide on public sign-up (SA-10 follow-through)

The signup attack is closed either way. Decide whether self-signup should exist at all: every real account is created by an admin through the API.

In **Supabase → Authentication → Sign In / Providers**, review **Allow new users to sign up**. Turning it off removes the surface entirely. Keep it on only if a public signup flow is planned.

**Done when:** the setting matches what you want, and the decision is noted in the tracker.

---

## Step 7: Recommended GitHub hardening (optional, a few minutes)

- **Fork PR approvals:** Settings → Actions → General → *Approval for running fork pull request workflows from contributors* → **Require approval for all external contributors**. The repo is public.
- **Branch protection on `main`:** require at least 1 approving review (currently 0).

---

## Step 8: Fix local env files (developer convenience)

These don't affect production, but they break local testing.

- `apps/api/.env`: `DATABASE_URL` and `DIRECT_URL` are stale (the pooler rejects them). Copy the working values from the root `.env`.
- `JWT_SECRET` differs between `apps/api/.env` and the root `.env`. The API signs assist tokens and the web app verifies them, so they must match, or assist mode won't work locally.
- Add `NOTIFICATION_HMAC_SECRET` and `MPESA_DARAJA_MODE="sandbox"` to `apps/api/.env` for local runs.

---

## Step 9: Optional cleanup of old test data

Earlier e2e runs (July–August) left fixtures in the live database: 60 orphan SUPER_ADMIN `users` rows and 13 auth users with emails ending `@test-isolation.internal`, plus the `test-kilimani-primary-school` sample seed. The e2e cleanup has been fixed, so no new orphans accumulate. Tell Claude whether to remove the old ones. The sample seed has its own `teardown:sample-school` script.

---

### Quick status

| Item | What's left |
|---|---|
| SA-03 | Steps 3, 4 and 5 |
| SA-04, SA-05, SA-07 | Step 1, so the deploy doesn't switch Paybill or receipts off |
| SA-02, SA-10, SA-12, SA-13 and everything else | Step 2, so production runs the fixed code |
| SA-10 | Step 6: decide on sign-up |
