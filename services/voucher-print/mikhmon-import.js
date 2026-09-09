/**
 * Header Doc
 * Purpose: Konversi AMAN template "Template Editor" Mikhmon (PHP) menjadi template layout kita (HTML ber-placeholder + blok logika {{#...}}) + ekstraksi peta harga->warna. TIDAK mengeksekusi PHP (hindari RCE) — hanya parse & substitusi pola. v2: mengonversi kondisional Mikhmon yang penting (`if($type=='up')` user vs user+password, kondisi datalimit) menjadi blok logika aman, bukan menghapusnya seperti v1.
 * Caller: `services/voucher-print.service.js` (endpoint impor template).
 * Deps: Tidak ada (pure regex).
 * MainFuncs: `parseMikhmonColors`, `convertMikhmonTemplate`.
 * SideEffects: Tidak ada. Bersifat best-effort; admin tetap bisa rapikan hasilnya di editor.
 */
"use strict";

// Variabel Mikhmon -> slot kita. username/price-split/color/qr dipertahankan ke slot kanonik
// (kompatibel test lama); sisanya ke alias paritas Mikhmon (semuanya resolve di render.map).
const VAR_MAP = {
    username: "{{kode}}",
    user: "{{kode}}",
    password: "{{sandi}}",
    qrcode: "{{qr}}",
    logo: "{{logo}}",
    color: "{{warna}}",
    hotspotname: "{{hotspotname}}",
    validity: "{{masa_aktif}}",
    timelimit: "{{durasi}}",
    datalimit: "{{kuota}}",
    price: "{{harga}}",
    comment: "{{comment}}",
    note: "{{note}}",
    profile: "{{paket}}"
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

// Konversi kondisional Mikhmon -> blok logika aman. Best-effort: menangani bentuk paling umum
// (if($type=='up')...else..., if($datalimit)...). Yang tak dikenali tetap di-strip di akhir.
function convertConditionals(input) {
    let html = String(input || "");

    // if($type=='up'){ ?>A<?php }else{ ?>B<?php } ?>  -> {{#ifeq type up}}A{{else}}B{{/ifeq}}
    html = html.replace(
        /<\?php\s*if\s*\(\s*\$type\s*==\s*['"]up['"]\s*\)\s*\{\s*\?>([\s\S]*?)<\?php\s*\}\s*else\s*\{\s*\?>([\s\S]*?)<\?php\s*\}\s*\?>/g,
        "{{#ifeq type up}}$1{{else}}$2{{/ifeq}}"
    );
    // if($type=='up'){ ?>A<?php } ?>  -> {{#ifeq type up}}A{{/ifeq}}
    html = html.replace(
        /<\?php\s*if\s*\(\s*\$type\s*==\s*['"]up['"]\s*\)\s*\{\s*\?>([\s\S]*?)<\?php\s*\}\s*\?>/g,
        "{{#ifeq type up}}$1{{/ifeq}}"
    );

    // if($datalimit){ ?>A<?php } ?>  / if(!empty($datalimit)){...} / if($datalimit != ""){...}
    //   -> {{#if datalimit}}A{{/if}}
    html = html.replace(
        /<\?php\s*if\s*\(\s*!?\s*(?:empty\s*\(\s*)?\$datalimit\b[^)]*\)\s*\{\s*\?>([\s\S]*?)<\?php\s*\}\s*\?>/g,
        "{{#if datalimit}}$1{{/if}}"
    );

    return html;
}

function convertMikhmonTemplate(php) {
    const colors = parseMikhmonColors(php);
    let html = String(php || "");

    // Kondisional dulu (sebelum var di-strip), supaya isi cabang tetap utuh.
    html = convertConditionals(html);

    // Harga versi split Mikhmon: explode(" ",$price)[0]="Rp", [1]=angka.
    html = html.replace(/<\?=\s*explode\([^)]*\)\s*\[\s*0\s*\]\s*;?\s*\?>/g, "Rp");
    html = html.replace(/<\?=\s*explode\([^)]*\)\s*\[\s*1\s*\]\s*;?\s*\?>/g, "{{harga_angka}}");

    Object.keys(VAR_MAP).forEach((name) => {
        const repl = VAR_MAP[name];
        // <?= $x ?> dan <?php echo $x ?> (dengan/atau tanpa titik koma & spasi).
        html = html.replace(new RegExp(`<\\?=\\s*\\$${name}\\s*;?\\s*\\?>`, "g"), repl);
        html = html.replace(new RegExp(`<\\?php\\s+echo\\s+\\$${name}\\s*;?\\s*\\?>`, "g"), repl);
    });

    // Sisa PHP (mis. blok pemformatan $validity, if-chain warna) di-strip — nilainya sudah
    // tercermin di slot ({{masa_aktif}} sudah manusiawi, {{warna}} dari peta harga->warna).
    html = html.replace(/<\?php[\s\S]*?\?>/g, "");
    html = html.replace(/<\?=[\s\S]*?\?>/g, "");
    html = html.replace(/<!--[\s\S]*?-->/g, "");
    html = html.replace(/\n{3,}/g, "\n\n").trim();

    return { template: html, colors };
}

module.exports = { parseMikhmonColors, convertConditionals, convertMikhmonTemplate };
