-- =============================================================================
-- Add SUPER_ADMIN to the UserRole enum
-- =============================================================================
-- Isolated in its own migration/transaction on purpose: Postgres does not allow
-- a newly-added enum value to be used (cast, compared, inserted) in the same
-- transaction that adds it. Every other change that references 'SUPER_ADMIN'
-- lives in the next migration file, applied after this one commits.
-- =============================================================================

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
