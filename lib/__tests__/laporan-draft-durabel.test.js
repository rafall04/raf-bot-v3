/**
 * Header Doc
 * Purpose: Membuktikan draft laporan gangguan pelanggan bertahan melewati restart — ditulis ke
 *          disk, dipindai ulang saat boot/tick, dan dipromosikan jadi tiket.
 * Caller: Jest test runner.
 * Deps: `../laporan-draft-store`.
 * MainFuncs: —
 * SideEffects: Menulis berkas store SEMENTARA di direktori temp; tak menyentuh database/.
 *
 * KENAPA ADA: draft hanya hidup di `stateStore` (objek memori) dengan promosi lewat
 * `setTimeout` 15 menit. Pelanggan lapor "internet mati", dibimbing troubleshooting, menjawab
 * "1" — bot menyiapkan ticketData LENGKAP tapi belum membuat tiketnya. Bila produksi restart
 * 8 menit kemudian (7-13x/hari), stateStore dan timernya lenyap: tak ada tiket, teknisi tak
 * tahu ada laporan, pelanggan terlanjur menerima balasan yang menyiratkan laporannya
 * diproses, dan TIDAK ADA SATU BARIS LOG pun yang menandainya hilang.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const store = require("../laporan-draft-store");

let berkas;

beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raf-draft-"));
    berkas = path.join(dir, "laporan-drafts.json");
});

afterEach(() => {
    try {
        fs.rmSync(path.dirname(berkas), { recursive: true, force: true });
    } catch (_e) { /* abaikan */ }
});

const draftContoh = {
    step: "GANGGUAN_MATI_AWAITING_PHOTO",
    ticketData: { ticketId: "6A8ZJTL", issueType: "MATI", priority: "HIGH" },
    targetUser: { id: 101, name: "Budi" },
    deviceStatus: { minutesAgo: 45 },
};

describe("draft bertahan melewati restart", () => {
    test("draft yang disimpan bisa dibaca kembali dari disk", () => {
        store.simpanDraft("628111@s.whatsapp.net", draftContoh, berkas);

        // Membaca ULANG dari berkas = persis yang terjadi sesudah pm2 restart.
        const hasil = store.ambilDraft("628111@s.whatsapp.net", berkas);

        expect(hasil).toBeTruthy();
        expect(hasil.ticketData.ticketId).toBe("6A8ZJTL");
        expect(hasil.targetUser.name).toBe("Budi");
    });

    test("satu pelanggan hanya punya satu draft aktif", () => {
        store.simpanDraft("628111@s.whatsapp.net", draftContoh, berkas);
        store.simpanDraft(
            "628111@s.whatsapp.net",
            { ...draftContoh, ticketData: { ticketId: "BARU123" } },
            berkas
        );

        expect(store.loadDrafts(berkas)).toHaveLength(1);
        expect(store.ambilDraft("628111@s.whatsapp.net", berkas).ticketData.ticketId).toBe("BARU123");
    });

    test("draft pelanggan lain tak ikut terhapus", () => {
        store.simpanDraft("628111@s.whatsapp.net", draftContoh, berkas);
        store.simpanDraft("628222@s.whatsapp.net", draftContoh, berkas);

        store.hapusDraft("628111@s.whatsapp.net", berkas);

        expect(store.ambilDraft("628111@s.whatsapp.net", berkas)).toBeNull();
        expect(store.ambilDraft("628222@s.whatsapp.net", berkas)).toBeTruthy();
    });
});

describe("pemindaian kedaluwarsa menggantikan setTimeout yang hilang", () => {
    test("draft yang baru dibuat BELUM kedaluwarsa", () => {
        store.simpanDraft("628111@s.whatsapp.net", draftContoh, berkas);

        expect(store.listDraftKedaluwarsa(Date.now(), berkas)).toHaveLength(0);
    });

    test("draft melewati 15 menit muncul sebagai kedaluwarsa", () => {
        store.simpanDraft("628111@s.whatsapp.net", draftContoh, berkas);

        const nanti = Date.now() + store.UMUR_KEDALUWARSA_MS + 1000;
        const kedaluwarsa = store.listDraftKedaluwarsa(nanti, berkas);

        expect(kedaluwarsa).toHaveLength(1);
        expect(kedaluwarsa[0].ticketData.ticketId).toBe("6A8ZJTL");
    });

    test("batas kedaluwarsa selaras STATE_TIMEOUT conversation-handler (15 menit)", () => {
        expect(store.UMUR_KEDALUWARSA_MS).toBe(15 * 60 * 1000);
    });
});

