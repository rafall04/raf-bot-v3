/**
 * Header Doc
 * Purpose : Menjaga kedalaman baca log OLT (#b280). Saat mati listrik massal, baris
 *           dying-gasp berada LEBIH TUA dari baris "Lost" milik ONU yang sama — begitu
 *           pembacaan terpotong, DG-nya hilang dan kejadiannya salah tervonis LOS
 *           ("fiber putus") sehingga teknisi dikirim sia-sia.
 * Caller  : jest
 * Deps    : pemeriksaan konstanta + sumber (loop fetch-nya ber-I/O)
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "olt-log-scraper.js"), "utf8");

function angkaKonstanta(nama) {
    const m = SRC.match(new RegExp("const\\s+" + nama + "\\s*=\\s*(\\d+)"));
    return m ? Number(m[1]) : null;
}

// TERUKUR di produksi 2026-08-27: satu halaman penuh = 20 baris.
const BARIS_PER_HALAMAN = 20;
// Kasus terburuk Tanjungharjo: 99 ONU mati listrik → 99 dying-gasp + 99 Lost + 99 discovery.
const KASUS_TERBURUK_BARIS = 99 * 3;

describe("#b280 — kedalaman baca log OLT cukup untuk mati listrik massal", () => {
    test("!! batas MINIMUM menjangkau kasus terburuk DENGAN MARGIN", () => {
        const min = angkaKonstanta("MIN_LOG_PAGES");
        expect(min).not.toBeNull();
        // Cap 15 halaman TERBUKTI HABIS pada burst nyata di hanya 263 baris — bukan 300 —
        // karena halaman terbaru selalu separuh terisi (terukur: 5 + 6 + 12 lalu penuh 20).
        // Jadi "tepat di atas kasus terburuk" tidak cukup; butuh margin.
        expect(min).toBeGreaterThan(15);
        expect(min * BARIS_PER_HALAMAN).toBeGreaterThan(KASUS_TERBURUK_BARIS * 1.5);
    });

    test("bawaan tidak lebih rendah dari batas minimum", () => {
        expect(angkaKonstanta("DEFAULT_LOG_PAGES")).toBeGreaterThanOrEqual(angkaKonstanta("MIN_LOG_PAGES"));
    });

    test("backstop keras di atas bawaan — burst ekstrem tetap punya ruang", () => {
        expect(angkaKonstanta("MAX_LOG_PAGES_HARD")).toBeGreaterThan(angkaKonstanta("DEFAULT_LOG_PAGES"));
    });

    test("config yang terlalu kecil TIDAK boleh melumpuhkan pembacaan", () => {
        // `maxLogPages: 3` yang terlanjur tersimpan di produksi harus terangkat ke MIN.
        expect(SRC).toMatch(/Math\.max\(MIN_LOG_PAGES,/);
        expect(SRC).toMatch(/Math\.min\(MAX_LOG_PAGES_HARD,/);
    });

    test("!! pembacaan yang TERPOTONG harus berteriak, bukan diam", () => {
        // "No silent caps": berhenti karena cap ≠ berhenti karena data habis. Kalau tak
        // dibedakan, log terlihat normal padahal dying-gasp-nya tak terbaca.
        expect(SRC).toMatch(/halamanTerbaca >= cap/);
        expect(SRC).toMatch(/TERPOTONG di cap/);
        expect(SRC).toMatch(/console\.warn/);
    });

    test("peringatannya menyebut AKIBATNYA, bukan sekadar angka", () => {
        const i = SRC.indexOf("TERPOTONG di cap");
        const potongan = SRC.slice(i, i + 500);
        expect(potongan).toMatch(/dying-gasp/);
        expect(potongan).toMatch(/LOS/);
        expect(potongan).toMatch(/maxLogPages/);
    });

    test("jumlah halaman terbaca dihitung dari halaman yang BENAR-BENAR berisi", () => {
        expect(SRC).toMatch(/halamanTerbaca = page \+ 1;/);
    });

    describe("kapasitas buffer OLT — batas yang bukan milik kita", () => {
        // TERUKUR 2026-08-27 (OLT Tanjungharjo 192.168.15.2): buffer hanya 27 halaman berisi,
        // halaman 28 kosong. Dengan 20 baris/halaman ⇒ kapasitas ≈ 540 baris.
        const KAPASITAS_BUFFER_BARIS = 27 * BARIS_PER_HALAMAN;

        test("padam total armada SEKARANG (99 ONU) masih muat", () => {
            expect(99 * 2).toBeLessThan(KAPASITAS_BUFFER_BARIS);   // DG + Lost
        });

        test("!! padam total pada 2 slot PENUH (256 ONU) TIDAK muat bersama pemulihannya", () => {
            // Ini bukan sesuatu yang bisa diperbaiki dengan membaca lebih dalam — batasnya
            // ada di buffer OLT. Yang menolong: scrape lebih sering + syslog sebagai sumber
            // kedua (syslog didorong real-time, tanpa batas buffer).
            const padamSaja = 256 * 2;          // DG + Lost
            const padamDanPulih = 256 * 3;      // + discovery
            expect(padamSaja).toBeLessThan(KAPASITAS_BUFFER_BARIS);          // muat, tapi 95%
            expect(padamDanPulih).toBeGreaterThan(KAPASITAS_BUFFER_BARIS);   // MELUBER
        });

        test("cap 30-40 halaman aman disetel — adaptif berhenti sendiri saat buffer habis", () => {
            expect(angkaKonstanta("MAX_LOG_PAGES_HARD")).toBeGreaterThanOrEqual(40);
            expect(SRC).toMatch(/No more logs at page/);
            expect(SRC).toMatch(/alasanBerhenti = "buffer-habis"/);
        });

        test("!! CELAH DATA terdeteksi, bukan diperkirakan", () => {
            // Buffer habis TAPI baris tertua masih lebih baru dari HWM ⇒ ada kejadian yang
            // sudah DITIMPA di OLT. Itu keadaan yang harus diteriakkan saat terjadi.
            expect(SRC).toMatch(/CELAH DATA/);
            expect(SRC).toMatch(/alasanBerhenti === "buffer-habis" && useHwm/);
            expect(SRC).toMatch(/tertuaTerbacaMs > hwmMs/);
        });

        test("peringatan celah menyebut jalan keluarnya", () => {
            const i = SRC.indexOf("console.warn(`[OLT-Scraper] !! CELAH DATA");
            expect(i).toBeGreaterThan(0);
            const potongan = SRC.slice(i, i + 800);
            expect(potongan).toMatch(/dying-gasp/);
            expect(potongan).toMatch(/scrapeInterval/);
            expect(potongan).toMatch(/syslog/);
        });

        test("alasan berhenti ikut dilaporkan tiap siklus", () => {
            expect(SRC).toContain("berhenti: ${alasanBerhenti}");
        });
    });
});
