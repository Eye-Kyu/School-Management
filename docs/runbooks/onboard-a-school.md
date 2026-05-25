# Onboard a New School

This runbook covers deploying the platform and onboarding the first school.
As features ship in v0.2+, add steps for notifications setup, payment account linking, etc.

**Total time:** 30 min deploy + 1–2 hours of admin data entry + 1 hour training.

---

## Pre-requisites (first deploy only)

Install CLIs:
```bash
npm i -g pnpm vercel @railway/cli supabase
```

---

## Deploy Step A — Environment variables

Copy `.env.example` → `.env`. Fill in all blank values:

| Variable | Where |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → pooler connection (port 6543) |
| `DIRECT_URL` | Supabase → Project Settings → Database → direct connection (port 5432) |
| `SUPABASE_URL` | Project URL + `/rest/v1/` |
| `SUPABASE_ANON_KEY` | Project Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role (**keep secret**) |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (no trailing slash) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as anon key |
| `NEXT_PUBLIC_APP_URL` | Your web URL, e.g. `https://myschool.vercel.app` |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `SENTRY_DSN` | Sentry → api project → Settings → DSN |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → web project → Settings → DSN |

---

## Deploy Step B — Apply database migrations

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

Verify in Table Editor: `schools`, `users`, `teachers`, `students`, `guardians`, `classes`, `subjects`, `terms`, `timetable_slots`, `attendance_records`, `fee_balances`, `announcements`, `audit_logs` all exist.

---

## Deploy Step C — Seed demo data

```bash
cd packages/db
SUPABASE_URL="https://YOUR_REF.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
pnpm exec tsx prisma/seed.ts
```

Creates demo school + accounts for all four roles.

---

## Deploy Step D — Deploy `apps/api` to Railway

1. Push repo to GitHub.
2. Railway dashboard → New Project → Deploy from GitHub.
3. Set root directory: `apps/api`, start command: `pnpm start:prod`.
4. Add environment variables (all non-`NEXT_PUBLIC_` vars from `.env`).
5. Copy the generated Railway URL.
6. Verify: `curl https://your-api.up.railway.app/health` → `{"status":"ok"}`.

---

## Deploy Step E — Deploy `apps/web` to Vercel

1. Vercel dashboard → New Project → Import from GitHub.
2. Set root directory: `apps/web`, framework: `Next.js`.
3. Add environment variables (all `NEXT_PUBLIC_*` vars from `.env`, plus `NEXT_PUBLIC_API_URL=https://your-api.up.railway.app`).
4. Deploy. Verify: login page renders without errors.

---

## Post-deploy smoke test

| Test | Expected result |
|---|---|
| Login as `admin@demo.school` | Redirect to `/admin`, stat cards load |
| Create a teacher | Returns temp password |
| Create a student | Returns temp password |
| Login as teacher, mark attendance | Submits without error |
| Login as parent | Child cards load |
| Trigger a 500 (DELETE non-existent ID) | Event appears in Sentry within 1 min |

---

## Troubleshooting

**"Invalid API key" on seed** — Service role key has extra quotes. Strip them in your shell before setting the env var.

**`supabase db push` fails** — Direct Postgres (port 5432) may be blocked on some networks. Use a mobile hotspot, or apply migrations via the Supabase dashboard SQL editor.

**Parent dashboard shows "No students linked"** — Guardian row missing. Go Admin → Parents, remove and re-create the parent with correct admission numbers.

**API 502 on Railway** — Check Railway build logs. Most common cause: missing env var or build failure. Run `pnpm build` locally in `apps/api` first.

---

## Before the meeting

- [ ] School has signed an LOI or contract.
- [ ] School has provided: school name, slug preference, principal name &
      email, phone number, mailing address.
- [ ] We've agreed on which classes/grades to onboard first (start narrow:
      one or two classes, not the whole school).

## Step 1: Create the school in production

As a platform admin via the seed script (real admin UI arrives in v0.4):

```bash
# Adjust the seed script or run a one-off script
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm --filter @school-manager/db tsx scripts/create-school.ts \
  --name "Saint Mary's Primary" \
  --slug saint-marys
```

Verify:
```sql
SELECT id, name, slug FROM schools WHERE slug = 'saint-marys';
```

## Step 2: Create the principal's admin account

Use Supabase dashboard -> Auth -> Add user. Set a temporary password and
require change on first login.

Then mirror them in our `users` table:
```sql
INSERT INTO users (school_id, auth_id, email, full_name, role)
VALUES ('<school-id>', '<auth-id>', 'principal@school.tld', 'Jane Mwangi', 'ADMIN');
```

## Step 3: Walk the principal through their dashboard

In person or video call. About 60 minutes. Cover:
1. Logging in and changing the temporary password.
2. Creating classes (Grade 5 Blue, etc).
3. Creating subjects.
4. Adding the first teacher account.
5. Uploading the student CSV.
6. Reviewing the timetable grid.

## Step 4: Send the welcome email

Subject: Welcome to School Manager - your account is ready.
Body: login URL, the principal's username (not the password - they should
already have it), a link to the parent-onboarding guide, and our support
email.

## Step 5: Mark them as onboarded

In our internal CRM (Notion for now), update the school's record:
- Status: Live
- v0.1 features enabled: timetable, attendance, arrears, announcements
- Pilot end date (for free pilots): set
- Next check-in: 1 week from now
