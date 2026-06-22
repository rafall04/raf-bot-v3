/**
 * Header Doc
 * Purpose: Kumpulan layout kartu voucher BAWAAN (built-in) sebagai template HTML ber-placeholder ({{kode}}, {{harga}}, {{qr}}, {{warna}}, dst). Dipakai engine render untuk cetak; bisa diduplikat/diedit admin atau ditambah via impor template Mikhmon.
 * Caller: `repositories/voucher-print.repository.js` (gabung dengan layout custom), `services/voucher-print.service.js`.
 * Deps: Tidak ada (data statis).
 * MainFuncs: `getBuiltinLayouts`.
 * SideEffects: Tidak ada.
 * Placeholder yang didukung: wifi, kode, sandi, harga, harga_angka, masa_aktif, durasi, kuota, paket, qr, logo, cs, portal, warna, tanggal.
 */
"use strict";

const BUILTIN_LAYOUTS = [
    {
        id: "band",
        name: "Pita warna",
        width: 200,
        template: `<div class="vp-card" style="width:200px;border:1px solid #bbb;border-radius:7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;">
<div style="background:{{warna}};color:#fff;padding:6px 9px;display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:bold;"><span>{{wifi}}</span><span>{{harga}}</span></div>
<div style="display:flex;gap:8px;padding:8px 9px;align-items:center;"><div style="width:54px;height:54px;flex:none;">{{qr}}</div>
<div style="flex:1;"><div style="font-family:monospace;font-size:16px;font-weight:bold;">{{kode}}</div><div style="font-size:10px;color:#555;">sandi: {{sandi}}</div><div style="font-size:10px;color:#555;">{{masa_aktif}}</div></div></div>
<div style="font-size:8px;color:#555;padding:0 9px 6px;">{{portal}} · CS {{cs}}</div></div>`
    },
    {
        id: "classic",
        name: "Mikhmon klasik",
        width: 200,
        template: `<div class="vp-card" style="width:200px;border:1px solid #000;border-radius:4px;overflow:hidden;background:#fff;color:#444;font-family:Tahoma,Arial,sans-serif;">
<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;"><span style="font-size:11px;font-weight:bold;color:{{warna}};">{{wifi}}</span><span style="color:{{warna}};font-weight:bold;line-height:1;"><span style="font-size:18px;">{{harga}}</span></span></div>
<div style="display:flex;gap:5px;padding:0 8px 5px;"><div style="flex:1;"><div style="border-bottom:1px solid {{warna}};text-align:center;font-weight:bold;font-size:9px;">VOUCHER</div><div style="border-bottom:1px solid {{warna}};text-align:center;font-weight:bold;font-size:14px;color:#000;font-family:monospace;">{{kode}}</div><div style="font-size:7px;color:#333;margin-top:2px;">{{portal}}</div></div>
<div style="text-align:right;width:64px;"><div style="font-size:7px;font-weight:bold;">{{masa_aktif}}<br>{{durasi}}</div><div style="width:54px;height:54px;margin-left:auto;">{{qr}}</div></div></div>
<div style="background:{{warna}};color:#fff;font-size:9px;font-weight:bold;padding:2px 8px;">CS: {{cs}}</div></div>`
    },
    {
        id: "thermal",
        name: "Thermal 58mm",
        width: 180,
        template: `<div class="vp-card" style="width:180px;border:1px dashed #999;border-radius:4px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;text-align:center;">
<div style="background:{{warna}};color:#fff;padding:4px;font-size:12px;font-weight:bold;">{{wifi}}</div>
<div style="padding:8px;"><div style="width:90px;height:90px;margin:0 auto;">{{qr}}</div>
<div style="font-family:monospace;font-size:18px;font-weight:bold;letter-spacing:1px;margin-top:4px;">{{kode}}</div>
<div style="font-size:11px;">sandi: {{sandi}}</div>
<div style="font-size:11px;color:{{warna}};font-weight:bold;">{{harga}} · {{masa_aktif}}</div>
<div style="font-size:9px;color:#555;border-top:1px dashed #ccc;margin-top:5px;padding-top:4px;">{{portal}} · CS {{cs}}</div></div></div>`
    },
    {
        id: "borderL",
        name: "Border kiri",
        width: 200,
        template: `<div class="vp-card" style="width:200px;border:1px solid #ddd;border-left:7px solid {{warna}};border-radius:0 7px 7px 0;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;padding:9px 11px;">
<div style="display:flex;justify-content:space-between;"><span style="font-size:11px;font-weight:bold;color:{{warna}};">{{wifi}}</span><span style="font-weight:bold;color:{{warna}};font-size:12px;">{{harga}}</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;"><div><div style="font-family:monospace;font-size:18px;font-weight:bold;">{{kode}}</div><div style="font-size:10px;color:#555;">sandi: {{sandi}} · {{masa_aktif}}</div></div><div style="width:48px;height:48px;flex:none;">{{qr}}</div></div></div>`
    },
    {
        id: "split",
        name: "Split warna",
        width: 200,
        template: `<div class="vp-card" style="width:200px;border:1px solid #ccc;border-radius:7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;">
<div style="background:{{warna}};color:#fff;padding:8px;text-align:center;"><div style="font-size:11px;font-weight:bold;">{{wifi}}</div><div style="font-size:15px;font-weight:bold;">{{harga}}</div></div>
<div style="padding:8px;display:flex;gap:8px;align-items:center;justify-content:center;"><div style="width:50px;height:50px;flex:none;">{{qr}}</div><div><div style="font-family:monospace;font-size:16px;font-weight:bold;">{{kode}}</div><div style="font-size:10px;color:#555;">sandi: {{sandi}}</div><div style="font-size:10px;color:#555;">{{masa_aktif}}</div></div></div></div>`
    },
    {
        id: "stub",
        name: "Tiket sobek",
        width: 220,
        template: `<div class="vp-card" style="width:220px;display:flex;border:1px solid #ccc;border-radius:7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;">
<div style="background:{{warna}};color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 6px;min-width:54px;"><span style="font-size:8px;">HARGA</span><span style="font-weight:bold;font-size:13px;">{{harga}}</span></div>
<div style="flex:1;padding:8px 10px;"><div style="font-size:10px;color:{{warna}};font-weight:bold;">{{wifi}}</div><div style="font-family:monospace;font-size:17px;font-weight:bold;">{{kode}}</div><div style="font-size:10px;color:#555;">sandi: {{sandi}} · {{masa_aktif}}</div></div>
<div style="display:flex;align-items:center;padding-right:8px;"><div style="width:46px;height:46px;">{{qr}}</div></div></div>`
    },
    {
        id: "borderTop",
        name: "Border atas",
        width: 200,
        template: `<div class="vp-card" style="width:200px;border:1px solid #ddd;border-top:5px solid {{warna}};border-radius:0 0 7px 7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;padding:8px 10px;">
<div style="font-size:11px;font-weight:bold;color:{{warna}};">{{wifi}}</div>
<div style="display:flex;justify-content:space-between;align-items:center;"><div><div style="font-family:monospace;font-size:17px;font-weight:bold;">{{kode}}</div><div style="font-size:10px;color:#555;">sandi: {{sandi}} · {{masa_aktif}} · {{harga}}</div></div><div style="width:46px;height:46px;flex:none;">{{qr}}</div></div></div>`
    },
    {
        id: "corner",
        name: "Sudut harga",
        width: 200,
        template: `<div class="vp-card" style="width:200px;position:relative;border:1px solid #ddd;border-radius:7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;padding:9px 10px;">
<div style="position:absolute;top:0;right:0;background:{{warna}};color:#fff;font-size:10px;font-weight:bold;padding:2px 8px;">{{harga}}</div>
<div style="font-size:10px;font-weight:bold;color:{{warna}};">{{wifi}}</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;"><div><div style="font-family:monospace;font-size:17px;font-weight:bold;">{{kode}}</div><div style="font-size:10px;color:#555;">sandi: {{sandi}} · {{masa_aktif}}</div></div><div style="width:46px;height:46px;flex:none;">{{qr}}</div></div></div>`
    },
    {
        id: "outline",
        name: "Outline warna",
        width: 200,
        template: `<div class="vp-card" style="width:200px;border:2px solid {{warna}};border-radius:7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;padding:9px 11px;">
<div style="display:flex;justify-content:space-between;"><span style="font-size:11px;font-weight:bold;color:{{warna}};">{{wifi}}</span><span style="font-weight:bold;color:{{warna}};">{{harga}}</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;"><div><div style="font-family:monospace;font-size:19px;font-weight:bold;color:{{warna}};">{{kode}}</div><div style="font-size:10px;color:#555;">sandi: {{sandi}} · {{masa_aktif}}</div></div><div style="width:46px;height:46px;flex:none;">{{qr}}</div></div></div>`
    },
    {
        id: "dark",
        name: "Gelap neon",
        width: 200,
        template: `<div class="vp-card" style="width:200px;border:1px solid #000;border-radius:7px;overflow:hidden;background:#1f1f1f;color:#fff;font-family:Arial,sans-serif;padding:9px 11px;">
<div style="display:flex;justify-content:space-between;"><span style="font-size:11px;font-weight:bold;color:{{warna}};">{{wifi}}</span><span style="font-weight:bold;color:{{warna}};">{{harga}}</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;"><div><div style="font-family:monospace;font-size:19px;font-weight:bold;color:#fff;">{{kode}}</div><div style="font-size:10px;color:#aaa;">sandi: {{sandi}} · {{masa_aktif}}</div></div><div style="width:48px;height:48px;flex:none;background:#fff;padding:2px;border-radius:3px;">{{qr}}</div></div></div>`
    },
    {
        id: "ribbon",
        name: "Ribbon hemat",
        width: 200,
        template: `<div class="vp-card" style="width:200px;position:relative;border:1px solid #ddd;border-radius:7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;padding:9px 10px;">
<div style="position:absolute;top:9px;right:-26px;background:{{warna}};color:#fff;font-size:9px;font-weight:bold;padding:2px 28px;transform:rotate(45deg);">HEMAT</div>
<div style="font-size:10px;font-weight:bold;color:{{warna}};">{{wifi}}</div>
<div style="font-family:monospace;font-size:18px;font-weight:bold;margin-top:4px;">{{kode}}</div>
<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:10px;color:#555;">{{masa_aktif}} · {{harga}}</span><div style="width:42px;height:42px;">{{qr}}</div></div></div>`
    },
    {
        id: "minimal",
        name: "Minimalis",
        width: 190,
        template: `<div class="vp-card" style="width:190px;border:1px solid #e0e0e0;border-radius:7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;padding:10px 12px;">
<div style="display:flex;align-items:center;gap:6px;"><span style="width:9px;height:9px;border-radius:50%;background:{{warna}};display:inline-block;"></span><span style="font-size:11px;color:#666;">{{wifi}}</span></div>
<div style="font-family:monospace;font-size:20px;font-weight:bold;margin:5px 0;">{{kode}}</div>
<div style="font-size:11px;color:#666;">{{masa_aktif}} · <span style="color:{{warna}};font-weight:bold;">{{harga}}</span></div></div>`
    },
    {
        id: "stamp",
        name: "Stempel tiket",
        width: 200,
        template: `<div class="vp-card" style="width:200px;border:1px solid #eee;border-radius:7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;padding:4px;">
<div style="border:2px dashed {{warna}};border-radius:5px;padding:7px;text-align:center;">
<div style="font-size:10px;font-weight:bold;color:{{warna}};">{{wifi}}</div>
<div style="display:flex;gap:6px;align-items:center;justify-content:center;margin-top:3px;"><div style="width:46px;height:46px;flex:none;">{{qr}}</div><div><div style="font-family:monospace;font-size:15px;font-weight:bold;">{{kode}}</div><div style="font-size:9px;color:#555;">{{masa_aktif}}</div><div style="font-size:10px;color:{{warna}};font-weight:bold;">{{harga}}</div></div></div></div></div>`
    },
    {
        id: "pill",
        name: "Pill header",
        width: 200,
        template: `<div class="vp-card" style="width:200px;border:1px solid #ddd;border-radius:7px;overflow:hidden;background:#fff;color:#222;font-family:Arial,sans-serif;padding:9px;">
<div style="background:{{warna}};color:#fff;border-radius:20px;padding:3px 10px;display:inline-block;font-size:10px;font-weight:bold;">{{wifi}}</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;"><div><div style="font-family:monospace;font-size:17px;font-weight:bold;">{{kode}}</div><div style="font-size:10px;color:#555;">sandi: {{sandi}} · {{masa_aktif}} · {{harga}}</div></div><div style="width:44px;height:44px;flex:none;">{{qr}}</div></div></div>`
    }
];

function getBuiltinLayouts() {
    return BUILTIN_LAYOUTS.map((layout) => ({ ...layout, builtin: true }));
}

module.exports = { BUILTIN_LAYOUTS, getBuiltinLayouts };
