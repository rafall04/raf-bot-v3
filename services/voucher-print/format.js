/**
 * Header Doc
 * Purpose: Helper pemformatan voucher untuk cetak — ubah token durasi (validity/timelimit) ke teks manusiawi, format harga Rupiah, dan resolusi warna dari peta harga. Replikasi AMAN logika template Mikhmon (tanpa eksekusi PHP).
 * Caller: `services/voucher-print/render.js`, `services/voucher-print.service.js`.
 * Deps: Tidak ada (pure).
 * MainFuncs: `formatDurationToken`, `formatPrice`, `resolveColor`.
 * SideEffects: Tidak ada.
 */
"use strict";

function formatDurationToken(token) {
    if (token === null || typeof token === "undefined") return "";
    const s = String(token).trim();
    if (s === "") return "";
    const unit = s.slice(-1).toLowerCase();
    const num = parseInt(s.slice(0, -1), 10);
    if (Number.isNaN(num)) return s;
    if (unit === "d") return `${num} Hari`;
    if (unit === "w") return `${num * 7} Hari`;
    if (unit === "h") return `${num} Jam`;
    if (unit === "m") return `${num} Menit`;
    return s;
}

function formatPrice(value) {
    const num = parseInt(String(value == null ? "" : value).replace(/[^0-9]/g, ""), 10);
    if (Number.isNaN(num)) return { num: 0, text: "Rp 0", amount: "0" };
    const amount = new Intl.NumberFormat("id-ID").format(num);
    return { num, text: `Rp ${amount}`, amount };
}

function resolveColor(priceValue, colorMap = {}, defaultColor = "#BA68C8") {
    const num = parseInt(String(priceValue == null ? "" : priceValue).replace(/[^0-9]/g, ""), 10);
    if (!Number.isNaN(num) && colorMap && Object.prototype.hasOwnProperty.call(colorMap, String(num))) {
        return colorMap[String(num)];
    }
    return defaultColor;
}

module.exports = { formatDurationToken, formatPrice, resolveColor };
