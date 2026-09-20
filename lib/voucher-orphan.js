/**
 * Header Doc
 * Purpose: Catat voucher "orphan" — pelanggan SUDAH BAYAR tapi voucher gagal di-generate
 *   (mis. MikroTik down saat callback) ATAU voucher terlanjur dibuat tapi penagihan gagal
 *   (saldo/agent rollback). Tanpa catatan ini, voucher bocor diam-diam (rugi ISP / pelanggan
 *   komplain) dan admin tak tahu harus fulfill yang mana. File ini jadi worklist rekonsiliasi
 *   admin — dibaca & di-resolve lewat halaman `/voucher-orphans` (API /api/voucher/orphans).
 * Caller: routes/public/payment-callback.js (callback buynow/buynowweb/buynowpanel),
 *   services/payment-flow.service.js, lib/voucher-manager.js, lib/agent-voucher-manager.js
 *   (pencatatan); routes/api-voucher-routes.js (baca + resolve).
 * Deps: `lib/json-store` (loadJSON karantina-korup + saveJSON ATOMIK).
 * MainFuncs: recordVoucherOrphan, listVoucherOrphans, getVoucherOrphan, resolveVoucherOrphan.
 * SideEffects: Membaca/menulis `database/voucher_orphans.json` (ATOMIK).
 */
"use strict";

const path = require("path");
const { loadJSON, saveJSON } = require("./json-store");

const VOUCHER_ORPHAN_FILE = path.join(__dirname, "..", "database", "voucher_orphans.json");

// Nama file untuk json-store (di-resolve ke database/voucher_orphans.json).
const STORE_NAME = "voucher_orphans.json";

function _readAll() {
    const parsed = loadJSON(STORE_NAME);
    return Array.isArray(parsed) ? parsed : [];
}

function _writeAll(list) {
    saveJSON(STORE_NAME, list);
}

function recordVoucherOrphan(entry) {
    try {
        const list = _readAll();
        list.push({
            id: `orphan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            resolved: false,
            ...entry,
        });
        if (list.length > 500) list = list.slice(-500);
        _writeAll(list);
    } catch (err) {
        console.error("[VOUCHER_ORPHAN] Gagal mencatat orphan:", err.message);
    }
}

/**
 * Baca worklist untuk halaman admin. `status`: 'open' (default) | 'resolved' | 'all'.
 * Terbaru dulu. Best-effort: file hilang/korup → [] (loadJSON sudah mengkarantina korup).
 */
function listVoucherOrphans({ status = "open" } = {}) {
    let list = _readAll();
    if (status === "open") list = list.filter((o) => !o.resolved);
    else if (status === "resolved") list = list.filter((o) => !!o.resolved);
    return list.slice().reverse();
}

function getVoucherOrphan(id) {
    return _readAll().find((o) => o && o.id === id) || null;
}

/**
 * Tandai orphan ter-resolve. `resolution` = {action, note, voucherCode} — apa yang admin lakukan
 * (fulfill=terbitkan baru, send=kirim kode existing, manual=tindak manual/refund). resolvedBy =
 * username staf penindak. Returns entry ter-update, atau null bila id tak ada / sudah resolved.
 * Tolak resolve GANDA — aksi fulfill membuat voucher MikroTik (non-idempotent).
 */
function resolveVoucherOrphan(id, { action, note, resolvedBy, voucherCode } = {}) {
    try {
        const list = _readAll();
        const idx = list.findIndex((o) => o && o.id === id);
        if (idx === -1) return null;
        if (list[idx].resolved) return null;
        list[idx] = {
            ...list[idx],
            resolved: true,
            resolvedAt: new Date().toISOString(),
            resolvedBy: resolvedBy || null,
            resolution: {
                action: action || "manual",
                note: note || "",
                voucherCode: voucherCode || null,
            },
        };
        _writeAll(list);
        return list[idx];
    } catch (err) {
        console.error("[VOUCHER_ORPHAN] Gagal menandai resolved:", err.message);
        return null;
    }
}

module.exports = {
    recordVoucherOrphan,
    listVoucherOrphans,
    getVoucherOrphan,
    resolveVoucherOrphan,
    VOUCHER_ORPHAN_FILE,
};
