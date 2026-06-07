/**
 * Header Doc
 * Purpose: Memperbaiki teks mojibake (UTF-8 yang ter-double-encode via Windows-1252)
 *          pada file tertentu — mis. template/notifikasi yang emoji-nya rusak (ðŸ“¦ → 📦).
 * Caller: Maintenance manual: `node scripts/fix-mojibake.js [--dry] <file...>`.
 * Deps: iconv-lite (sudah dependency transitif), TextDecoder (built-in).
 * MainFuncs: `fixMojibake(str)`, CLI.
 * SideEffects: Menulis file in-place (kecuali --dry).
 *
 * Strategi aman untuk file CAMPURAN (ada emoji benar + mojibake): proses per-RUN
 * karakter yang representable di win1252. Hanya run yang mengandung penanda mojibake
 * (ð/â/Ã) dan yang hasil reversal-nya = UTF-8 valid yang diganti. Emoji benar (tidak
 * representable di win1252) jadi pembatas run dan TIDAK pernah disentuh.
 */
"use strict";

const fs = require("fs");

const MOJIBAKE_MARKER = /[ðâÃ]/;

// Tabel windows-1252 (spek WHATWG) dibangun dari TextDecoder built-in: byte 0x00-0xFF
// → codepoint, lalu DIBALIK jadi codepoint → byte. Penting: slot cp1252 yang
// "undefined" (0x81,0x8D,0x8F,0x90,0x9D) dipetakan ke C1 control (U+0081 dst) — persis
// perilaku yang membuat mojibake emoji (❌, ️ variation selector, ZWJ, box-drawing)
// bisa di-reverse sempurna. iconv-lite tidak round-trip slot ini.
const win1252Decoder = new TextDecoder("windows-1252");
const utf8Strict = new TextDecoder("utf8", { fatal: true });
const byteOfCodepoint = new Map();
for (let b = 0; b < 256; b += 1) {
    const cp = win1252Decoder.decode(Uint8Array.from([b])).codePointAt(0);
    if (!byteOfCodepoint.has(cp)) byteOfCodepoint.set(cp, b);
}

function isWin1252Mappable(ch) {
    return byteOfCodepoint.has(ch.codePointAt(0));
}

function tryReverseRun(run) {
    if (!MOJIBAKE_MARKER.test(run)) return run; // bukan mojibake → biarkan
    const bytes = new Uint8Array(run.length);
    let n = 0;
    for (const ch of run) {
        const b = byteOfCodepoint.get(ch.codePointAt(0));
        if (b === undefined) return run; // ada char non-win1252 → run ini bukan mojibake murni
        bytes[n] = b;
        n += 1;
    }
    try {
        return utf8Strict.decode(bytes.subarray(0, n)); // reversal sukses → UTF-8 valid
    } catch (__e) {
        return run; // bukan double-encoded UTF-8 yang bersih → jangan utak-atik
    }
}

function fixMojibake(str) {
    if (!MOJIBAKE_MARKER.test(str)) return str;
    // Segmentasi per-RUN karakter NON-ASCII yang representable di win1252.
    // ASCII (<0x80) = pemisah (reverse ke dirinya sendiri, jadi tak perlu ikut run)
    // dan emoji benar (non-win1252) = pemisah juga. Ini menjaga tiap sekuens mojibake
    // emoji (3-4 char non-ASCII berurutan) ter-reverse independen & bersih, tanpa
    // run raksasa yang rapuh (yang gagal validasi UTF-8 keseluruhan).
    let out = "";
    let run = "";
    const flush = () => { out += tryReverseRun(run); run = ""; };
    for (const ch of str) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x80 && isWin1252Mappable(ch)) {
            run += ch;
        } else {
            flush();
            out += ch; // ASCII / emoji benar / char non-win1252 → apa adanya
        }
    }
    flush();
    return out;
}

function main() {
    const args = process.argv.slice(2);
    const dry = args.includes("--dry");
    const files = args.filter((a) => a !== "--dry");
    if (files.length === 0) {
        console.error("Usage: node scripts/fix-mojibake.js [--dry] <file...>");
        process.exit(1);
    }
    let changedTotal = 0;
    for (const file of files) {
        const before = fs.readFileSync(file, "utf8");
        const after = fixMojibake(before);
        if (before === after) {
            console.log(`= unchanged: ${file}`);
            continue;
        }
        changedTotal += 1;
        // Hitung baris yang berubah untuk laporan.
        const beforeLines = before.split("\n");
        const afterLines = after.split("\n");
        let changedLines = 0;
        for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i += 1) {
            if (beforeLines[i] !== afterLines[i]) changedLines += 1;
        }
        // Pastikan tidak ada mojibake tersisa.
        const residual = MOJIBAKE_MARKER.test(after);
        console.log(`${dry ? "DRY  " : "FIX  "} ${file} — ${changedLines} baris berubah${residual ? "  ⚠ MASIH ADA MOJIBAKE TERSISA" : ""}`);
        if (!dry) {
            fs.writeFileSync(file, after, "utf8");
        }
    }
    console.log(`${dry ? "[DRY] " : ""}${changedTotal} file ${dry ? "akan diubah" : "diubah"}.`);
}

if (require.main === module) main();

module.exports = { fixMojibake };
