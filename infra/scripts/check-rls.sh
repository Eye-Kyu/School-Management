#!/usr/bin/env bash
# =============================================================================
# Sanity check: every tenant-owned table has RLS enabled
# =============================================================================
# Run after every migration. If a new table is added but RLS isn't enabled,
# this fails loudly. Cheaper than discovering it via a cross-tenant leak.
#
# DATABASE_URL must be the DIRECT (non-pooled) connection string, not the
# Prisma/app-runtime pooled one — `psql` rejects the pooled URL's
# `?pgbouncer=true` query parameter outright. Use DIRECT_URL, not
# DATABASE_URL, when running this locally.
#
# Usage:  DATABASE_URL=... ./check-rls.sh
# =============================================================================

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

# Tables that DO NOT need RLS (system-level or no tenant data).
EXEMPT="_prisma_migrations"

echo "[check-rls] Looking for tables with RLS disabled..."

# Find user tables in public schema where rowsecurity is false.
RESULT=$(psql "$DATABASE_URL" -tA <<SQL
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN ('$EXEMPT')
  AND tablename NOT IN (
    SELECT tablename FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    WHERE c.relrowsecurity = true
  )
ORDER BY tablename;
SQL
)

if [[ -z "$RESULT" ]]; then
  echo "[check-rls] OK - all tables have RLS enabled."
  exit 0
fi

echo "[check-rls] FAIL - the following tables have RLS DISABLED:"
echo "$RESULT" | sed 's/^/  - /'
echo ""
echo "Fix: add an RLS migration enabling RLS and writing policies."
exit 1
