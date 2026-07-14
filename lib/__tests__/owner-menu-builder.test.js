/**
 * Header Doc
 * Purpose: Uji generator MENU OWNER WA — pengelompokan per domain dari katalog, daftar ISP DINAMIS
 *          dari monitor aktif, link web per domain, perintah tak-terpetakan → "Lainnya" (anti-basi),
 *          pembersihan penanda peran deskripsi, intro/outro editable, dan sifat never-throw.
 * Caller: jest.
 * Deps: `../owner-menu-builder` (deps di-inject penuh — tanpa katalog/monitor nyata).
 * SideEffects: Tidak ada.
 */
"use strict";

const { buildOwnerMenu } = require("../owner-menu-builder");

const CATALOG = [
    { keywords: ["data isp"], intent: "DATA_ISP", category: "admin", description: "Rangkuman data jalur ISP (Admin/Owner)" },
    { keywords: ["oper jalur"], intent: "OPER_JALUR", category: "admin", description: "Oper koneksi per segmen — Admin/Owner" },
    { keywords: ["cari"], intent: "CARI_PELANGGAN", category: "admin", description: "Cari pelanggan (Admin/Teknisi)" },
    { keywords: ["allsaldo"], intent: "allsaldo", category: "admin", description: "Lihat semua saldo (Admin)" },
    { keywords: ["<topup"], intent: "topupManual", category: "admin", description: "Topup manual (Admin)" },
    { keywords: ["gubrak"], intent: "GUBRAK_BARU", category: "admin", description: "Fitur owner baru tanpa domain" },
    { keywords: ["cektagihan"], intent: "CEK_TAGIHAN", category: "customer", description: "cek tagihan" }
];

test("generate: group per domain + daftar ISP dinamis + web link + Lainnya (anti-basi)", () => {
    const menu = buildOwnerMenu({
        catalog: CATALOG, nama: "RAFNET", namabot: "BOT", menuTemplates: {},
        getMonitorConfig: () => ({ enabled: true, paths: [{ key: "gmdp" }, { key: "ih" }] })
    });
    expect(menu).toContain("🌐 *Jaringan & ISP*");
    expect(menu).toContain("• *data isp*");
    expect(menu).toContain("per ISP: *data gmdp* · *data ih*");   // daftar ISP DINAMIS
    expect(menu).toContain("🌐 Web: */upstream-quality*");
    expect(menu).toContain("💰 *Keuangan & Saldo*");
    expect(menu).toContain("• *<topup*");                          // domain via keyword
    expect(menu).toContain("⚙️ *Lainnya*");
    expect(menu).toContain("• *gubrak*");                          // perintah tanpa domain TETAP muncul
    expect(menu).not.toContain("cektagihan");                      // non-owner tak masuk menu owner
    // Penanda peran dibersihkan (kurung & tanda hubung)
    expect(menu).toContain("Cari pelanggan");
    expect(menu).not.toContain("Admin/Teknisi");
    expect(menu).not.toContain("— Admin/Owner");
});

test("monitor nonaktif → data isp tetap ada TAPI tanpa baris ISP dinamis", () => {
    const menu = buildOwnerMenu({
        catalog: CATALOG, nama: "X", namabot: "B", menuTemplates: {},
        getMonitorConfig: () => ({ enabled: false, paths: [] })
    });
    expect(menu).toContain("• *data isp*");
    expect(menu).not.toContain("per ISP:");
});

test("intro/outro editable dipakai; never-throw pada dep rusak", () => {
    const menu = buildOwnerMenu({
        catalog: CATALOG, nama: "RAF", namabot: "BOT",
        getMonitorConfig: () => ({ enabled: false, paths: [] }),
        menuTemplates: { menuowner_intro: "HALO ${nama_wifi}", menuowner_outro: "BYE ${nama_bot}" }
    });
    expect(menu).toContain("HALO RAF");
    expect(menu).toContain("BYE BOT");
    const safe = buildOwnerMenu({
        getCatalog: () => { throw new Error("x"); },
        getMonitorConfig: () => { throw new Error("y"); },
        menuTemplates: {}
    });
    expect(typeof safe).toBe("string");
    expect(safe.length).toBeGreaterThan(0);
});
