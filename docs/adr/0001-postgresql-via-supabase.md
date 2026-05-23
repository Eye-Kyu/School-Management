# ADR 0001 - PostgreSQL via Supabase as the database

## Status

Accepted

## Context

We need a relational database for school data: students, classes, attendance,
fees, announcements. The data is highly structured with meaningful relations,
so a relational model is appropriate.

Key constraints:
- Small team, no dedicated DBA.
- Multi-tenant (one database, many schools), so Row-Level Security is important.
- Budget: the free tier must carry us through the first paying school.

## Decision

Use PostgreSQL, hosted on Supabase.

We use Supabase specifically (rather than bare RDS or Cloud SQL) because:
1. Managed Postgres with point-in-time backups out of the box.
2. Built-in `auth.uid()` function that Row-Level Security policies can use
   directly - saves writing our own token-to-user lookup in every policy.
3. Supabase Storage and Realtime can be layered in later without a new provider.
4. The free tier is generous enough to run a pilot school.

## Alternatives considered

- **PlanetScale (MySQL):** Serverless, good DX. But no RLS, no partial indexes,
  no native enum types. MySQL diverges from SQL standards in ways that hurt.
- **MongoDB:** Flexible schema is nice early. But school data is relational -
  forcing documents onto attendance records makes joins painful.
- **Firebase Firestore:** Zero infra. But no SQL, no RLS, and complex queries
  (fee summaries, report cards) are painful to express.
- **Raw RDS / Cloud SQL:** Same Postgres, more control. But we'd lose the
  Supabase Auth integration and need to run our own connection pooler.

## Consequences

**Easier:**
- RLS policies keep multi-tenant data isolated at the DB layer.
- Full SQL: CTEs, window functions, partial indexes all available.
- Prisma ORM works natively with PostgreSQL.

**Harder:**
- Supabase free tier limits (500 MB DB, 50k MAU). We'll eventually upgrade.
- Every new table needs a corresponding RLS policy migration.

**Exit strategy if wrong:**
- Prisma migrations are standard SQL. Moving to any other Postgres host
  (RDS, Cloud SQL, Neon) is a pg_dump + pg_restore + env var change.
