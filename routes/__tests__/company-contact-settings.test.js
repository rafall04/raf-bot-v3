"use strict";

/**
 * Header Doc
 * Purpose: Guardrail — pastikan section "Identitas & Kontak Usaha" di halaman Setting tetap
 *   ter-wire ujung ke ujung: field di config.php, populate di config.js, dan pemetaan
 *   company_* → config.company (+ sinkron `nama`) di routes/admin-config-routes.js. Data ini
 *   dipakai halaman publik legal (FAQ/Refund/Syarat/Kontak) untuk verifikasi merchant gateway.
 * Caller: Jest.
 * Deps: fs, path (scan sumber, tidak dieksekusi).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const php = fs.readFileSync(path.join(root, "views", "sb-admin", "config.php"), "utf8");
const js = fs.readFileSync(path.join(root, "static", "js", "config.js"), "utf8");
const route = fs.readFileSync(path.join(root, "routes", "admin-config-routes.js"), "utf8");

const FIELDS = ["company_name", "company_phone", "company_email", "company_address", "company_website"];

describe("settings: Identitas & Kontak Usaha", () => {
    test("config.php punya pane + tab + kelima field", () => {
        expect(php).toContain('id="pane-company"');
        expect(php).toContain('data-pane="pane-company"');
        FIELDS.forEach((f) => expect(php).toContain(`name="${f}"`));
    });

    test("config.js mem-populate field company_* dari config.company", () => {
        FIELDS.forEach((f) => expect(js).toContain(`setValue('${f}'`));
        // Placeholder ISI_ disaring jadi kosong.
        expect(js).toMatch(/ISI_/);
    });

    test("admin-config-routes memetakan company_* ke nested company (+ sinkron nama)", () => {
        expect(route).toMatch(/key === 'company_name'/);
        expect(route).toMatch(/newMainConfig\.company\[sub\]\s*=/);
        expect(route).toMatch(/newMainConfig\.nama\s*=\s*newMainConfig\.company\.name/);
        // Merge nested company saat menulis config final (tak menimpa field lain).
        expect(route).toMatch(/finalMainConfig\.company\s*=\s*\{[\s\S]*currentMainConfig\.company/);
    });
});
