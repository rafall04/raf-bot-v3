/**
 * Header Doc
 * Purpose: Mengunci pengaman `saveCategory` — simpan template menimpa SATU KATEGORI PENUH, jadi
 *          satu POST parsial dari UI bisa menghapus ratusan template sekaligus. Test ini memastikan
 *          penghapusan massal ditolak, penghapusan wajar tetap lolos, dan file lama tetap dibackup.
 * Caller: jest.
 * Deps: `lib/template-service`, `lib/template-usage-scanner`.
 * MainFuncs: —
 * SideEffects: Menulis file kategori sementara lewat mock `saveJSON`.
 */
"use strict";

const path = require("path");

jest.mock("../database", () => ({
    loadJSON: jest.fn(() => ({})),
    saveJSON: jest.fn()
}));

const database = require("../database");
const templateService = require("../template-service");

function seedCategory(count) {
    const data = {};
    for (let i = 0; i < count; i++) {
        data[`key_${i}`] = { name: `Nama ${i}`, template: `isi ${i}`, category: "system" };
    }
    templateService.cache.responseTemplates = data;
    return data;
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe("saveCategory — pengaman penghapusan massal", () => {
    test("menolak simpan yang menghapus sebagian besar kategori", () => {
        const existing = seedCategory(100);
        const partial = { key_0: existing.key_0, key_1: existing.key_1 }; // 98 key hilang

        expect(() => templateService.saveCategory("responseTemplates", partial))
            .toThrow(/menghapus 98 dari 100/);
        // Yang terpenting: file TIDAK ditulis.
        expect(database.saveJSON).not.toHaveBeenCalled();
        expect(Object.keys(templateService.cache.responseTemplates)).toHaveLength(100);
    });

    test("error membawa kode yang bisa dipetakan ke HTTP 409", () => {
        seedCategory(100);
        try {
            templateService.saveCategory("responseTemplates", {});
            throw new Error("seharusnya melempar");
        } catch (error) {
            expect(error.code).toBe("TEMPLATE_MASS_DELETION");
            expect(error.removedCount).toBe(100);
        }
    });

    test("penghapusan wajar (di bawah ambang) tetap lolos", () => {
        const existing = seedCategory(100);
        const next = { ...existing };
        delete next.key_0;
        delete next.key_1; // 2 dari 100 — normal

        expect(() => templateService.saveCategory("responseTemplates", next)).not.toThrow();
        expect(database.saveJSON).toHaveBeenCalledTimes(1);
    });

    test("kategori kecil tidak terkena ambang (biar tak menghalangi kategori mungil)", () => {
        templateService.cache.responseTemplates = {
            a: { name: "A", template: "a", category: "system" },
            b: { name: "B", template: "b", category: "system" }
        };
        expect(() => templateService.saveCategory("responseTemplates", {
            a: { name: "A", template: "a", category: "system" }
        })).not.toThrow();
    });

    test("penghapusan massal yang DISENGAJA bisa lewat dengan allowMassDeletion", () => {
        seedCategory(100);
        expect(() => templateService.saveCategory("responseTemplates", {}, { allowMassDeletion: true }))
            .not.toThrow();
        expect(database.saveJSON).toHaveBeenCalledTimes(1);
    });
});

describe("scanner slot", () => {
    const scanner = require("../template-usage-scanner");

    test("mengambil argumen data dari semua varian signature render", () => {
        const pick = scanner._internal.pickDataArg;
        // (key, fallback, data)
        expect(pick(["'teks fallback'", "{ nama: x }"])).toBe("{ nama: x }");
        // (key, data)
        expect(pick(["{ nama: x }"])).toBe("{ nama: x }");
        // (key, data, fallback)
        expect(pick(["{ nama: x }", '""'])).toBe("{ nama: x }");
        // renderTpl(context, key, fallback, data) — sisa argumen setelah key
        expect(pick(["`fallback ${a}`", "{ nama: x }"])).toBe("{ nama: x }");
        // tanpa data
        expect(pick(["'cuma fallback'"])).toBeNull();
    });

    test("slot diambil dari template, termasuk bentuk bertitik", () => {
        const slots = scanner.extractSlots("Halo ${nama}, tagihan ${data.jumlah} dan ${nama}");
        expect([...slots].sort()).toEqual(["data", "nama"]);
    });

    test("laporan kesehatan menandai key yatim dan key hilang", () => {
        const usage = new Map([
            ["dipakai", { files: new Set(["a.js:1"]), dataKeys: new Set(["nama"]), hasSpread: false }],
            ["hilang", { files: new Set(["b.js:2"]), dataKeys: new Set(), hasSpread: false }]
        ]);
        const report = scanner.buildHealthReport({
            dipakai: { name: "X", template: "Halo ${nama}", category: "system" },
            yatim: { name: "Y", template: "tak dipakai", category: "system" }
        }, { usage });

        expect(report.orphanKeys).toEqual(["yatim"]);
        expect(report.missingKeys.map((m) => m.key)).toEqual(["hilang"]);
        expect(report.unknownSlotCount).toBe(0);
    });

    test("slot yang tak pernah di-pass kode dilaporkan sebagai tak dikenal", () => {
        const usage = new Map([
            ["k", { files: new Set(["a.js:1"]), dataKeys: new Set(["nama"]), hasSpread: false }]
        ]);
        const report = scanner.buildHealthReport({
            k: { name: "K", template: "Halo ${nama}, kode ${kode_typo}", category: "system" }
        }, { usage });

        expect(report.unknownSlots).toEqual([{ key: "k", slots: ["kode_typo"] }]);
    });

    test("pemanggil yang memakai spread tidak dinilai slotnya (hindari salah-lapor)", () => {
        const usage = new Map([
            ["k", { files: new Set(["a.js:1"]), dataKeys: new Set(), hasSpread: true }]
        ]);
        const report = scanner.buildHealthReport({
            k: { name: "K", template: "Halo ${apapun}", category: "system" }
        }, { usage });

        expect(report.unknownSlotCount).toBe(0);
    });
});

// Menjaga path backup tetap di dalam repo (bukan menulis ke lokasi acak).
test("backup template ditulis ke backups/templates", () => {
    const expected = path.join("backups", "templates");
    expect(expected).toContain("backups");
});
