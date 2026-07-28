#!/usr/bin/env bash
# =============================================================================
# Migration parity check: every file on disk is applied, nothing else is
# =============================================================================
# Prompted by a real incident (Phase 0 sub-sprint 2, 2026-07-27):
# 20260529000019_payments.sql was checked off in EXECUTION_PLAN.md but had
# never actually been applied to production — a checkbox that says "this
# ships" didn't verify it actually shipped. This is the second such incident
# (the first was the gradebook silent-drift bug months earlier).
#
# There is no pre-existing migration registry this project can query —
# `prisma migrate dev` ran once, at project start, then was abandoned in
# favor of hand-applying raw SQL files via the Supabase Studio SQL editor;
# no `_prisma_migrations` or `supabase_migrations.schema_migrations` table
# exists. `public._migration_log` (20260728000072_migration_log.sql) is a
# registry built for this purpose — every migration file ends with a
# self-registering INSERT into it. This script only checks; it never applies
# or writes anything.
#
# Usage:  DATABASE_URL=... ./check-migrations.sh
# =============================================================================

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$(cd "$SCRIPT_DIR/../../supabase/migrations" && pwd)"

echo "[check-migrations] Comparing $MIGRATIONS_DIR against public._migration_log..."

ON_DISK=$(cd "$MIGRATIONS_DIR" && ls -1 *.sql | sort)
LOGGED=$(psql "$DATABASE_URL" -tA -c "SELECT filename FROM public._migration_log ORDER BY filename;")

# Files on disk with no corresponding row — written but never applied.
NOT_APPLIED=$(comm -23 <(echo "$ON_DISK") <(echo "$LOGGED"))

# Rows with no corresponding file — applied (or hand-run) outside the
# tracked migration history.
UNKNOWN=$(comm -13 <(echo "$ON_DISK") <(echo "$LOGGED"))

STATUS=0

if [[ -n "$NOT_APPLIED" ]]; then
  echo "[check-migrations] FAIL - migrations on disk but not applied (missing from _migration_log):"
  echo "$NOT_APPLIED" | sed 's/^/  - /'
  STATUS=1
fi

if [[ -n "$UNKNOWN" ]]; then
  echo "[check-migrations] FAIL - _migration_log rows with no matching file on disk (hand-run or unknown):"
  echo "$UNKNOWN" | sed 's/^/  - /'
  STATUS=1
fi

if [[ "$STATUS" -eq 0 ]]; then
  echo "[check-migrations] OK - $(echo "$ON_DISK" | wc -l | tr -d ' ') migrations on disk, all applied, no drift."
fi

exit "$STATUS"
