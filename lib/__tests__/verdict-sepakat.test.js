/**
 * Header Doc
 * Purpose: Mengunci vonis jalur berbasis KESEPAKATAN antar target (#b264) — satu target kronis
 *          tak boleh membuat seluruh jalur divonis terganggu di mata pelanggan.
 * Caller: Jest test runner.
 * Deps: `lib/upstream-quality-poller` (_internal.verdictBySepakat).
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const { _internal } = require("../upstream-quality-poller");
const v = _internal.verdictBySepakat;

describe("#b264 — satu target buruk bukan berarti jalur buruk", () => {
    test("!! KASUS NYATA: 6 target 0% loss + `meta` 24,6% → jalur NORMAL", () => {
        // Terukur di Tanjungharjo 2026-08-24. Dengan `worstVerdict`, jalur ini divonis GANGGUAN
        // dan SETIAP pelanggan yang cek koneksi diberi tahu "sebagian jalur terganggu" —
        // padahal yang bermasalah peering ke Meta, bukan jaringan kita.
        expect(v(["NORMAL", "NORMAL", "NORMAL", "GANGGUAN", "NORMAL", "NORMAL", "NORMAL"])).toBe("NORMAL");
    });

    test("dua target sepakat buruk → dilaporkan", () => {
        expect(v(["NORMAL", "GANGGUAN", "GANGGUAN", "NORMAL"])).toBe("GANGGUAN");
    });

    test("gangguan nyata (semua target jatuh) tetap tertangkap", () => {
        expect(v(["PUTUS", "PUTUS", "PUTUS"])).toBe("PUTUS");
        expect(v(["GANGGUAN", "GANGGUAN", "GANGGUAN", "GANGGUAN"])).toBe("GANGGUAN");
    });

    test("tingkat campuran mengambil yang disepakati, bukan yang terparah", () => {
        // 1 PUTUS + 2 DEGRADASI → PUTUS hanya didukung 1 target; DEGRADASI didukung 3 (kumulatif).
        expect(v(["PUTUS", "DEGRADASI", "DEGRADASI", "NORMAL"])).toBe("DEGRADASI");
    });

    test("target tunggal: tuntutan kesepakatan turun ke 1 — jangan jadi buta", () => {
        // Kalau hanya satu target dikonfigurasi, menuntut 2 kesepakatan = jalur tak pernah
        // dilaporkan buruk sama sekali.
        expect(v(["GANGGUAN"])).toBe("GANGGUAN");
        expect(v(["NORMAL"])).toBe("NORMAL");
    });

    test("ambang kesepakatan dapat dinaikkan lewat config", () => {
        expect(v(["NORMAL", "GANGGUAN", "GANGGUAN", "NORMAL"], 3)).toBe("NORMAL");
        expect(v(["GANGGUAN", "GANGGUAN", "GANGGUAN", "NORMAL"], 3)).toBe("GANGGUAN");
    });

    test("kosong / tak wajar → UNKNOWN, bukan menebak sehat", () => {
        expect(v([])).toBe("UNKNOWN");
        expect(v(null)).toBe("UNKNOWN");
        expect(v(undefined)).toBe("UNKNOWN");
    });

    // #b332 — array NON-KOSONG berisi semua UNKNOWN (target ada tapi sampel < minSamples saat
    // insiden / DB baru terisi sedikit) DULU jatuh ke "NORMAL" (UNKNOWN ber-severity 0 tak pernah
    // memicu return di loop). Pelanggan yang mengeluh saat gangguan justru dibantah "terpantau
    // normal". 'Tak bisa diamati' ≠ 'teramati sehat'.
    test("!! semua target UNKNOWN (bukan array kosong) → UNKNOWN, bukan NORMAL", () => {
        expect(v(["UNKNOWN", "UNKNOWN"])).toBe("UNKNOWN");
        expect(v(["UNKNOWN"])).toBe("UNKNOWN");
        expect(v(["UNKNOWN", "UNKNOWN", "UNKNOWN"], 3)).toBe("UNKNOWN");
    });

    test("ada minimal satu bukti non-UNKNOWN (sehat) → NORMAL sah", () => {
        // Satu target NORMAL + sisanya UNKNOWN: ada bukti nyata → NORMAL, bukan UNKNOWN.
        expect(v(["NORMAL", "UNKNOWN"])).toBe("NORMAL");
    });

    test("semua sehat → NORMAL", () => {
        expect(v(["NORMAL", "NORMAL", "NORMAL"])).toBe("NORMAL");
    });
});

describe("#b264 — dipakai oleh laporan status jalur", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "upstream-quality-poller.js"), "utf8");

    test("status jalur memakai verdictBySepakat, bukan worstVerdict", () => {
        expect(src).toMatch(/status: targets\.length \? verdictBySepakat\(/);
        expect(src).not.toMatch(/status: targets\.length \? worstVerdict\(/);
    });
});
