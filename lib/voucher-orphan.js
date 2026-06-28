/**
 * Header Doc
 * Purpose: Catat voucher "orphan" — pelanggan SUDAH BAYAR tapi voucher gagal di-generate
 *   (mis. MikroTik down saat callback). Tanpa catatan ini, voucher bocor diam-diam (rugi
 *   ISP / pelanggan komplain) dan admin tak tahu harus fulfill yang mana. File ini jadi
 *   worklist rekonsiliasi admin. Best-effort: kegagalan tulis tidak mengganggu alur.
 * Caller: routes/public.js (callback buynow/buynowweb), services/payment-flow.service.js (jalur saldo).
 * Deps: fs.
 * MainFuncs: recordVoucherOrphan.
 * SideEffects: Menulis database/voucher_orphans.json.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const VOUCHER_ORPHAN_FILE = path.join(__dirname, "..", "database", "voucher_orphans.json");

function recordVoucherOrphan(entry) {
    try {
        let list = [];
        if (fs.existsSync(VOUCHER_ORPHAN_FILE)) {
            const raw = fs.readFileSync(VOUCHER_ORPHAN_FILE, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) list = parsed;
        }
        list.push({
            id: `orphan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            resolved: false,
            ...entry,
        });
        if (list.length > 500) list = list.slice(-500);
        fs.writeFileSync(VOUCHER_ORPHAN_FILE, JSON.stringify(list, null, 2), "utf8");
    } catch (err) {
        console.error("[VOUCHER_ORPHAN] Gagal mencatat orphan:", err.message);
    }
}

module.exports = { recordVoucherOrphan, VOUCHER_ORPHAN_FILE };
