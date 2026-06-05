/**
 * Header Doc
 * Purpose: Guardrail anti-regresi mojibake (UTF-8 double-encoded via Windows-1252) pada
 *          file konten bot yang version-controlled — template pesan & string emoji di kode.
 * Caller: Jest.
 * Deps: `scripts/fix-mojibake.js` (detektor = "fixer tidak mengubah apa pun").
 * MainFuncs: Memastikan tiap file tidak mengandung mojibake reversible.
 * SideEffects: Hanya membaca file.
 *
 * Konteks: pernah ada bug — template `package_changed` terkirim ke pelanggan dengan
 * emoji rusak (ðŸ“¦ alih-alih 📦) karena file tersimpan double-encoded. Test ini mencegah
 * file konten ter-commit dalam keadaan mojibake lagi.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { fixMojibake } = require("../../scripts/fix-mojibake");

const ROOT = path.join(__dirname, "..", "..");

// File konten bot yang ditulis tim (BUKAN data runtime pelanggan yang bisa berisi
// karakter aneh secara sah). Semua ini harus UTF-8 bersih.
const CONTENT_FILES = [
    "database/message_templates.json",
    "database/response_templates.json",
    "database/success_templates.json",
    "database/error_templates.json",
    "database/command_templates.json",
    "database/system_messages.json",
    "database/menu_templates.json",
    "database/wifi_menu_templates.json",
    "database/wifi_templates.json",
    "database/report_templates.json",
    "lib/templating.js",
    "message/handlers/legacy-teknisi-state-handler.js",
];

describe("no mojibake in bot content (UTF-8 double-encoding guardrail)", () => {
    test.each(CONTENT_FILES)("%s bebas mojibake", (rel) => {
        const full = path.join(ROOT, rel);
        if (!fs.existsSync(full)) return; // file opsional → lewati
        const content = fs.readFileSync(full, "utf8");
        // fixMojibake hanya mengubah string yang BENAR-BENAR double-encoded (reversible
        // ke UTF-8 valid). Kalau ia mengubah sesuatu, berarti masih ada mojibake.
        const fixed = fixMojibake(content);
        if (fixed !== content) {
            const badLine = content.split("\n").find((ln) => fixMojibake(ln) !== ln) || "";
            throw new Error(`Mojibake terdeteksi di ${rel}. Jalankan: node scripts/fix-mojibake.js ${rel}\nContoh baris: ${badLine.trim().slice(0, 120)}`);
        }
        expect(fixed).toBe(content);
    });
});
