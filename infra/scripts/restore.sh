#!/usr/bin/env bash
# =============================================================================
# Restore a Postgres dump
# =============================================================================
# Usage: ./restore.sh <backup-file.sql.gz> <target-database-url>
#
# WARNING: This wipes the target database. Always restore into a fresh DB,
# never directly into production.
# =============================================================================

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <backup-file.sql.gz> <target-database-url>"
  exit 1
fi

BACKUP_FILE="$1"
TARGET_URL="$2"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Error: backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "WARNING: This will OVERWRITE all data in:"
echo "  $TARGET_URL"
read -rp "Type 'yes' to continue: " confirm
if [[ "$confirm" != "yes" ]]; then
  echo "Aborted."
  exit 1
fi

echo "[restore] Decompressing and restoring..."
gunzip -c "$BACKUP_FILE" | psql "$TARGET_URL"
echo "[restore] Done."
echo ""
echo "Next: verify by counting key tables:"
echo "  psql \"$TARGET_URL\" -c 'SELECT count(*) FROM schools;'"
echo "  psql \"$TARGET_URL\" -c 'SELECT count(*) FROM users;'"
