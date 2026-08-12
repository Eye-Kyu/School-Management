# PostHog setup

This app sends product analytics to PostHog (EU region). Locally it reads
`apps/web/.env.local`. **In Vercel, nothing is set by default — someone with
Vercel project access has to add these manually.** This file cannot do that
for you.

## Required env vars

| Var | What it's for | Secret? |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key. Client-visible by design — this is how the browser SDK identifies which PostHog project to send events to. | No — safe to expose |
| `NEXT_PUBLIC_POSTHOG_HOST` | Which PostHog region to send events to. Use `https://eu.i.posthog.com` — this project is on the EU host (matches `next.config.js`'s `/ingest` rewrite destinations and `PostHogProvider.tsx`'s `ui_host`; changing one without the others will break event delivery or the in-app toolbar). | No |
| `POSTHOG_HASH_SALT` | Salt for hashing user identities before they reach PostHog (see `docs/audits/posthog-capture-audit.md`). **Deliberately not `NEXT_PUBLIC_`-prefixed** — it must never reach the browser bundle, or it stops being a secret and the hashing it enables becomes pointless. | **Yes — treat as a secret** |

`POSTHOG_API_KEY` appears in `.env.example` but nothing in this codebase
currently reads it (`lib/posthog-server.ts` uses `NEXT_PUBLIC_POSTHOG_KEY`
for server-side capture too) — noted here so it isn't assumed to be load-bearing;
not required for anything to work today.

## Setting these in Vercel

1. Vercel dashboard → this project → **Settings → Environment Variables**.
2. Add each of the 3 vars above:
   - `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` → apply to
     **Production** and **Preview** (preview deploys are useful to see in
     PostHog too, e.g. to sanity-check an event before it ships).
   - `POSTHOG_HASH_SALT` → apply to **Production** and **Preview**. Mark it
     as **Sensitive** in Vercel's own UI (Vercel hides sensitive values from
     the dashboard after saving — this doesn't change how the app reads it,
     just who can see the raw value later).
   - Leave all 3 **unset for Development** in Vercel — local development
     already gets them from `apps/web/.env.local`, which is git-ignored.
3. Redeploy (env var changes don't apply to already-built deployments).

### Generating `POSTHOG_HASH_SALT`

```
openssl rand -base64 32
```

Any long random string works — it just needs to be unpredictable and
consistent (changing it later re-hashes every future event under a new,
unlinkable identity, which is fine, but means historical PostHog data can no
longer be joined against new data by hashed ID).

## Verifying events actually arrive after deploy

The `/ingest` reverse-proxy rewrite (`next.config.js`) was missing before
this PR — event capture likely didn't work in **any** environment, not just
production (see `docs/audits/posthog-capture-audit.md`'s summary). After
deploying with the 3 env vars set:

1. Open PostHog → your project → **Activity → Live events** (or **Activity
   → Explore**).
2. In another tab, open the production site and click around: load a page
   (should produce a `$pageview`), sign in (`user_signed_in`), do something
   role-specific (e.g. submit a quiz as a student, mark attendance as a
   teacher).
3. Events should appear in the live-events view within ~30 seconds.
4. Spot-check: a `$pageview` on a page with a dynamic ID in its URL (e.g.
   a student-360 page) should show `:id` in `$current_url`, not a real
   UUID — confirms the masking in `lib/analytics/maskUrl.ts` is active.
5. Spot-check: any signed-in user's events should show a distinct ID that's
   a 64-character hex string (a SHA-256 hash), not a UUID that matches a
   real `users.auth_id` — confirms `lib/analytics/anonymize.ts` is active
   and `POSTHOG_HASH_SALT` is actually set (if it's missing, the
   `/api/analytics/identity` route throws and `identify()` never fires —
   check Vercel's function logs for that route if events show up but are
   never identified to a role).

If nothing shows up at all after a few minutes: check that
`NEXT_PUBLIC_POSTHOG_HOST` matches the region your PostHog project actually
lives in (EU vs US projects are entirely separate — a key from one won't
authenticate against the other's ingestion host), and check the browser
network tab for the page's own requests to `/ingest/...` — a 404 there means
the rewrite isn't deployed or `vercel.json`/another config is overriding it.
