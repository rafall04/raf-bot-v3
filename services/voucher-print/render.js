/**
 * Header Doc
 * Purpose: Engine render kartu voucher untuk cetak — isi placeholder layout dengan data voucher + settings, generate QR (data-URI via paket `qrcode`), terapkan peta harga->warna, dan rakit lembar cetak HTML. Dua mode rakit: (a) FLOW (flex-wrap, default, layout lama) dan (b) GRID terpaginasi (mis. 4x9=36/lembar ala Mikhmon) yang MENJAMIN jumlah kartu per halaman fisik lewat grid ukuran-mm + page-break.
 * Caller: `services/voucher-print.service.js`.
 * Deps: `./format`, lazy-require `qrcode` (bisa di-inject via deps.qrcode untuk test).
 * MainFuncs: `applyTemplate`, `renderCard`, `renderSheet`, `qrContent`.
 * SideEffects: Tidak ada (mengembalikan string HTML; QR dibuat in-memory).
 */
"use strict";

const { formatDurationToken, formatPrice, resolveColor } = require("./format");

function applyTemplate(template, map) {
    return String(template || "").replace(/\{\{(\w+)\}\}/g, (_match, key) => (
        map[key] !== null && typeof map[key] !== "undefined" ? String(map[key]) : ""
    ));
}

function qrContent(voucher, settings) {
    if (settings.qr_mode === "autologin" && settings.autologin_url_template) {
        return settings.autologin_url_template
            .replace(/\{kode\}/g, voucher.username || "")
            .replace(/\{sandi\}/g, voucher.password || voucher.username || "");
    }
    return voucher.username || "";
}

async function buildQr(content, deps) {
    try {
        const QR = (deps && deps.qrcode) || require("qrcode");
        const dataUrl = await QR.toDataURL(String(content || " "), { margin: 0, width: 180 });
        return `<img src="${dataUrl}" alt="QR" style="width:100%;height:100%;object-fit:contain;display:block;" />`;
    } catch (_error) {
        return "";
    }
}

// Durasi MENTAH (mis. "3h") untuk layout ala Mikhmon yang menampilkan token profil apa adanya —
// beda dengan {{durasi}}/{{masa_aktif}} yang MEMANUSIAWIKAN ("3h" -> "3 Jam"). Ambil dari
// timelimit dulu, lalu validity (data batch generate mengisi validity dari durasivc profil).
function rawDuration(voucher) {
    const candidates = [voucher.timelimit, voucher.validity];
    for (const c of candidates) {
        if (c !== null && typeof c !== "undefined" && String(c).trim() !== "") return String(c);
    }
    return "";
}

async function renderCard(layout, voucher, settings, deps, extra = {}) {
    const price = formatPrice(voucher.price != null ? voucher.price : (settings.default_price || 0));
    const color = resolveColor(price.num, settings.price_colors, settings.default_color);
    const qrImg = await buildQr(qrContent(voucher, settings), deps);
    const logo = settings.logo_url ? `<img src="${settings.logo_url}" alt="logo" style="max-height:24px;max-width:90px;" />` : "";
    const map = {
        wifi: settings.wifi_name || "",
        kode: voucher.username || "",
        sandi: voucher.password || voucher.username || "",
        harga: price.text,
        harga_angka: price.amount,
        masa_aktif: formatDurationToken(voucher.validity),
        durasi: formatDurationToken(voucher.timelimit),
        durasi_raw: rawDuration(voucher),
        kuota: voucher.datalimit || "",
        paket: voucher.profileName || voucher.profile || "",
        qr: qrImg,
        logo,
        cs: settings.cs_number || "",
        portal: settings.portal_text || "",
        login_url: settings.login_url || "",
        index: (extra && extra.index != null) ? extra.index : "",
        warna: color,
        tanggal: voucher.date || ""
    };
    return applyTemplate(layout.template, map);
}

// Resolusi mode grid: request (pageOpts.grid) menang atas metadata layout (layout.grid) supaya
// toggle "36/lembar" di UI tetap berlaku walau metadata layout hilang (mis. layout diedit jadi custom).
function resolveGrid(layout, pageOpts) {
    const g = pageOpts.grid || (layout && layout.grid) || null;
    if (!g) return null;
    const cols = Math.max(1, parseInt(g.cols, 10) || 4);
    const rows = Math.max(1, parseInt(g.rows, 10) || 9);
    const isLetter = String(pageOpts.pageSize || g.pageSize || "a4").toLowerCase() === "letter";
    // Tinggi baris TETAP (mm) => jumlah baris per halaman fisik dijamin, tak bergantung konten/engine.
    // Aman muat: Letter 9x26mm+gap << 263mm cetak; A4 9x28mm+gap << 285mm cetak.
    const rowHeight = Number(g.rowHeight) || (isLetter ? 26 : 28);
    const gap = Number(g.gap) || 2;
    return { cols, rows, perPage: cols * rows, isLetter, rowHeight, gap };
}

async function renderSheet(layout, vouchers, settings, deps, pageOpts = {}) {
    if (!layout || !layout.template) {
        throw new Error("Layout voucher tidak ditemukan");
    }
    const list = Array.isArray(vouchers) ? vouchers : [];
    const cards = [];
    let counter = 0;
    for (const voucher of list) {
        counter += 1;
        cards.push(await renderCard(layout, voucher, settings, deps, { index: counter }));
    }

    const grid = pageOpts.thermal ? null : resolveGrid(layout, pageOpts);
    const gap = pageOpts.gap != null ? pageOpts.gap : 6;
    const title = (pageOpts.title || "Cetak Voucher").replace(/[<>]/g, "");

    let pageCss;
    let extraCss = "";
    let body;

    if (grid) {
        const margin = grid.isLetter ? "8mm" : "7mm";
        pageCss = `@page{size:${grid.isLetter ? "letter" : "A4"};margin:${margin};}`;
        extraCss = `html,body{height:auto;}
.vp-page{display:grid;grid-template-columns:repeat(${grid.cols},1fr);grid-auto-rows:${grid.rowHeight}mm;gap:${grid.gap}mm;page-break-after:always;break-after:page;}
.vp-page:last-child{page-break-after:auto;break-after:auto;}
.vp-page>*{break-inside:avoid;page-break-inside:avoid;overflow:hidden;min-width:0;}`;
        const pages = [];
        for (let p = 0; p < cards.length; p += grid.perPage) {
            pages.push(`<section class="vp-page">${cards.slice(p, p + grid.perPage).join("")}</section>`);
        }
        body = pages.join("") || `<section class="vp-page"></section>`;
    } else {
        pageCss = pageOpts.thermal
            ? "@page{size:58mm auto;margin:2mm;}"
            : "@page{size:A4;margin:6mm;}";
        body = `<div style="display:flex;flex-wrap:wrap;gap:${gap}px;align-items:flex-start;">${cards.join("")}</div>`;
    }

    return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>${pageCss}
*{box-sizing:border-box;} body{margin:0;padding:10px;background:#f5f5f5;font-family:Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
${extraCss}
.vp-bar{margin-bottom:12px;} .vp-bar button{padding:8px 16px;font-size:14px;cursor:pointer;}
@media print{body{background:#fff;padding:0;} .vp-noprint{display:none !important;}}</style></head>
<body><div class="vp-bar vp-noprint"><button onclick="window.print()">Cetak / Simpan PDF</button> &nbsp; <span>${list.length} voucher</span></div>${body}</body></html>`;
}

module.exports = { applyTemplate, renderCard, renderSheet, qrContent };
