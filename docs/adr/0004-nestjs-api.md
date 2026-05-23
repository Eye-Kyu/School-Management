# ADR 0004 - NestJS for the backend API

## Status

Accepted

## Context

We need a backend API in TypeScript that validates requests, enforces business
rules beyond what RLS can express, and eventually runs background jobs. It must
share types with the frontend monorepo.

## Decision

NestJS with Express as the HTTP adapter.

NestJS's module/controller/service/guard architecture maps cleanly onto
features (attendance module, fees module, etc.). Dependency injection makes
unit testing straightforward. The opinionated structure keeps the codebase
consistent as the team grows.

## Alternatives considered

- **Fastify + custom structure:** Faster than Express. But no built-in DI or
  module system - we'd spend time building structure NestJS provides.
- **Next.js API routes only (no separate API):** Eliminates the network hop.
  But long-running background jobs and non-Vercel deployments become painful.
- **tRPC:** Excellent monorepo type-safety. But the mobile app needs REST
  anyway, so we'd end up building two surfaces.
- **Hono:** Tiny and edge-compatible. Too minimal - no DI, no module system,
  few patterns for apps of this scale.

## Consequences

**Easier:**
- `ZodValidationPipe` + `GlobalExceptionFilter` give consistent responses.
- `AuthGuard` is a single verified token checkpoint.
- `@nestjs/testing` makes integration tests easy.

**Harder:**
- `reflect-metadata` + `emitDecoratorMetadata` are non-standard TS setup.
- Angular-style DI has a learning curve for developers new to NestJS.

**Exit strategy if wrong:**
- Service layer is decoupled from HTTP layer. Moving to Fastify means
  rewriting controllers, not services. Prisma + Supabase integration stays.
