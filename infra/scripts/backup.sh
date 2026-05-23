#!/usr/bin/env bash
# =============================================================================
# Nightly logical Postgres backup
# =============================================================================
# Cron this on a small VM (Hetzner $5 box is fine) and ship the result to
# Cloudflare R2. Run as:  ./backup.sh [retention_days]
#
# Required env:
#   DIRECT_URL         - direct (non-pooled) Postgres connection string
#   R2_BUCKET          - R2 bucket name
#   R2_ENDPOINT        - https://<account>.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID  - R2 access key
#   AWS_SECRET_ACCESS_KEY
# =============================================================================

set -euo pipefail

RETENTION_DAYS="${1:-30}"
TS="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-/tmp}"
FILE="${BACKUP_DIR}/backup-${TS}.sql.gz"

: "${DIRECT_URL:?DIRECT_URL is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"

echo "[backup] Dumping to ${FILE}..."
pg_dump "$DIRECT_URL" | gzip > "$FILE"

SIZE=$(du -h "$FILE" | cut -f1)
echo "[backup] Dump complete: ${FILE} (${SIZE})"

echo "[backup] Uploading to R2..."
aws s3 cp "$FILE" "s3://${R2_BUCKET}/backups/$(basename "$FILE")" \
  --endpoint-url "$R2_ENDPOINT"

echo "[backup] Pruning local files older than ${RETENTION_DAYS}d..."
find "$BACKUP_DIR" -name 'backup-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] Done."
