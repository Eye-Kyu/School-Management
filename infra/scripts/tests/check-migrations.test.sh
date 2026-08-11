#!/usr/bin/env bash
# =============================================================================
# Regression tests for infra/scripts/check-migrations.sh
# =============================================================================
# Written after BUG-5 (docs/bug-triage.md): the migration parity check had
# zero test coverage of its own, which is part of why a false-negative in it
# went unnoticed. Exercises the real script against a throwaway Postgres —
# never against $DATABASE_URL (production).
#
# Local usage (reuses infra/docker/docker-compose.yml's local Postgres):
#   docker compose -f infra/docker/docker-compose.yml up -d
#   TEST_DATABASE_URL=postgresql://postgres:dev@localhost:5432/school_manager \
#     ./infra/scripts/tests/check-migrations.test.sh
#
# In CI: TEST_DATABASE_URL points at a postgres:16-alpine service container
# instead (see .github/workflows/ci.yml).
# =============================================================================

set -euo pipefail

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is required (a throwaway Postgres — never production)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/../check-migrations.sh"

FAILURES=0

# Fresh, known _migration_log + scratch table before every case, so cases
# never depend on each other's leftover state.
reset_db() {
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP TABLE IF EXISTS public._migration_log;
DROP TABLE IF EXISTS public._test_scratch;
CREATE TABLE public._migration_log (
  filename    TEXT        NOT NULL PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL
}

register() {
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO public._migration_log (filename) VALUES ('$1');"
}

# Runs $CHECK_SCRIPT against a scratch migrations dir + the throwaway DB,
# without letting a non-zero exit (which several cases expect) kill this
# test script under set -e.
run_check() {
  local dir="$1"
  set +e
  OUTPUT=$(MIGRATIONS_DIR="$dir" DATABASE_URL="$TEST_DATABASE_URL" bash "$CHECK_SCRIPT" 2>&1)
  ACTUAL_EXIT=$?
  set -e
}

assert_case() {
  local name="$1" expected_exit="$2" expect_substring="$3"

  if [[ "$ACTUAL_EXIT" -ne "$expected_exit" ]]; then
    echo "FAIL: $name (expected exit $expected_exit, got $ACTUAL_EXIT)"
    echo "$OUTPUT" | sed 's/^/    /'
    FAILURES=$((FAILURES + 1))
    return
  fi

  if [[ -n "$expect_substring" ]] && ! grep -qF "$expect_substring" <<< "$OUTPUT"; then
    echo "FAIL: $name (exit code $ACTUAL_EXIT was correct, but output didn't contain expected text: \"$expect_substring\")"
    echo "$OUTPUT" | sed 's/^/    /'
    FAILURES=$((FAILURES + 1))
    return
  fi

  echo "PASS: $name"
}

# -----------------------------------------------------------------------
# Case 1: everything on disk is registered, and the one ADD COLUMN target
# among them was actually applied for real. Expect: exit 0.
# -----------------------------------------------------------------------
case1() {
  local dir
  dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' RETURN

  reset_db

  cat > "$dir/20990101000001_test_create.sql" <<'SQL'
CREATE TABLE IF NOT EXISTS public._test_scratch (id INT);
SQL
  cat > "$dir/20990101000002_test_addcol.sql" <<'SQL'
ALTER TABLE public._test_scratch
  ADD COLUMN IF NOT EXISTS test_col TEXT;
SQL

  # Actually apply both, for real — this is the "correctly applied" case.
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$dir/20990101000001_test_create.sql"
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$dir/20990101000002_test_addcol.sql"
  register "20990101000001_test_create.sql"
  register "20990101000002_test_addcol.sql"

  run_check "$dir"
  assert_case "all migrations applied and registered -> exit 0" 0 "OK"
}

# -----------------------------------------------------------------------
# Case 2: a migration file exists on disk but was never registered.
# Expect: exit non-zero, NOT_APPLIED reported.
# -----------------------------------------------------------------------
case2() {
  local dir
  dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' RETURN

  reset_db

  cat > "$dir/20990101000001_test_unregistered.sql" <<'SQL'
CREATE TABLE IF NOT EXISTS public._test_scratch (id INT);
SQL
  # Deliberately not registered, not applied.

  run_check "$dir"
  assert_case "migration on disk but not registered -> exit non-zero (NOT_APPLIED)" 1 "not applied"
}

# -----------------------------------------------------------------------
# Case 3: the BUG-5 shape — a migration IS registered as applied, but its
# ADD COLUMN target was never actually run. Expect: exit non-zero,
# STALE_COLUMN reported.
# -----------------------------------------------------------------------
case3() {
  local dir
  dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' RETURN

  reset_db

  cat > "$dir/20990101000001_test_create.sql" <<'SQL'
CREATE TABLE IF NOT EXISTS public._test_scratch (id INT);
SQL
  cat > "$dir/20990101000002_test_stale.sql" <<'SQL'
ALTER TABLE public._test_scratch
  ADD COLUMN IF NOT EXISTS missing_col TEXT;
SQL

  # Only the CREATE TABLE is actually applied. The ADD COLUMN file is
  # registered as if it had been applied too, but its SQL never runs —
  # exactly BUG-5's mechanism.
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$dir/20990101000001_test_create.sql"
  register "20990101000001_test_create.sql"
  register "20990101000002_test_stale.sql"

  run_check "$dir"
  assert_case "migration registered but underlying column missing -> exit non-zero (STALE_COLUMN)" 1 "STALE_COLUMN"
}

# -----------------------------------------------------------------------
# Case 4: _migration_log has a row with no matching file on disk.
# Expect: exit non-zero, UNKNOWN reported.
# -----------------------------------------------------------------------
case4() {
  local dir
  dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' RETURN

  reset_db

  cat > "$dir/20990101000001_test_create.sql" <<'SQL'
CREATE TABLE IF NOT EXISTS public._test_scratch (id INT);
SQL
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$dir/20990101000001_test_create.sql"
  register "20990101000001_test_create.sql"
  register "20990101000099_test_ghost.sql"

  run_check "$dir"
  assert_case "migration registered but not on disk -> exit non-zero (UNKNOWN)" 1 "no matching file on disk"
}

echo "[check-migrations.test.sh] Running against $TEST_DATABASE_URL ..."
echo ""

case1
case2
case3
case4

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo "[check-migrations.test.sh] All cases passed."
  exit 0
else
  echo "[check-migrations.test.sh] $FAILURES case(s) failed."
  exit 1
fi
