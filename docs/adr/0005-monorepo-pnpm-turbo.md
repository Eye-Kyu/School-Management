# ADR 0005 - Monorepo with pnpm workspaces and Turborepo

## Status

Accepted

## Context

We have multiple packages that share code:
- `packages/types` exports Zod schemas used by both web and API.
- `packages/db` exports the Prisma client used by the API.
- `packages/ui` exports shared React components.
- `packages/config` exports shared ESLint and TypeScript configs.

We need to decide: monorepo (one repo, multiple packages) or polyrepo
(separate repositories per app/package).

## Decision

pnpm workspaces for package management + Turborepo for task orchestration.

pnpm's `workspace:*` protocol lets packages depend on each other without
publishing to npm. Turborepo adds parallel task execution with caching -
`pnpm build` builds all packages in dependency order, skipping unchanged ones.

## Alternatives considered

- **Polyrepo:** simpler git, but shared types require publishing to a registry
  or vendoring. Drift is constant. Bad for a small team.
- **npm or yarn workspaces:** work, but pnpm is faster, uses less disk space
  (content-addressed store), and has better workspace semantics.
- **Nx instead of Turborepo:** more features, much heavier. Turborepo is
  configured in 30 lines and we're done.

## Consequences

**Easier:**
- Rename a Zod schema, every consumer breaks at compile time. No silent drift.
- One install, one lockfile, one CI pipeline.
- Cross-app refactors (rename a field) are atomic commits.

**Harder:**
- One bad lockfile breaks everything until fixed. Mitigation: CI runs
  `pnpm install --frozen-lockfile`.
- Tooling that doesn't understand workspaces (some legacy linters) needs
  workspace-aware config or per-package config.

**Exit strategy if wrong:**
- Splitting a monorepo back into polyrepos is a 1-2 day script. The opposite
  (consolidating polyrepos) is much worse - so monorepo is the lower-risk
  default.
