"use strict";

/**
 * Header Doc
 * Purpose: Mengunci akses TEKNISI ke angka gajinya sendiri lewat WhatsApp, dan kabar keputusan
 *   kasbon. Sebelum ini teknisi hanya menerima SATU pesan seumur siklus — saat gajinya dibayar.
 *   Ia tak bisa memeriksa komisinya, tak tahu kasbonnya disetujui atau ditolak, dan karena itu
 *   tak bisa membantah angka apa pun. Pihak yang paling dirugikan kalau ada yang salah justru
 *   yang paling sedikit aksesnya.
 * Caller: Jest (`npx jest message/handlers/raf-intent-dispatch/__tests__/gaji-teknisi-intents.test.js`).
 * Deps: modul intent gaji teknisi, fs/path (pindai pendaftaran + template + route kasbon).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..", "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

const { handleGajiSayaIntent, GAJI_TEKNISI_INTENT_HANDLERS } = require("../gaji-teknisi-intents");

function konteks({ isTeknisi, jawaban = [] }) {
    return {
        isTeknisi,
        reply: (t) => {
            jawaban.push(t);
            return t;
        },
        // Meniru perilaku nyata: template TERSIMPAN menimpa fallback; di tes tak ada store,
        // jadi fallback yang dipakai.
        renderResponseTemplate: (_key, fallback) => fallback
    };
}

describe("teknisi bisa memeriksa gajinya sendiri", () => {
    test("bukan teknisi ditolak", async () => {
        const jawaban = [];
        await handleGajiSayaIntent(konteks({ isTeknisi: false, jawaban }));
        expect(jawaban[0]).toMatch(/khusus untuk teknisi/i);
    });

    test("teknisi yang akunnya tak dikenali diberi tahu apa yang harus dilakukan", async () => {
        // `true` tanpa object akun = nomornya cocok pola tapi id-nya tak ada. Diam saja di sini
        // membuat teknisi mengira bot rusak.
        const jawaban = [];
        await handleGajiSayaIntent(konteks({ isTeknisi: true, jawaban }));
        expect(jawaban[0]).toMatch(/belum bisa dikenali/i);
        expect(jawaban[0]).toMatch(/admin/i);
    });

    test("intent terdaftar di peta handler", () => {
        expect(typeof GAJI_TEKNISI_INTENT_HANDLERS.GAJI_SAYA).toBe("function");
    });
});

describe("jalur pendaftaran & teks", () => {
    test("modul intent tersambung ke dispatcher", () => {
        const index = baca("message", "handlers", "raf-intent-dispatch", "index.js");
        expect(index).toMatch(/gaji-teknisi-intents/);
        expect(index).toMatch(/gajiTeknisi:/);
    });

    test("kata kunci GAJI_SAYA terdaftar — tanpa itu perintahnya tak pernah sampai", () => {
        const kw = JSON.parse(baca("database", "wifi_templates.json"));
        const entri = kw.find((x) => x.intent === "GAJI_SAYA");
        expect(entri).toBeTruthy();
        expect(entri.keywords).toEqual(expect.arrayContaining(["gaji saya"]));
        expect(entri.category).toBe("teknisi");
    });

    test("modul gaji teknisi hanya MEMBACA, tak pernah mengubah payroll", () => {
        const src = baca("message", "handlers", "raf-intent-dispatch", "gaji-teknisi-intents.js");
        const kode = src.split(/\r?\n/).filter((b) => !/^\s*(\*|\/\*|\/\/)/.test(b)).join("\n");
        for (const terlarang of ["createPayrollDraft", "finalizePayroll", "payPayroll", "updatePayrollDraft"]) {
            expect(kode).not.toContain(terlarang);
        }
    });

    test("keputusan kasbon dikabarkan ke teknisi, never-throw", () => {
        const route = baca("routes", "kasbon.js");
        expect(route).toMatch(/kabariTeknisiKasbon/);
        expect(route).toMatch(/sendCritical/);
        // Kegagalan kirim tak boleh membatalkan keputusan yang SUDAH tercatat.
        expect(route).toMatch(/catch \(notifErr\)/);
    });

    test("template kasbon terdaftar di store — fallback saja tak pernah terkirim kalau key ada", () => {
        const store = JSON.parse(baca("database", "response_templates.json"));
        expect(store.kasbon_teknisi_disetujui).toBeTruthy();
        expect(store.kasbon_teknisi_ditolak).toBeTruthy();
        // Yang disetujui WAJIB menyebut bahwa uangnya dipotong dari gaji — kalau tidak,
        // potongan di struk gaji datang sebagai kejutan.
        expect(store.kasbon_teknisi_disetujui).toMatch(/dipotong dari gaji/i);
        for (const slot of ["${nama}", "${nominal}"]) {
            expect(store.kasbon_teknisi_disetujui).toContain(slot);
            expect(store.kasbon_teknisi_ditolak).toContain(slot);
        }
    });
});
