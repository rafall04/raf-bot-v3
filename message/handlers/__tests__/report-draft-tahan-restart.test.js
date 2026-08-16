/**
 * Header Doc
 * Purpose: Mengunci bahwa laporan gangguan yang sedang menunggu foto TIDAK hilang saat proses
 *          restart — draftnya ditulis ke disk, dipindai saat boot, dan tak melahirkan tiket ganda.
 * Caller: Jest test runner.
 * Deps: `message/handlers/smart-report-text-menu.js`, `message/handlers/smart-report-handler.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada (hanya membaca sumber).
 *
 * KENAPA ADA — handler timeout step lampiran sudah menyelamatkan pelanggan yang DIAM: setelah
 * 15 menit tiketnya tetap lahir dan pelanggan diberi tahu. TAPI timer itu hidup di MEMORI
 * bersama `stateStore` (objek biasa, nol persistensi — terverifikasi). Bila proses `pm2 restart`
 * di tengah jendela 15 menit, state DAN timer sama-sama lenyap: tiket tak pernah lahir, teknisi
 * tak pernah tahu, dan pelanggan menunggu tindak lanjut atas laporan yang dari sisinya sudah
 * dibuat — tanpa satu baris log pun.
 *
 * Store durabelnya sudah lama ada dan dipindai saat boot, tapi hanya tersambung ke alur LEGACY
 * (`GANGGUAN_MATI_AWAITING_PHOTO`). Alur yang benar-benar dipakai pelanggan hari ini
 * (text-menu, `REPORT_MATI_PHOTO`) tidak menulis draft sama sekali.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const textMenu = fs.readFileSync(path.join(AKAR, "message", "handlers", "smart-report-text-menu.js"), "utf8");
const handler = fs.readFileSync(path.join(AKAR, "message", "handlers", "smart-report-handler.js"), "utf8");
const runtime = fs.readFileSync(path.join(AKAR, "lib", "app-runtime.js"), "utf8");

describe("draft ditulis ke disk, bukan cuma ke memori", () => {
    test("alur text-menu memakai store draft durabel", () => {
        expect(textMenu).toMatch(/require\(['"]\.\.\/\.\.\/lib\/laporan-draft-store['"]\)/);
        expect(textMenu).toMatch(/simpanDraftLaporanIni/);
    });

    test("draft ditulis TEPAT saat masuk langkah menunggu foto", () => {
        // Kalau penulisannya pindah ke tempat lain (mis. hanya saat foto pertama masuk),
        // pelanggan yang langsung diam setelah memilih "masih mati" tetap kehilangan laporannya.
        const blok = textMenu.slice(
            textMenu.indexOf("step: 'REPORT_MATI_PHOTO'"),
            textMenu.indexOf("smart_report_text_photo_upload_prompt")
        );
        expect(blok).toMatch(/setUserState\(sender, updatedState\)/);
        expect(blok).toMatch(/simpanDraftLaporanIni\(sender, updatedState\)/);
    });

    test("draft ditandai alur supaya pemindai memakai promoter yang benar", () => {
        // Dua alur menulis ke store yang SAMA dengan bentuk state BERBEDA; tanpa penanda,
        // draft text-menu akan diserahkan ke promoter legacy dan gagal diam-diam.
        expect(textMenu).toMatch(/alur:\s*['"]text-menu['"]/);
        expect(handler).toMatch(/alur === ['"]text-menu['"]/);
        expect(handler).toMatch(/promoteReportDraftOnTimeout/);
    });
});

describe("tak boleh melahirkan tiket GANDA", () => {
    test("draft dibuang saat tiket berhasil dibuat", () => {
        const blok = handler ? textMenu.slice(textMenu.indexOf("async function createReportTicket")) : "";
        expect(blok).toMatch(/buangDraftLaporanIni\(sender\)/);
    });

    test("draft dibuang juga saat pembuatan tiket GAGAL", () => {
        // Kalau tidak, draft yang gagal terus dicoba ulang tiap boot selamanya.
        const blok = textMenu.slice(textMenu.indexOf("[CREATE_REPORT_ERROR]"));
        expect(blok.slice(0, 300)).toMatch(/buangDraftLaporanIni\(sender\)/);
    });

    test("draft yang tak bisa dipromosikan juga dibuang", () => {
        const blok = textMenu.slice(textMenu.indexOf("[REPORT_TIMEOUT_PROMOTE] state/pelanggan kosong"));
        expect(blok.slice(0, 400)).toMatch(/buangDraftLaporanIni\(userId\)/);
    });
});

describe("jaring pengaman benar-benar dijalankan saat boot", () => {
    test("pemindai draft dipanggil dari app-runtime", () => {
        expect(runtime).toMatch(/pindaiDraftLaporanTertunda/);
    });

    test("pemindai tahan-gagal per draft (satu rusak tak menghentikan sisanya)", () => {
        const blok = handler.slice(handler.indexOf("async function pindaiDraftLaporanTertunda"));
        expect(blok).toMatch(/for \(const draft of kedaluwarsa\)/);
        expect(blok).toMatch(/try \{/);
        expect(blok).toMatch(/catch/);
    });
});

describe("menulis draft tak boleh menjatuhkan alur laporan", () => {
    test("simpan & buang draft dibungkus try-catch", () => {
        for (const nama of ["function simpanDraftLaporanIni", "function buangDraftLaporanIni"]) {
            const blok = textMenu.slice(textMenu.indexOf(nama));
            expect(blok.slice(0, 700)).toMatch(/try \{/);
            expect(blok.slice(0, 700)).toMatch(/catch/);
        }
    });
});