describe("tahan-gagal, tak menjatuhkan bot", () => {
    test("berkas rusak dianggap kosong, bukan melempar", () => {
        fs.writeFileSync(berkas, "{ini bukan json", "utf8");

        expect(() => store.loadDrafts(berkas)).not.toThrow();
        expect(store.loadDrafts(berkas)).toEqual([]);
    });

    test("berkas belum ada dianggap kosong", () => {
        expect(store.loadDrafts(path.join(path.dirname(berkas), "belum-ada.json"))).toEqual([]);
    });

    test("simpanDraft menolak masukan tak lengkap tanpa melempar", () => {
        expect(store.simpanDraft(null, draftContoh, berkas)).toBe(false);
        expect(store.simpanDraft("628111@s.whatsapp.net", {}, berkas)).toBe(false);
        expect(store.loadDrafts(berkas)).toEqual([]);
    });

    test("prune membuang draft yang sangat tua", () => {
        store.simpanDraft("628111@s.whatsapp.net", draftContoh, berkas);
        const drafts = store.loadDrafts(berkas);
        drafts[0].createdAtMs = Date.now() - 48 * 60 * 60 * 1000;
        store.saveDrafts(drafts, berkas);

        expect(store.pruneDraft(24 * 60 * 60 * 1000, berkas)).toBe(1);
        expect(store.loadDrafts(berkas)).toEqual([]);
    });
});

describe("penyambungan ke handler & scheduler", () => {
    const baca = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");

    test("smart-report-handler menulis draft saat menyiapkan ticketData", () => {
        const src = baca("message", "handlers", "smart-report-handler.js");

        expect(src).toMatch(/simpanDraftLaporan\(/);
        expect(src).toMatch(/hapusDraftLaporan\(/);
        expect(src).toMatch(/pindaiDraftLaporanTertunda/);
    });

    test("pemindai dijadwalkan saat boot DAN berkala", () => {
        const src = baca("lib", "app-runtime.js");
        const blok = src.slice(src.indexOf("MATI_DRAFT_SCAN"));

        // Boot saja tak cukup: draft bisa kedaluwarsa saat proses sedang hidup.
        expect(blok).toMatch(/setTimeout\(jalankanPindai/);
        expect(blok).toMatch(/setInterval\(jalankanPindai/);
    });

    test("draft TIDAK dihapus saat promosi gagal — dicoba lagi tick berikutnya", () => {
        const src = baca("message", "handlers", "smart-report-handler.js");
        const fungsi = src.slice(
            src.indexOf("async function promoteMatiDraftOnTimeout"),
            src.indexOf("async function pindaiDraftLaporanTertunda")
        );
        const posisiCatch = fungsi.indexOf("} catch (error) {");
        const posisiHapus = fungsi.indexOf("hapusDraftLaporan(");

        expect(posisiHapus).toBeGreaterThan(-1);
        expect(posisiHapus).toBeLessThan(posisiCatch);
    });
});

describe("draft dibuang di SEMUA jalur penyelesaian — bukan hanya timeout", () => {
    const baca = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", ...p), "utf8");

    test("jalur normal (skip/lanjut/timeout-5-menit) ikut menghapus draft", () => {
        const src = baca("message", "handlers", "customer-photo-handler.js");

        // Tiga jalur itu membuat tiket lalu menghapus state. Kalau draft di disk TIDAK ikut
        // dibuang, pemindai 5-menitan mempromosikannya lagi → TIKET KEDUA untuk satu laporan.
        expect(src).toMatch(/hapusDraftLaporan|hapusDraft/);
        expect(src).toMatch(/function tutupPercakapanLaporan/);

        // Tak boleh ada lagi jalur yang menghapus state TANPA membuang draft.
        const jalurTelanjang = src
            .split(/\r?\n/)
            .filter((b) => /^\s{8}deleteUserState\(sender\);/.test(b));
        expect(jalurTelanjang).toEqual([]);
    });

    test("pembatalan pelanggan juga membuang draft", () => {
        const src = baca("message", "handlers", "smart-report-handler.js");

        // Tanpa ini, pelanggan yang mengetik "batal" tetap menerima tiket beberapa menit
        // kemudian — bot membuat tiket untuk laporan yang justru DIBATALKAN.
        expect(src).toMatch(/registerStateCancelHandler\('GANGGUAN_MATI_AWAITING_PHOTO'/);
        expect(src).toMatch(/registerStateCancelHandler\('LEMOT_AWAITING_PHOTO'/);
    });

    test("penghapusan draft tak boleh menjatuhkan balasan ke pelanggan", () => {
        const src = baca("message", "handlers", "customer-photo-handler.js");
        const fungsi = src.slice(src.indexOf("function tutupPercakapanLaporan"));

        expect(fungsi.slice(0, 500)).toMatch(/try\s*\{/);
        expect(fungsi.slice(0, 500)).toMatch(/catch/);
    });
});
