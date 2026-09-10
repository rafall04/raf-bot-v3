/**
 * Header Doc
 * Purpose: Guard MIGRASI call-site notifikasi ke choke-point notif-router. Memastikan titik-kirim
 *   yang sudah dimigrasi tetap lewat router (kategori benar) — bukan getAdminJids+send langsung.
 *   Pemindai sumber (idiom guard-test repo). Titik baru ditambahkan ke daftar saat dimigrasi.
 * Caller: Jest.
 * Deps: fs.
 * SideEffects: -
 */
"use strict";

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", "..", p), "utf8");

test("beritahuAdminGagal (otorisasi massal) lewat dispatch('otorisasi_gagal') + adminFallback", () => {
    const src = read("services/bulk-approval-job.service.js");
    expect(src).toMatch(/dispatch\(\s*["']otorisasi_gagal["']/);
    expect(src).toMatch(/adminFallback:\s*getAdminJids\(\)/);
    // Tak boleh lagi loop sendMessage langsung di beritahuAdminGagal.
    const fn = src.slice(src.indexOf("async function beritahuAdminGagal"));
    expect(fn.slice(0, fn.indexOf("\n}"))).not.toMatch(/sendMessage\(/);
});

test("_kirimAlarmOltAdmin (OLT all/partial-down) resolve penerima via recipientsFor('los_alarm')", () => {
    const src = read("lib/olt-log-scraper.js");
    expect(src).toMatch(/recipientsFor\(\s*["']los_alarm["']/);
    // Kirim tetap sendCritical + waitForReadyMs (dipertahankan saat migrasi).
    expect(src).toMatch(/waitForReadyMs:\s*8000/);
});
