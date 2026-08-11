# school_manager

Multi-tenant school management platform. Built for parents, students, teachers, and admins.

## Stack

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui (PWA)
- **Backend:** NestJS + TypeScript
- **Database:** PostgreSQL (Supabase) with Row-Level Security
- **Auth:** Supabase Auth
- **Storage:** Supabase Storage (Cloudflare R2 was the original plan; Supabase Storage is what's actually wired for avatars, assignment submissions, and the document library)
- **Cache/Queue:** none currently — Upstash Redis is provisioned in env config but not referenced anywhere in the codebase yet
- **Monorepo:** Turborepo + pnpm

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template and fill in your Supabase credentials
cp .env.example .env

# 3. Run database migrations
pnpm db:migrate

# 4. Seed the database with a demo school
pnpm db:seed

# 5. Start everything
pnpm dev
```

Web: http://localhost:3000
API: http://localhost:4000

## Project Structure

```
school_manager/
├── apps/
│   ├── web/         # Next.js frontend (PWA)
│   ├── api/         # NestJS backend
│   └── mobile/      # React Native (v0.5+)
├── packages/
│   ├── db/          # Prisma schema, migrations, seed
│   ├── types/       # Shared TS types + Zod schemas
│   ├── ui/          # Shared shadcn/ui components
│   └── config/      # ESLint, TSConfig presets
├── infra/           # Docker, CI/CD, deployment
└── docs/            # ADRs, runbooks, API docs
```

## Documentation

- [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) - Phased development plan starting from v0.1
- [docs/adr/](./docs/adr/) - Architecture decision records
- [docs/runbooks/](./docs/runbooks/) - Operational runbooks

## Status page

`docs/runbooks/incident-response.md` already assumes a public Better Stack (or equivalent) status page exists — as of Phase 0 sub-sprint 4 it doesn't yet. Setup is an owner action (a paid third-party account, not something committed to this repo):

1. Create a Better Stack (or Uptime Robot / Statuspage.io) account.
2. Add two monitors: the API's `GET /health` (now a real DB + notifications-dispatcher check, not hardcoded — see `apps/api/src/app.controller.ts`) and the web frontend's root `/`, both on a 60-second interval, email-only alerts to the project owner.
3. Once the public status page URL exists, add it to the commented placeholder in `apps/web/app/(marketing)/pricing/page.tsx`'s footer and update this section with the real link.

## License

Proprietary. All rights reserved.
# School-Management
