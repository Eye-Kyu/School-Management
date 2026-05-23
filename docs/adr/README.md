# Architecture Decision Records

This folder captures the significant decisions made while building the school
management platform.

## What is an ADR?

An ADR (Architecture Decision Record) documents a single decision: the problem
context, the decision made, why this option was chosen over alternatives, and
the consequences of the choice.

## When to write one

When you choose between meaningful alternatives and a future reader might
otherwise undo your work thinking you didn't consider the alternative.

Short list of triggers:
- Choosing a library, framework, or service
- Deciding on a data shape that will be hard to change
- Any decision where "why didn't we do X instead?" is a fair question

## Format

Use `TEMPLATE.md`. File names: `NNNN-short-title.md` (zero-padded 4 digits).

## Status values

- **Proposed** - written, not yet reviewed
- **Accepted** - accepted by the team
- **Superseded by ADR NNNN** - replaced; keep the old file, update its status
- **Deprecated** - no longer relevant but kept for history

## Index

- [0001 - PostgreSQL via Supabase](./0001-postgresql-via-supabase.md)
- [0002 - Supabase Auth](./0002-supabase-auth.md)
- [0003 - Next.js 14 frontend](./0003-nextjs-frontend.md)
- [0004 - NestJS API](./0004-nestjs-api.md)
- [0005 - Monorepo with pnpm + Turborepo](./0005-monorepo-pnpm-turbo.md)
