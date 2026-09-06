/**
 * Header Doc
 * Purpose: Mengunci pembedaan SEBAB gagal ganti nama/sandi WiFi (#b268) — pelanggan hanya disuruh
 *          memeriksa modemnya bila modemnya yang memang diam, bukan saat SISTEM KAMI bermasalah.
 * Caller: Jest test runner.
 * Deps: `lib/wifi-failure-reason`, `database/response_templates.json`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { bacaSebabGagalWifi } = require("../wifi-failure-reason");
const repoRoot = path.join(__dirname, "..", "..");
const templates = require(path.join(repoRoot, "database", "response_templates.json"));
const { findCustomerTextLeaks } = require(path.join(repoRoot, "lib", "customer-text-guard"));

describe("#b268 — hanya modem yang diam yang layak disuruh dicek", () => {
    test.each([
        ["DEVICE_UNREACHABLE", "Modem tidak menjawab"],
        ["", "hanya masuk antrean — modem tidak menjawab"],
        ["", "HTTP 202"]
    ])("modem diam (%s %s) → suruh cek modem", (kode, pesan) => {
        const s = bacaSebabGagalWifi({ errorCode: kode, message: pesan });
        expect(s.pihak).toBe("modem");
        expect(s.sarankanCekModem).toBe(true);
    });

    test.each([
        ["CONNECT_ERROR", "connect ECONNREFUSED"],
        ["", "GenieACS breaker open"],
        ["TIMEOUT_ERROR", "timeout"],
        ["CONFIG_ERROR", "Konfigurasi GenieACS tidak lengkap"],
        ["TASK_SUBMISSION_ERROR", "500"]
    ])("sisi KAMI (%s %s) → JANGAN suruh cek modem", (kode, pesan) => {
        const s = bacaSebabGagalWifi({ errorCode: kode, message: pesan });
        expect(s.pihak).toBe("kami");
        expect(s.sarankanCekModem).toBe(false);
    });

    test("!! sebab tak dikenal → JANGAN menuduh sisi pelanggan", () => {
        // "cannot observe" != "observed bad". Menebak ke arah pelanggan membuat mereka mengurus
        // perangkat yang mungkin tidak rusak.
        const s = bacaSebabGagalWifi({ message: "entah apa" });
        expect(s.sarankanCekModem).toBe(false);
    });

    test("menerima Error yang dilempar penjaga, bukan hanya objek hasil", () => {
        const e = new Error("Modem tidak menjawab (202)");
        e.code = "DEVICE_UNREACHABLE";
        expect(bacaSebabGagalWifi(e).sarankanCekModem).toBe(true);
    });

    test("#b323 readback timeout (TASK_NOT_APPLIED/'belum tervalidasi') → 'belum_terverifikasi', BUKAN janji notif", () => {
        // assertWifiChangeApplied melempar Error ber-message 'belum tervalidasi' tanpa errorCode.
        const s = bacaSebabGagalWifi(new Error("Task GenieACS diterima, tetapi perubahan belum tervalidasi pada device."));
        expect(s.pihak).toBe("belum_terverifikasi");
        expect(s.sarankanCekModem).toBe(false);
        expect(s.kunciTemplate).toBe("wifi_belum_terverifikasi"); // BUKAN wifi_gagal_sisi_kami (janji palsu)
    });

    test("#b323 sebab tak dikenal TIDAK lagi pakai template 'sisi kami' (janji notif palsu)", () => {
        const s = bacaSebabGagalWifi({ message: "entah apa" });
        expect(s.pihak).toBe("tidak_diketahui");
        expect(s.kunciTemplate).not.toBe("wifi_gagal_sisi_kami");
    });

    test("masukan tak wajar tidak melempar", () => {
        [null, undefined, 0, "", {}, []].forEach((x) => {
            expect(() => bacaSebabGagalWifi(x)).not.toThrow();
        });
    });
});

describe("#b268 — teks pelanggan benar & bersih", () => {
    test.each(["wifi_gagal_modem_diam", "wifi_gagal_sisi_kami"])("%s ada & bebas istilah internal", (k) => {
        expect(templates[k]).toBeDefined();
        expect(findCustomerTextLeaks(templates[k].template) || []).toEqual([]);
        // GenieACS/breaker/ACS tak berarti apa pun bagi pelanggan.
        expect(templates[k].template.toLowerCase()).not.toMatch(/genieacs|breaker|\bacs\b|http/);
    });

    test("pesan sisi-KAMI TIDAK menyuruh mengutak-atik modem", () => {
        const t = templates.wifi_gagal_sisi_kami.template.toLowerCase();
        expect(t).toMatch(/bukan dari modem/);
        expect(t).not.toMatch(/pastikan modem menyala|restart modem/);
    });

    test("pesan modem-diam MEMANG menyuruh cek modem", () => {
        expect(templates.wifi_gagal_modem_diam.template.toLowerCase()).toMatch(/modem menyala/);
    });

    test("kedua pesan menyatakan perubahannya BELUM tersimpan", () => {
        // Ambigu di sini membuat pelanggan mengira sandinya sudah berubah dan gagal login.
        ["wifi_gagal_modem_diam", "wifi_gagal_sisi_kami"].forEach((k) => {
            expect(templates[k].template.toLowerCase()).toMatch(/belum tersimpan/);
        });
    });
});

describe("#b268 — kedua alur WiFi memakai pembeda sebab", () => {
    const baca = (f) => fs.readFileSync(path.join(repoRoot, "message", "handlers", "states", f), "utf8");
    test.each(["wifi-password-state-handler.js", "wifi-name-state-handler.js"])("%s", (f) => {
        const src = baca(f);
        expect(src).toMatch(/bacaSebabGagalWifi\(error\)/);
        expect(src).toMatch(/sebab\.kunciTemplate/);
        // Pesan generik lama tak boleh kembali.
        expect(src).not.toMatch(/gagal mengubah kata sandi WiFi\. Silakan coba lagi atau hubungi admin/);
    });

    test("pesan galat MENTAH tak lagi dioper ke template pelanggan", () => {
        // `error.message` bisa memuat detail internal; template tersimpan pun tak memakainya.
        ["wifi-password-state-handler.js", "wifi-name-state-handler.js"].forEach((f) => {
            expect(baca(f)).not.toMatch(/\{ error_message: error\.message \}/);
        });
    });
});

describe("#b268 — janji \"tim kami sudah diberi tahu\" WAJIB ditepati", () => {
    const wfr = require("../wifi-failure-reason");
    const { laporkanKegagalanWifiKeAdmin, bacaSebabGagalWifi } = wfr;

    beforeEach(() => {
        jest.resetModules();
        wfr._resetJedaUntukTest();
    });

    test("teks pelanggan memang berjanji — jadi pelaporannya bukan opsional", () => {
        expect(templates.wifi_gagal_sisi_kami.template.toLowerCase()).toMatch(/tim kami sudah mendapat pemberitahuannya/);
    });

    test("kegagalan sisi MODEM tidak melapor — itu bukan gangguan kita", () => {
        return laporkanKegagalanWifiKeAdmin(bacaSebabGagalWifi({ errorCode: "DEVICE_UNREACHABLE" }), "ganti sandi", {})
            .then((r) => expect(r.dilaporkan).toBe(false));
    });

    test("never-throw walau dependensinya gagal dimuat", () => {
        return expect(
            laporkanKegagalanWifiKeAdmin({ pihak: "kami" }, "ganti sandi", {}, new Error("x"))
        ).resolves.toBeDefined();
    });

    test("kedua alur WiFi memanggil pelapornya", () => {
        ["wifi-password-state-handler.js", "wifi-name-state-handler.js"].forEach((f) => {
            const src = fs.readFileSync(path.join(repoRoot, "message", "handlers", "states", f), "utf8");
            expect(src).toMatch(/laporkanKegagalanWifiKeAdmin\(sebab,/);
        });
    });

    test("jeda hanya dipasang bila ADA yang terkirim", () => {
        // Kalau WhatsApp ikut bermasalah, membungkam laporan 30 menit berikutnya justru
        // menyembunyikan gangguan yang sedang berlangsung.
        const src = fs.readFileSync(path.join(repoRoot, "lib", "wifi-failure-reason.js"), "utf8");
        expect(src).toMatch(/if \(terkirim > 0\) terakhirLapor\.set/);
    });

    test("ber-jeda supaya satu gangguan tak jadi puluhan pesan", () => {
        const src = fs.readFileSync(path.join(repoRoot, "lib", "wifi-failure-reason.js"), "utf8");
        expect(src).toMatch(/JEDA_LAPOR_MS/);
        expect(src).toMatch(/masih dalam jeda/);
    });
});
