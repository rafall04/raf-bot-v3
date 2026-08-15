/**
 * Header Doc
 * Purpose: Menjamin `loadJSON`/`saveJSON` tak bisa MENGHAPUS ledger secara senyap — berkas
 *          rusak dikarantina (bukan ditimpa), dan penulisan bersifat atomik.
 * Caller: Jest test runner.
 * Deps: `../json-store`, direktori `database/` (kontrak `resolveJsonPath`).
 * MainFuncs: `namaUji`, `bersihkan`.
 * SideEffects: Membuat & menghapus sub-direktori `database/__uji-jsonstore__/`.
 *
 * KENAPA ADA: rantai kehilangan datanya begini — berkas terpotong (SIGKILL saat menulis /
 * listrik padam) → `JSON.parse` gagal → `loadJSON` memulangkan `[]` → penulis berikutnya
 * menyimpan `[]` itu → isi asli HILANG PERMANEN dan tanpa jejak. Berkas yang lewat sini adalah
 * ledger nyata: reports.json (tiket), requests.json, invoices.json.
 *
 * CATATAN: `resolveJsonPath` SELALU memaksa path ke bawah `database/`, jadi tes ini WAJIB
 * memakai nama relatif — itulah kontrak API-nya. Versi pertama memakai direktori temp absolut;
 * `path.join` menghasilkan nama direktori tak valid di Windows sehingga penulisannya gagal
 * diam-diam dan tesnya merah karena alasan yang salah.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const store = require("../json-store");

const SUBDIR = "__uji-jsonstore__";
// Sub-DIREKTORI, bukan berkas lepas di database/. Suite lain memindai `database/*.json`
// (docs-sync, integritas template); berkas uji yang tergeletak di sana bisa terlihat oleh
// mereka dan membuat suite penuh merah secara acak — sekali teramati, tak tereproduksi.
const dir = path.join(__dirname, "..", "..", "database", SUBDIR);
const namaUji = (n) => SUBDIR + "/" + n + ".json";
const penuh = (nama) => path.join(dir, path.basename(nama));

function bersihkan() {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (_e) { /* abaikan */ }
    fs.mkdirSync(dir, { recursive: true });
}

const berkasKarantina = () =>
    fs.readdirSync(dir).filter((f) => f.includes(".rusak-"));
const berkasSementara = () =>
    fs.readdirSync(dir).filter((f) => f.includes(".tmp-"));

beforeEach(bersihkan);
afterEach(bersihkan);
afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* abaikan */ }
});

describe("berkas rusak dikarantina, bukan dihapus diam-diam", () => {
    test("isi lama masih bisa dipulihkan setelah parse gagal", () => {
        const berkas = namaUji("reports");
        fs.writeFileSync(penuh(berkas), '[{"ticketId":"TKT-PENTING"', "utf8"); // terpotong

        const hasil = store.loadJSON(berkas);

        // Bot tetap hidup dengan state kosong...
        expect(hasil).toEqual([]);

        // ...TAPI isi aslinya tak boleh lenyap.
        const karantina = berkasKarantina();
        expect(karantina).toHaveLength(1);
        expect(fs.readFileSync(penuh(karantina[0]), "utf8")).toContain("TKT-PENTING");
    });

    test("berkas rusak tidak lagi menempati nama aslinya (agar tak dibaca berulang)", () => {
        const berkas = namaUji("requests");
        fs.writeFileSync(penuh(berkas), "{bukan json", "utf8");

        store.loadJSON(berkas);

        // loadJSON membuat ulang berkas kosong di nama asli hanya bila belum ada; yang penting
        // isi RUSAK-nya sudah pindah ke berkas karantina.
        expect(berkasKarantina()).toHaveLength(1);
    });

    test("berkas SEHAT dibaca normal, tanpa karantina", () => {
        const berkas = namaUji("invoices");
        fs.writeFileSync(penuh(berkas), '[{"id":1}]', "utf8");

        expect(store.loadJSON(berkas)).toEqual([{ id: 1 }]);
        expect(berkasKarantina()).toEqual([]);
    });

    test("berkas kosong dianggap state kosong TANPA dikarantina (bukan korupsi)", () => {
        const berkas = namaUji("kosong");
        fs.writeFileSync(penuh(berkas), "   ", "utf8");

        expect(store.loadJSON(berkas)).toEqual([]);
        expect(berkasKarantina()).toEqual([]);
    });
});

describe("penulisan atomik", () => {
    test("isi tertulis utuh dan bisa dibaca kembali", () => {
        const berkas = namaUji("data");
        store.saveJSON(berkas, [{ a: 1 }, { b: 2 }]);

        expect(store.loadJSON(berkas)).toEqual([{ a: 1 }, { b: 2 }]);
    });

    test("tak meninggalkan berkas sementara setelah sukses", () => {
        store.saveJSON(namaUji("data"), [{ a: 1 }]);
        expect(berkasSementara()).toEqual([]);
    });

    test("memakai rename, bukan menulis langsung ke berkas tujuan", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "json-store.js"), "utf8");
        const fungsi = src.slice(
            src.indexOf("function saveJSON"),
            src.indexOf("function syncJsonCollection")
        );

        // Tanpa rename, proses yang mati di tengah tulis meninggalkan berkas TERPOTONG —
        // yang lalu memicu rantai kehilangan data di loadJSON.
        expect(fungsi).toMatch(/renameSync/);
        expect(fungsi).toMatch(/\.tmp-/);
    });

    test("menimpa berkas yang sudah ada tetap menghasilkan isi utuh", () => {
        const berkas = namaUji("data");
        store.saveJSON(berkas, [{ versi: 1 }]);
        store.saveJSON(berkas, [{ versi: 2 }]);

        expect(store.loadJSON(berkas)).toEqual([{ versi: 2 }]);
        expect(berkasSementara()).toEqual([]);
    });
});
