#!/usr/bin/env bash
# backup.sh — dump the POS MongoDB database and keep the last N days of backups.
#
# Usage:
#   MONGODB_URI="mongodb://..." bash backup.sh
#
# Environment variables (can also be set in a .env file next to this script):
#   MONGODB_URI      required  full connection string
#   BACKUP_DIR       optional  where to store dumps   (default: ~/pos-backups)
#   RETAIN_DAYS      optional  days of backups to keep (default: 14)
#
# Dependencies: mongodump (part of MongoDB Database Tools)
#   https://www.mongodb.com/docs/database-tools/mongodump/

set -euo pipefail

# ── Load .env if present ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
if [[ -f "$ENV_FILE" ]]; then
  # Export only lines that look like KEY=VALUE (skip comments and blanks).
  set -o allexport
  # shellcheck disable=SC1090
  source <(grep -E '^[A-Z_]+=.+' "$ENV_FILE")
  set +o allexport
fi

# ── Config ────────────────────────────────────────────────────────────────────
MONGODB_URI="${MONGODB_URI:?MONGODB_URI is required}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/pos-backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$TIMESTAMP"

mkdir -p "$DEST"

echo "[backup] Starting dump → $DEST"
mongodump --uri="$MONGODB_URI" --out="$DEST" --gzip

# Compress the whole dump into a single archive and remove the raw folder.
ARCHIVE="$BACKUP_DIR/pos-$TIMESTAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$BACKUP_DIR" "$TIMESTAMP"
rm -rf "$DEST"

echo "[backup] Archive created: $ARCHIVE ($(du -sh "$ARCHIVE" | cut -f1))"

# ── Retention: delete archives older than RETAIN_DAYS ────────────────────────
echo "[backup] Removing backups older than $RETAIN_DAYS days…"
find "$BACKUP_DIR" -maxdepth 1 -name 'pos-*.tar.gz' -mtime +"$RETAIN_DAYS" -delete

echo "[backup] Done. Current backups:"
ls -lh "$BACKUP_DIR"/pos-*.tar.gz 2>/dev/null || echo "  (none)"
