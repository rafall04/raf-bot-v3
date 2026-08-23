/**
 * Header Doc
 * Purpose: Mengunci tiga perbaikan presisi cek-koneksi: vonis layanan butuh cukup sampel,
 *          klaim "normal" harus berbukti (bukan dari flag config), dan template basi tak boleh
 *          mengirim `${slot}` mentah ke pelanggan.
 * Caller: Jest test runner.
 * Deps: `lib/service-reachability-prober.js` (_internal.verdictFor), sumber
 *       `message/handlers/connection-check-handler.js`, `message/handlers/template-helpers.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — ketiganya mengulang pelajaran yang SUDAH tertulis di repo ini:
 *  1. `verdictFor` tak punya minimum sampel, padahal saudara kandungnya (poller jalur) punya
 *     `minSamples: 3`. Satu sampel gagal = vonis "DOWN"; satu kegagalan DNS di host prober
 *     menandai 7 layanan x 4 jalur serentak, lalu tiap pelanggan yang bertanya diberi tahu
 *     "jaringan kami sedang ada kendala" — yang rusak alat ukurnya, bukan jaringannya.
 *  2. `classifyOnlineVerdict` memulangkan HEALTHY hanya karena `upstreamMonitor.enabled` —
 *     melanggar doc fungsinya sendiri ("JANGAN klaim normal tanpa bukti") dan larangan
 *     CLAUDE.md "Gate on evidence, not on a config flag". "Tak ada jalur buruk" mencakup
 *     "semua jalur UNKNOWN" (poller mati / bot baru restart).
 *  3. Placeholder tak dikenal dipulangkan APA ADANYA oleh template-service. Karena template
 *     produksi di-merge-key, tiap slot yang dicabut demi keamanan membuat salinan lama
 *     mengirim tulisan mentah ke pelanggan — lebih buruk daripada kebocoran aslinya.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { _internal } = require("../service-reachability-prober");
const { verdictFor } = _internal;

const AKAR = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(AKAR, ...p), "utf8");
const cch = baca("message", "handlers", "connection-check-handler.js");
const helper = baca("message", "handlers", "template-helpers.js");

const TIMEOUT = 6000;

describe("vonis layanan butuh cukup sampel — 'belum cukup bukti' bukan 'terlihat buruk'", () => {
    test("1 sampel gagal TIDAK lagi jadi DOWN", () => {
        expect(verdictFor({ samples: 1, ok_count: 0, tls_avg: null }, TIMEOUT)).toBe("UNKNOWN");
    });

    test("2 sampel masih UNKNOWN", () => {
        expect(verdictFor({ samples: 2, ok_count: 0, tls_avg: null }, TIMEOUT)).toBe("UNKNOWN");
    });

    test("3 sampel sudah boleh divonis", () => {
        expect(verdictFor({ samples: 3, ok_count: 0, tls_avg: null }, TIMEOUT)).toBe("DOWN");
        expect(verdictFor({ samples: 3, ok_count: 3, tls_avg: 120 }, TIMEOUT)).toBe("OK");
    });

    test("nol sampel tetap UNKNOWN (perilaku lama dipertahankan)", () => {
        expect(verdictFor({ samples: 0, ok_count: 0 }, TIMEOUT)).toBe("UNKNOWN");
        expect(verdictFor(null, TIMEOUT)).toBe("UNKNOWN");
    });

    test("ambangnya selaras dengan saudara kandungnya (poller jalur minSamples: 3)", () => {
        expect(baca("lib", "upstream-quality-poller.js")).toMatch(/minSamples:\s*3/);
        expect(baca("lib", "service-reachability-prober.js")).toMatch(/MIN_SAMPLES_VERDICT = 3/);
    });

    test("sampel cukup + sebagian gagal tetap TERGANGGU (jangan ikut tertelan)", () => {
        expect(verdictFor({ samples: 5, ok_count: 3, tls_avg: 100 }, TIMEOUT)).toBe("TERGANGGU");
    });
});

describe("klaim 'normal' harus berbukti, bukan dari flag config", () => {
    test("cabang HEALTHY-dari-flag sudah dicabut", () => {
        const kode = cch.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
        expect(kode).not.toMatch(/if \(upstreamSignalAvailable\(\)\) return 'HEALTHY'/);
    });

    // Blok fungsi TANPA baris komentar — supaya penjelasan di sumber (yang memuat kutipan
    // `return 'HEALTHY'`) tidak ikut terhitung sebagai jalan kedua menuju HEALTHY.
    // Batas irisan dipatok ke PENUTUP fungsinya sendiri (baris `}` di kolom 0), bukan ke nama
    // fungsi tetangga: patokan tetangga membuat tes ini merah tiap kali ada fungsi baru
    // disisipkan di antaranya — merah yang tidak menunjukkan pelanggaran invarian apa pun.
    const kodeVerdict = (() => {
        const mulai = cch.indexOf("function classifyOnlineVerdict");
        const sisa = cch.slice(mulai);
        const tutup = sisa.indexOf("\n}\n");
        return sisa
            .slice(0, tutup === -1 ? sisa.length : tutup)
            .split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    })();

    test("HEALTHY hanya bila status jalur benar-benar NORMAL", () => {
        expect(kodeVerdict).toMatch(/if \(up\.status === 'NORMAL'\) return 'HEALTHY';/);
        expect((kodeVerdict.match(/return 'HEALTHY'/g) || []).length).toBe(1);
    });

    test("tanpa bukti → INCONCLUSIVE (bukan HEALTHY)", () => {
        expect(kodeVerdict).toMatch(/return 'INCONCLUSIVE';/);
        const barisReturn = kodeVerdict.split("\n").filter((l) => /return '/.test(l));
        expect(barisReturn[barisReturn.length - 1]).toMatch(/INCONCLUSIVE/);
    });

    test("INCONCLUSIVE berbunyi jujur — 'aktif', tidak mengklaim 'normal'", () => {
        const blok = cch.slice(cch.indexOf("function buildHealthNote"));
        expect(blok).toMatch(/conncheck_health_active/);
        expect(blok).toMatch(/Koneksi Anda terpantau aktif/);
    });
});

describe("template basi tak boleh mengirim slot mentah ke pelanggan", () => {
    test("helper memeriksa unresolved dan jatuh ke fallback", () => {
        expect(helper).toMatch(/result\.unresolved/);
        expect(helper).toMatch(/TEMPLATE_SLOT_BASI/);
        // Pemeriksaan unresolved HARUS sebelum pemakaian result.text.
        expect(helper.indexOf("result.unresolved")).toBeLessThan(helper.indexOf("return result.text;"));
    });

    test("template-service memang memulangkan placeholder tak dikenal apa adanya", () => {
        // Kalau ini berubah, jaring pengaman di atas boleh ditinjau ulang.
        const svc = baca("lib", "template-service.js");
        expect(svc).toMatch(/const unresolved = rendered\.match/);
    });
});
