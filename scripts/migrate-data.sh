#!/usr/bin/env bash
#
# migrate-data.sh — Salin data operasional dari bot LAMA ke bot BARU dengan aman.
# Selalu backup folder database/ tujuan dulu, menolak jalan bila bot tujuan
# masih berjalan, dan menyalin SQLite via ".backup" agar konsisten terhadap WAL.
#
# Pemakaian:
#   bash scripts/migrate-data.sh <OLD_BOT_DIR> <NEW_BOT_DIR> [minimal|operational]
# Contoh:
#   bash scripts/migrate-data.sh /root/bot/raf-dander /root/bot/raf-dander-v3 minimal
#
# Mode:
#   minimal     -> users.sqlite (pelanggan), packages.json, accounts.json
#   operational -> minimal + saldo, pembayaran, invoice, agen, voucher, laporan,
#                  network asset, PSB, dll. Template/pesan TIDAK disalin (pakai
#                  versi bot baru).
#
# Catatan: config.json TIDAK pernah disalin (konfigurasi bot baru dipertahankan).
#
set -euo pipefail

OLD="${1:?Pemakaian: migrate-data.sh <OLD_BOT_DIR> <NEW_BOT_DIR> [minimal|operational]}"
NEW="${2:?Pemakaian: migrate-data.sh <OLD_BOT_DIR> <NEW_BOT_DIR> [minimal|operational]}"
MODE="${3:-minimal}"

OLDDB="$OLD/database"
NEWDB="$NEW/database"
[ -d "$OLDDB" ] || { echo "ERROR: $OLDDB tidak ada" >&2; exit 1; }
[ -d "$NEWDB" ] || { echo "ERROR: $NEWDB tidak ada" >&2; exit 1; }

# --- Safety: tolak bila bot tujuan masih berjalan (cek cwd proses node) ---
running=""
for p in $(pgrep node 2>/dev/null || true); do
    c=$(readlink "/proc/$p/cwd" 2>/dev/null || true)
    case "$c" in "$NEW"|"$NEW"/*) running="$running $p" ;; esac
done
if [ -n "$running" ]; then
    echo "ABORT: bot tujuan masih berjalan (pid:$running)." >&2
    echo "Hentikan dulu (Ctrl+C pada npm start, atau 'pm2 stop')." >&2
    exit 1
fi

# --- Backup folder database tujuan dulu ---
SELF_DIR=$(cd "$(dirname "$0")" && pwd)
bash "$SELF_DIR/backup-data.sh" "$NEW" "before-migrate"

copy_json() {
    local name="$1"
    if [ -f "$OLDDB/$name" ]; then
        cp -f "$OLDDB/$name" "$NEWDB/$name"
        echo "  json  : $name"
    else
        echo "  -lewati (tak ada): $name"
    fi
}

copy_sqlite() {
    local name="$1"
    if [ -f "$OLDDB/$name" ]; then
        rm -f "$NEWDB/$name" "$NEWDB/$name-wal" "$NEWDB/$name-shm"
        sqlite3 "$OLDDB/$name" ".backup '$NEWDB/$name'"
        echo "  sqlite: $name"
    else
        echo "  -lewati (tak ada): $name"
    fi
}

copy_dir() {
    local name="$1"
    if [ -d "$OLDDB/$name" ]; then
        mkdir -p "$NEWDB/$name"
        cp -rf "$OLDDB/$name/." "$NEWDB/$name/"
        echo "  dir   : $name/"
    fi
}

echo "== Migrasi data: mode=$MODE =="
echo "   dari : $OLDDB"
echo "   ke   : $NEWDB"
echo "-- inti (pelanggan, paket, akun) --"
copy_sqlite users.sqlite
copy_json   packages.json
copy_json   accounts.json

if [ "$MODE" = "operational" ]; then
    echo "-- data operasional tambahan --"
    copy_sqlite saldo.sqlite
    copy_sqlite psb_database.sqlite
    for f in \
        saldo_transactions.json payment.json payment-method.json \
        invoices.json invoice-counter.json network_assets.json \
        mikrotik_devices.json agents.json agent_credentials.json \
        agent_transactions.json agent_voucher_inventory.json \
        agent_voucher_purchases.json agent_voucher_sales.json reseller.json \
        reports.json speed_requests.json speed_boost_matrix.json \
        package_change_requests.json topup_requests.json requests.json \
        voucher.json voucher_purchases.json voucher_sent.json statik.json \
        pppoe.json lid-mappings.json wifi_change_logs.json \
        announcements.json news.json compensations.json metrics.json
    do
        copy_json "$f"
    done
    copy_dir user
    copy_dir locations
fi

echo "== Verifikasi =="
printf "  pelanggan (users): "
sqlite3 "$NEWDB/users.sqlite" "SELECT COUNT(*) FROM users;" 2>&1 || echo "(gagal baca)"
printf "  paket            : "
grep -o '"id"' "$NEWDB/packages.json" 2>/dev/null | wc -l
echo "  akun login       :"
grep -oE '"username"[^,]*' "$NEWDB/accounts.json" 2>/dev/null | sed 's/^/     /' || true

echo
echo "Selesai. Jalankan ulang bot baru (npm start) — migration-manager akan"
echo "meng-upgrade skema SQLite otomatis. Backup tujuan tersimpan di $NEW/backups/."
