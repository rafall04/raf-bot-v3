/**
 * Header Doc
 * Purpose: Engine render kartu voucher untuk cetak — isi placeholder layout dengan data voucher + settings, generate QR (data-URI via paket `qrcode`), terapkan peta harga->warna, dan rakit lembar cetak HTML (A4 grid atau thermal 58mm).
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

async function renderCard(layout, voucher, settings, deps) {
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
        kuota: voucher.datalimit || "",
        paket: voucher.profileName || voucher.profile || "",
        qr: qrImg,
        logo,
        cs: settings.cs_number || "",
        portal: settings.portal_text || "",
        warna: color,
        tanggal: voucher.date || ""
    };
    return applyTemplate(layout.template, map);
}

async function renderSheet(layout, vouchers, settings, deps, pageOpts = {}) {
    if (!layout || !layout.template) {
        throw new Error("Layout voucher tidak ditemukan");
    }
    const list = Array.isArray(vouchers) ? vouchers : [];
    const cards = [];
    for (const voucher of list) {
        cards.push(await renderCard(layout, voucher, settings, deps));
    }
    const gap = pageOpts.gap != null ? pageOpts.gap : 6;
    const pageCss = pageOpts.thermal
        ? "@page{size:58mm auto;margin:2mm;}"
        : "@page{size:A4;margin:6mm;}";
    const title = (pageOpts.title || "Cetak Voucher").replace(/[<>]/g, "");
    const body = `<div style="display:flex;flex-wrap:wrap;gap:${gap}px;align-items:flex-start;">${cards.join("")}</div>`;
    return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>${pageCss}
*{box-sizing:border-box;} body{margin:0;padding:10px;background:#f5f5f5;font-family:Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.vp-bar{margin-bottom:12px;} .vp-bar button{padding:8px 16px;font-size:14px;cursor:pointer;}
@media print{body{background:#fff;padding:0;} .vp-noprint{display:none !important;}}</style></head>
<body><div class="vp-bar vp-noprint"><button onclick="window.print()">Cetak / Simpan PDF</button> &nbsp; <span>${list.length} voucher</span></div>${body}</body></html>`;
}

module.exports = { applyTemplate, renderCard, renderSheet, qrContent };
