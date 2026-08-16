/**
 * Header Doc
 * Purpose: Mengunci bahwa identitas internal jaringan (nama profil MikroTik, username/password
 *          PPPoE, IP perangkat) TIDAK PERNAH dioper ke perakit pesan/respons yang dibaca
 *          PELANGGAN — pola starvasi data, bukan sekadar menambal teks template.
 * Caller: Jest test runner.
 * Deps: sumber `lib/speed-request-helper.js`, `lib/services/speed-request-service.js`,
 *       `message/handlers/state-domains/speed-boost.state.js`,
 *       `message/handlers/speed-status-handler.js`, `lib/psb-notification.js`,
 *       `lib/cctv-monitor.js`, `database/response_templates.json`, `database/packages.json`.
 * MainFuncs: —
 * SideEffects: Tidak ada (hanya membaca sumber & data).
 *
 * KENAPA STARVASI DATA, BUKAN MENAMBAL TEMPLATE — template tersimpan MENGALAHKAN fallback di
 * kode, dan di produksi berkas template di-merge-key (tak pernah ditimpa deploy). Selama slot
 * datanya masih dioper, admin bisa menerbitkannya lagi kapan saja lewat /api/templates tanpa
 * satu baris kode berubah. Yang tidak dioper tidak bisa bocor.
 *
 * KENAPA INI PENTING melebihi soal identitas internal — terukur di `database/packages.json`:
 * nama profil MikroTik SELALU lebih tinggi dari yang dijual (PAKET-110K dijual "Up To 10Mbps"
 * tapi profilnya `12Mbps`; 15→17; 30→32). Kalau bocor, pelanggan membaca angka yang BUKAN
 * produk yang dia beli.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(AKAR, ...p), "utf8");

const helper = baca("lib", "speed-request-helper.js");
const service = baca("lib", "services", "speed-request-service.js");
const waState = baca("message", "handlers", "state-domains", "speed-boost.state.js");
const waStatus = baca("message", "handlers", "speed-status-handler.js");
const psbNotif = baca("lib", "psb-notification.js");
const cctv = baca("lib", "cctv-monitor.js");
const templates = JSON.parse(baca("database", "response_templates.json"));
const paketRaw = JSON.parse(baca("database", "packages.json"));
const paket = Array.isArray(paketRaw) ? paketRaw : (paketRaw.packages || []);

const isiTemplate = (key) => {
    const v = templates[key];
    return typeof v === "string" ? v : (v && v.template) || "";
};

describe("premisnya nyata: profil router ≠ yang dijual", () => {
    test("ada paket yang profil routernya berbeda dari label jualnya", () => {
        const beda = paket.filter((p) => p.profile && p.displayProfile && p.profile !== p.displayProfile);
        expect(beda.length).toBeGreaterThan(0);
    });
});

describe("portal pelanggan (rute HIDUP, tak bergerbang matrix)", () => {
    // `/api/customer/speed-requests/active` & `/history` hidup di balik login pelanggan dan
    // TIDAK memeriksa sakelar Speed on Demand. Yang menahan kebocoran selama ini cuma bentuk
    // data (store berisi record uji) — satu request normal saja sudah cukup.
    test("username PPPoE tidak dioper ke respons portal", () => {
        expect(helper).not.toMatch(/pppoeUsername:\s*request\.pppoeUsername/);
    });

    test("nama profil MikroTik tidak dioper ke respons portal", () => {
        expect(helper).not.toMatch(/profile:\s*currentPackage\.profile/);
        expect(helper).not.toMatch(/profile:\s*requestedPackage\.profile/);
    });
});

describe("katalog paket — termasuk endpoint TANPA LOGIN", () => {
    // `/api/speed-boost/packages` terdaftar publik di lib/http-auth-bootstrap.js.
    test("service memakai displayProfile, tanpa fallback ke profile asli", () => {
        expect(service).not.toMatch(/profile:\s*pkg\.profile\b/);
        const pakaiDisplay = service.match(/profile:\s*pkg\.displayProfile \|\| ''/g) || [];
        expect(pakaiDisplay.length).toBeGreaterThanOrEqual(2);
    });

    test("endpoint publik saudara kandungnya tetap teredaksi (jangan ikut regresi)", () => {
        expect(baca("routes", "packages.js")).toMatch(/profile:\s*pkg\.displayProfile \|\| ''/);
    });
});

describe("jalur WhatsApp Speed on Demand", () => {
    test("daftar paket tak lagi mengoper slot profil", () => {
        expect(waState).not.toMatch(/profil:\s*pkg\.profile/);
    });

    test("status boost aktif tak lagi mengoper slot profile", () => {
        expect(waStatus).not.toMatch(/profile:\s*activeRequest\.requestedPackageProfile/);
    });

    test("TEMPLATE TERSIMPAN ikut dibersihkan — bukan cuma fallback", () => {
        // Template menimpa fallback; membersihkan kode saja meninggalkan bom aktif.
        expect(isiTemplate("sodb_package_item")).not.toContain("${profil}");
        expect(isiTemplate("speed_status_active_section")).not.toContain("${profile}");
    });
});

describe("pesan selamat datang PSB", () => {
    test("kredensial PPPoE tidak dioper ke template pelanggan", () => {
        expect(psbNotif).not.toMatch(/username:\s*config\.pppoe_username/);
        expect(psbNotif).not.toMatch(/password:\s*config\.pppoe_password/);
    });

    test("template psb_welcome tidak memakai slot username/password", () => {
        // Bahayanya halus: template tetangga `customer_welcome` memakai slot bernama SAMA
        // untuk kredensial PORTAL. Admin yang menyalin blok "detail login" akan diam-diam
        // menerbitkan kredensial PPPoE.
        const isi = isiTemplate("psb_welcome");
        expect(isi).not.toContain("${username}");
        expect(isi).not.toContain("${password}");
    });
});

describe("monitor CCTV", () => {
    test("IP internal perangkat tidak dioper ke pesan pelanggan", () => {
        const blok = cctv.slice(cctv.indexOf("function buildVars"), cctv.indexOf("function buildVars") + 900);
        expect(blok).not.toMatch(/cctv_host:\s*device\.host/);
    });

    test("halaman admin tak lagi menganjurkan slot {cctv_host}", () => {
        const halaman = baca("views", "sb-admin", "cctv-monitor.php");
        expect(halaman).not.toMatch(/<code>\{cctv_host\}<\/code>/);
        expect(halaman).not.toMatch(/Variabel:[^<]*\{cctv_host\}/);
    });
});
