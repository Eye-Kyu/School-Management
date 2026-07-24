-- ============================================================
-- Fix: curricula.code needs a plain unique constraint, not a partial index
-- ============================================================
-- 20260724000057 created `curricula_code_uidx` as a PARTIAL unique index
-- (UNIQUE (code) WHERE code IS NOT NULL). That's redundant — a plain UNIQUE
-- constraint on a nullable column already permits multiple NULLs, since NULL
-- is never equal to NULL — and it broke the seed script's
-- `.upsert(..., { onConflict: 'code' })` call: Postgres can't use a partial
-- index as an ON CONFLICT target via plain `ON CONFLICT (code)` syntax
-- (discovered by actually running the seed script against the live DB).
-- ============================================================

DROP INDEX IF EXISTS public.curricula_code_uidx;
ALTER TABLE public.curricula ADD CONSTRAINT curricula_code_key UNIQUE (code);
