/**
 * Header Doc
 * Purpose: Uji lib/voucher-orphan.js — record/list/get/resolve worklist voucher orphan
 *   (bayar-sukses-gagal-terbit & terbit-tanpa-tagihan). Resolve harus idempotent (anti dobel
 *   fulfill voucher non-idempotent) dan memisah status open/resolved dengan benar.
 * Caller: jest (npm test).
 * Deps: lib/voucher-orphan.js (via json-store → database/voucher_orphans.json; file asli
 *   diparkir & dipulihkan saat teardown agar data nyata tak tertimpa).
 * MainFuncs: recordVoucherOrphan, listVoucherOrphans, getVoucherOrphan, resolveVoucherOrphan.
 * SideEffects: Menulis database/voucher_orphans.json sementara (dipulihkan pasca-test).
 */
"use strict";

const fs = require("fs");
const { VOUCHER_ORPHAN_FILE } = require("../voucher-orphan");

let orphan;
let originalContent = null;

beforeEach(() => {
    jest.resetModules();
    if (fs.existsSync(VOUCHER_ORPHAN_FILE)) {
        originalContent = fs.readFileSync(VOUCHER_ORPHAN_FILE, "utf8");
    } else {
        originalContent = null;
    }
    fs.writeFileSync(VOUCHER_ORPHAN_FILE, "[]");
    orphan = require("../voucher-orphan");
});

afterEach(() => {
    if (originalContent === null) {
        if (fs.existsSync(VOUCHER_ORPHAN_FILE)) fs.unlinkSync(VOUCHER_ORPHAN_FILE);
    } else {
        fs.writeFileSync(VOUCHER_ORPHAN_FILE, originalContent);
    }
});

test("recordVoucherOrphan menambah entri open dengan id+timestamp", () => {
    orphan.recordVoucherOrphan({ type: "buynowweb_callback", reference_id: "ref1", sender: "628123", amount: 5000, profile: "P1H", error: "mikrotik down" });
    const all = orphan.listVoucherOrphans({ status: "all" });
    expect(all).toHaveLength(1);
    expect(all[0].id).toMatch(/^orphan_/);
    expect(all[0].resolved).toBe(false);
    expect(all[0].reference_id).toBe("ref1");
    expect(all[0].timestamp).toBeTruthy();
});

test("listVoucherOrphans memfilter status open/resolved + terbaru dulu", async () => {
    orphan.recordVoucherOrphan({ sender: "a1", voucherCode: "VC1", profile: "P", price: 1000, reason: "deduct_failed" });
    await new Promise((r) => setTimeout(r, 5));
    orphan.recordVoucherOrphan({ type: "buynow_callback", reference_id: "ref2", sender: "a2", amount: 2000, profile: "P2", error: "x" });
    const open = orphan.listVoucherOrphans({ status: "open" });
    expect(open).toHaveLength(2);
    // Terbaru dulu
    expect(open[0].reference_id).toBe("ref2");
    // Resolve entri pertama → pindah ke resolved
    const first = all_get(0);
    orphan.resolveVoucherOrphan(first.id, { action: "manual", resolvedBy: "admin1" });
    expect(orphan.listVoucherOrphans({ status: "open" })).toHaveLength(1);
    expect(orphan.listVoucherOrphans({ status: "resolved" })).toHaveLength(1);
    function all_get(i) { return orphan.listVoucherOrphans({ status: "all" })[i]; }
});

test("resolveVoucherOrphan menandai resolved + menyimpan resolusi; ganda ditolak", () => {
    orphan.recordVoucherOrphan({ type: "buynowweb_callback", reference_id: "ref3", sender: "628", amount: 3000, profile: "P3" });
    const entry = orphan.getVoucherOrphan(orphan.listVoucherOrphans({ status: "all" })[0].id);
    const updated = orphan.resolveVoucherOrphan(entry.id, { action: "fulfill", note: "via panel", resolvedBy: "admin2", voucherCode: "ABC-123" });
    expect(updated).not.toBeNull();
    expect(updated.resolved).toBe(true);
    expect(updated.resolvedBy).toBe("admin2");
    expect(updated.resolution).toEqual({ action: "fulfill", note: "via panel", voucherCode: "ABC-123" });
    // Resolve kedua → null (anti dobel-fulfill voucher)
    expect(orphan.resolveVoucherOrphan(entry.id, { action: "manual" })).toBeNull();
    // ID tak dikenal → null
    expect(orphan.resolveVoucherOrphan("orphan_xyz", { action: "manual" })).toBeNull();
});

test("getVoucherOrphan mengembalikan entri by id / null bila absen", () => {
    orphan.recordVoucherOrphan({ sender: "b1" });
    const id = orphan.listVoucherOrphans({ status: "all" })[0].id;
    expect(orphan.getVoucherOrphan(id).sender).toBe("b1");
    expect(orphan.getVoucherOrphan("tidak-ada")).toBeNull();
});
