# school_manager

Multi-tenant school management platform. Built for parents, students, teachers, and admins.

## Stack

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui (PWA)
- **Backend:** NestJS + TypeScript
- **Database:** PostgreSQL (Supabase) with Row-Level Security
- **Auth:** Supabase Auth
- **Storage:** Cloudflare R2
- **Cache/Queue:** Upstash Redis
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

- [CLAUDE.md](./CLAUDE.md) - Context and conventions for AI-assisted development
- [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) - Phased development plan starting from v0.1
- [docs/adr/](./docs/adr/) - Architecture decision records
- [docs/runbooks/](./docs/runbooks/) - Operational runbooks

## License

Proprietary. All rights reserved.
# School-Management
