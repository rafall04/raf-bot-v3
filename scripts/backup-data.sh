#!/usr/bin/env bash
#
# backup-data.sh — Snapshot seluruh folder database/ sebuah bot ke arsip
# ber-timestamp. Berguna sebelum update/migrasi atau sebagai backup berkala.
#
# Pemakaian:
#   bash scripts/backup-data.sh <BOT_DIR> [label]
# Contoh:
#   bash scripts/backup-data.sh /root/bot/raf-dander-v3 harian
#
set -euo pipefail

BOT_DIR="${1:?Pemakaian: backup-data.sh <BOT_DIR> [label]}"
LABEL="${2:-manual}"

DB_DIR="$BOT_DIR/database"
if [ ! -d "$DB_DIR" ]; then
    echo "ERROR: folder database tidak ditemukan: $DB_DIR" >&2
    exit 1
fi

BACKUP_DIR="$BOT_DIR/backups"
mkdir -p "$BACKUP_DIR"

TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/db-${LABEL}-${TS}.tar.gz"

# -C agar arsip berisi path relatif "database/..."
tar -czf "$OUT" -C "$BOT_DIR" database

echo "Backup dibuat: $OUT ($(du -h "$OUT" | cut -f1))"
