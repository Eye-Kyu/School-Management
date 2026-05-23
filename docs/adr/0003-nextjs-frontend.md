# ADR 0003 - Next.js 14 (App Router) for the web frontend

## Status

Accepted

## Context

We need a web frontend that works as a PWA on low-end Android phones, serves
four role-specific dashboards, and shares types with the NestJS API.

## Decision

Next.js 14 with the App Router and Tailwind CSS.

The App Router's server components let us fetch data without a separate BFF
layer. Route groups `(auth)` / `(dashboard)` handle per-role layouts cleanly.
Supabase's `@supabase/ssr` package is designed for Next.js App Router.

## Alternatives considered

- **Remix:** Similar server-first philosophy. Smaller ecosystem, fewer Supabase
  examples, no static generation.
- **SvelteKit:** Excellent DX, fast bundles. React ecosystem is more mature for
  our use case and team familiarity favors React.
- **Vite + React SPA:** No SSR. Public routes (login, landing) should be
  server-rendered for SEO and first-paint performance.
- **tRPC + Next.js API routes (no separate API):** Would eliminate the network
  hop. But server components + API routes don't support background jobs well
  and can't easily run outside Vercel.

## Consequences

**Easier:**
- Role-based routing via route groups is first-class Next.js.
- PWA manifest is straightforward to add.

**Harder:**
- Server/client component boundary adds mental overhead.
- `transpilePackages` required for workspace packages in dev mode.

**Exit strategy if wrong:**
- The API is fully decoupled. Replacing the frontend is a redeploy.
