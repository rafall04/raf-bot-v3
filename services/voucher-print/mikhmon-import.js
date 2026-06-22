/**
 * Header Doc
 * Purpose: Konversi AMAN template "Template Editor" Mikhmon (PHP) menjadi template layout kita (HTML ber-placeholder) + ekstraksi peta harga->warna. TIDAK mengeksekusi PHP (hindari RCE) — hanya parse & substitusi pola.
 * Caller: `services/voucher-print.service.js` (endpoint impor template).
 * Deps: Tidak ada (pure regex).
 * MainFuncs: `parseMikhmonColors`, `convertMikhmonTemplate`.
 * SideEffects: Tidak ada. Bersifat best-effort; admin tetap bisa rapikan hasilnya di editor.
 */
"use strict";

const VAR_MAP = {
    username: "{{kode}}",
    password: "{{sandi}}",
    qrcode: "{{qr}}",
    logo: "{{logo}}",
    color: "{{warna}}",
    validity: "{{masa_aktif}}",
    timelimit: "{{durasi}}",
    datalimit: "{{kuota}}",
    price: "{{harga}}"
};

function parseMikhmonColors(php) {
    const map = {};
    let defaultColor = null;
    const source = String(php || "");
    const colorRe = /\$getsprice\s*==\s*"?(\d+)"?\s*\)\s*\{\s*\$color\s*=\s*"([^"]+)"/g;
    let match;
    while ((match = colorRe.exec(source)) !== null) {
        map[match[1]] = match[2];
    }
    const defaultRe = /else\s*\{\s*\$color\s*=\s*"([^"]+)"/;
    const defaultMatch = defaultRe.exec(source);
    if (defaultMatch) defaultColor = defaultMatch[1];
    return { map, default: defaultColor };
}

function convertMikhmonTemplate(php) {
    const colors = parseMikhmonColors(php);
    let html = String(php || "");

    html = html.replace(/<\?=\s*explode\([^)]*\)\s*\[\s*0\s*\]\s*;?\s*\?>/g, "Rp");
    html = html.replace(/<\?=\s*explode\([^)]*\)\s*\[\s*1\s*\]\s*;?\s*\?>/g, "{{harga_angka}}");

    Object.keys(VAR_MAP).forEach((name) => {
        const repl = VAR_MAP[name];
        html = html.replace(new RegExp(`<\\?=\\s*\\$${name}\\s*;?\\s*\\?>`, "g"), repl);
        html = html.replace(new RegExp(`<\\?php\\s+echo\\s+\\$${name}\\s*;?\\s*\\?>`, "g"), repl);
    });

    html = html.replace(/<\?php[\s\S]*?\?>/g, "");
    html = html.replace(/<\?=[\s\S]*?\?>/g, "");
    html = html.replace(/<!--[\s\S]*?-->/g, "");
    html = html.replace(/\n{3,}/g, "\n\n").trim();

    return { template: html, colors };
}

module.exports = { parseMikhmonColors, convertMikhmonTemplate };
