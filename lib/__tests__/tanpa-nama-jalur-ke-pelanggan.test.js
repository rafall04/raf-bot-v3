/**
 * Header Doc
 * Purpose: Mengunci bahwa pesan cek-koneksi TIDAK PERNAH menyebut nama jalur upstream (MNI/GMDP/
 *          IH/SF) maupun angka teknis ke PELANGGAN, dan bahwa jalur diambil dari resolver LIVE.
 * Caller: Jest test runner.
 * Deps: sumber `lib/app-aware-diagnosis.js`, `message/handlers/connection-check-handler.js`,
 *       `lib/complaint-signal-service.js`, `database/response_templates.json`.
 * MainFuncs: —
 * SideEffects: Tidak ada (hanya membaca sumber & data).
 *
 * KENAPA ADA — permintaan pemilik: "untuk cek koneksi dan komplain youtube lemot dll tidak perlu
 * disebutkan via MNI dll. cukup memang lagi terkendala."
 *
 * Dua akar terukur di produksi 2026-08-20:
 *  1. Fallback di KODE sudah sederhana, tapi TEMPLATE TERSIMPAN mengalahkan fallback dan berkas
 *     template produksi di-merge-key — jadi teks lama "(MNI) ... (loss 2%, respons 310ms)" tetap
 *     hidup. Selama slot datanya dioper, nama ISP bisa muncul lagi tanpa satu baris kode berubah.
 *  2. Nama jalurnya sendiri TAK LAYAK DIPERCAYA: peta CIDR statis (snapshot 2026-07-07) diadu
 *     dengan address-list LIVE atas 62 pelanggan aktif → sepakat 41, BEDA 13 (21%), statis buta
 *     padahal live tahu 8 (13%). Subnet 192.168.61.0/24 tertulis "mni" padahal live "gmdp".
 *     Menyebut jalur yang SALAH lebih buruk daripada tidak menyebut sama sekali.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(AKAR, ...p), "utf8");

const diag = baca("lib", "app-aware-diagnosis.js");
const cch = baca("message", "handlers", "connection-check-handler.js");
const templates = JSON.parse(baca("database", "response_templates.json"));
const isi = (k) => { const v = templates[k]; return typeof v === "string" ? v : (v && v.template) || ""; };

const KUNCI_PELANGGAN = [
    "conncheck_upstream_issue",
    "conncheck_app_issue",
    "conncheck_app_ok",
    "conncheck_app_path_issue",
    "conncheck_app_path_ok",
];

describe("slot jalur & angka teknis tidak dioper ke template pelanggan", () => {
    test("app-aware-diagnosis tak mengoper jalur_label/ms/loss/rtt", () => {
        const kode = diag.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
        for (const slot of ["jalur_label", "normal_ms", "loss:", "rtt:"]) {
            expect(kode).not.toContain(slot);
        }
    });

    test("seksi upstream cek-koneksi tak mengoper jalur_label/status_label/loss/rtt", () => {
        const kode = cch.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
        for (const slot of ["jalur_label:", "status_label:", "loss: avg(", "rtt: avg("]) {
            expect(kode).not.toContain(slot);
        }
    });

    test("alert ADMIN boleh tetap memuat jalur — itu bukan pelanggan", () => {
        // Pembanding sadar-diri: kalau baris ini ikut hilang, berarti terlalu jauh memangkas.
        expect(baca("lib", "complaint-signal-service.js")).toContain("jalur_label");
    });
});

describe("template tersimpan ikut dibersihkan (template mengalahkan fallback)", () => {
    test.each(KUNCI_PELANGGAN)("%s tak memuat slot jalur/angka", (kunci) => {
        const s = isi(kunci);
        expect(s).not.toContain("${jalur_label}");
        expect(s).not.toContain("${loss}");
        expect(s).not.toContain("${rtt}");
        expect(s).not.toContain("${ms}");
        expect(s).not.toContain("${normal_ms}");
        expect(s).not.toContain("${status_label}");
    });

    test.each(KUNCI_PELANGGAN)("%s tak menyebut nama ISP secara harfiah", (kunci) => {
        expect(isi(kunci)).not.toMatch(/\b(MNI|GMDP|SF)\b/);
    });
});

describe("jalur diambil dari sumber LIVE, bukan peta CIDR statis", () => {
    test("app-aware-diagnosis memakai customer-path-resolver", () => {
        expect(diag).toMatch(/require\(["']\.\/customer-path-resolver["']\)/);
        const kode = diag.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
        expect(kode).not.toContain("upstream-path-resolver");
    });

    test("resolver bisa di-inject supaya test tak menembak router", () => {
        expect(diag).toMatch(/deps\.resolvePath \|\| resolveCustomerPath/);
    });

    test("fail-closed: tanpa jalur, bot DIAM soal app (bukan menebak)", () => {
        expect(diag).toMatch(/if \(!pathKey\) return "";/);
    });
});
