#!/usr/bin/env bash
# =============================================================================
# Migration parity check: every file on disk is applied, nothing else is
# =============================================================================
# DATABASE_URL must be the DIRECT (non-pooled) connection string, not the
# Prisma/app-runtime pooled one — `psql` rejects the pooled URL's
# `?pgbouncer=true` query parameter outright ("invalid URI query parameter").
# Use the DIRECT_URL value from RENDER_DEPLOYMENT.md / your .env, not
# DATABASE_URL, when running this locally. (Found the hard way during the
# BUG-5 follow-up PR — noted here so the next person doesn't lose an hour.)
#
# Example (the script itself still reads the env var named DATABASE_URL —
# "DIRECT_URL" above refers to which connection-string *value* to put in
# it, i.e. the direct/non-pooled one from RENDER_DEPLOYMENT.md/.env, not to
# a literal DIRECT_URL variable this script recognizes):
#   DATABASE_URL="<your DIRECT_URL value>" bash infra/scripts/check-migrations.sh
#
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
# -----------------------------------------------------------------------
# BUG-5 postmortem (docs/bug-triage.md) — why this script let a third
# incident of the exact same shape through despite being built to catch it:
#
# notifications.acknowledged_at (20260527000019_notification_ack.sql) was
# registered in _migration_log as applied, but the underlying ALTER TABLE
# had never actually run in production. This script's filename-diff never
# flagged it, and structurally could not have: the registry row for that
# file and this script were both introduced in the SAME commit
# (20260728000072_migration_log.sql's 72-file backfill, "system hardening",
# 2026-07-29). The backfill's own comment claimed every table/column had
# been verified present as of 2026-07-27 — that verification was a manual,
# human assertion, not a tool-checked one, and it was wrong for this one
# file. Since the registry already (incorrectly) contained the filename
# from its very first commit, there was never a CI run where this script
# could have seen "file on disk, not yet registered" for it — the check was
# born already blind to this specific drift.
#
# Root cause: this script only ever compares two lists of filenames
# (on-disk vs. _migration_log). It has no way to verify that a *registered*
# migration's DDL actually took effect — the registry is trusted as ground
# truth, and here the ground truth was wrong from the moment it was
# created. See "Known cases this catches" below for what changed as a
# result, and what's still deliberately out of scope.
#
# A one-time, read-only, full-history audit (2026-07-31) confirmed no
# second silent instance exists today: every ADD COLUMN target across all
# 76 migration files on disk was individually verified present via a live
# probe. See docs/bug-triage.md BUG-5 for the full record.
#
# Known cases this catches:
#   - Migration on disk, not registered in _migration_log (NOT_APPLIED)
#   - Migration registered in _migration_log, not on disk (UNKNOWN)
#   - One of the 5 most recent migrations is registered, but the column its
#     first ADD COLUMN statement was supposed to add doesn't actually exist
#     (STALE_COLUMN — the BUG-5 shape; heuristic, see below)
#
# Explicitly NOT covered (out of scope, stated plainly rather than
# silently assumed away): full structural verification of every migration
# ever written — every CREATE TABLE, index, and RLS policy, beyond the
# 5-most-recent window the STALE_COLUMN check covers, and beyond the ADD
# COLUMN shape specifically. That would mean re-running every DDL
# statement as an idempotent check against production on every CI build —
# expensive, and not what caused any of this project's three drift
# incidents so far. The STALE_COLUMN check is a forward-looking safety net,
# not a retroactive one: it only ever protects a migration while it's still
# within the "5 most recent" window after landing, catching a
# never-actually-applied ALTER within the first few merges after it's
# written, while it's still cheap to fix — it would not, on its own,
# re-catch a 2-month-old file the way BUG-5's was by the time anyone looked.
#
# Usage:  DATABASE_URL=... ./check-migrations.sh
#         DATABASE_URL=... MIGRATIONS_DIR=/path/to/scratch ./check-migrations.sh
# =============================================================================

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Overridable so infra/scripts/tests/check-migrations.test.sh can point this
# at a scratch directory instead of the real migrations — defaults to the
# real path for every normal (non-test) invocation, zero behavior change.
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$(cd "$SCRIPT_DIR/../../supabase/migrations" && pwd)}"

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

# STALE_COLUMN check (BUG-5 shape): for the 5 most recent migrations on
# disk, if the file's first ALTER TABLE ... ADD COLUMN statement names a
# column, confirm that column actually exists in the live schema. Catches a
# migration that's registered as applied in _migration_log but whose DDL
# never actually took effect. Heuristic and forward-looking only — see the
# header comment for exactly what this does and doesn't cover.
RECENT_COUNT=5
RECENT_MIGRATIONS=$(echo "$ON_DISK" | tail -n "$RECENT_COUNT")

while IFS= read -r file; do
  [[ -z "$file" ]] && continue

  # Not yet applied at all is already reported above (NOT_APPLIED) — don't
  # also report it here as "registered but stale," which it isn't.
  if echo "$NOT_APPLIED" | grep -qxF "$file"; then
    continue
  fi

  # First ALTER TABLE ... ADD COLUMN [IF NOT EXISTS] <column> in the file,
  # if any. Most migrations (CREATE TABLE, indexes, RLS policies) have none
  # and are silently skipped — this check only covers the one shape BUG-5
  # was.
  TARGET=$(perl -0777 -ne '
    if (/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?"?(\w+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/is) {
      print "$1 $2";
    }
  ' "$MIGRATIONS_DIR/$file")

  [[ -z "$TARGET" ]] && continue

  TABLE_NAME="${TARGET%% *}"
  COLUMN_NAME="${TARGET##* }"

  EXISTS=$(psql "$DATABASE_URL" -tA -c "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$TABLE_NAME' AND column_name = '$COLUMN_NAME';")

  if [[ -z "$EXISTS" ]]; then
    echo "[check-migrations] FAIL - $file is registered as applied, but its ADD COLUMN target $TABLE_NAME.$COLUMN_NAME does not exist (STALE_COLUMN — registered without the underlying DDL having taken effect):"
    echo "  - $file"
    STATUS=1
  fi
done <<< "$RECENT_MIGRATIONS"

if [[ "$STATUS" -eq 0 ]]; then
  echo "[check-migrations] OK - $(echo "$ON_DISK" | wc -l | tr -d ' ') migrations on disk, all applied, no drift."
fi

exit "$STATUS"
