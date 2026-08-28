/**
 * Header Doc
 * Purpose : GUARD jaring pengaman slot terpusat (#b302) — renderResponseTemplateSafe membuang
 *           ${slot} tak terisi + memperingatkan, dan 8 wrapper lib/ mendelegasikan ke situ
 *           (tak lagi `renderCategoryTemplate(...).text` mentah).
 * Caller  : jest
 * Deps    : lib/template-service (perilaku) + pemindaian sumber 8 wrapper.
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — hasil AUDIT alur template WhatsApp pelanggan.
 * Kelas bug headline CLAUDE.md ("slot dihitung tapi tak pernah terkirim") terbukti TAK aktif
 * (nol TEMPLATE_SLOT_BASI di 16 hari log produksi, 308 template kritis dirender bersih). Tapi
 * ada CELAH STRUKTURAL: message/handlers/template-helpers.js menjaga jalur ber-fallback dengan
 * menjatuhkannya ke fallback + memperingatkan saat ada slot tak terselesaikan; sedangkan ~8
 * pemanggil di lib/ mengambil `renderCategoryTemplate(...).text` LANGSUNG — tanpa fallback,
 * tanpa cek unresolved. Bila suatu slot dicabut dari kode (skenario yang CLAUDE.md sebut
 * BERULANG), mereka membocorkan `${slot}` MENTAH ke pelanggan, diam-diam & tanpa jejak log.
 *
 * Diverifikasi di runtime sebelum guard ini: slot penuh → output IDENTIK dgn sebelumnya;
 * slot dicabut → jalur lama bocor `${ssid_id}`, jalur baru membuangnya + `[TEMPLATE_SLOT_BASI]`.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const AKAR = path.join(__dirname, "..", "..");

describe("#b302 — renderResponseTemplateSafe: perilaku jaring pengaman", () => {
    const ts = require(path.join(AKAR, "lib/template-service"));

    beforeAll(() => { global.config = global.config || { nama: "Uji WiFi", telfon: "0812" }; });

    test("diekspor sebagai fungsi", () => {
        expect(typeof ts.renderResponseTemplateSafe).toBe("function");
    });

    test("template tak ada → string kosong (bukan crash / bukan nama key)", () => {
        expect(ts.renderResponseTemplateSafe("__key_yang_pasti_tak_ada__", {})).toBe("");
    });

    test("semua slot terisi → identik dengan renderCategoryTemplate().text", () => {
        const store = JSON.parse(fs.readFileSync(path.join(AKAR, "database/response_templates.json"), "utf8"));
        const teks = (k) => { const e = store[k]; return typeof e === "string" ? e : (e && (e.text || e.template)) || ""; };
        const slots = (k) => [...new Set([...teks(k).matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim()))];
        const key = Object.keys(store).find((k) => slots(k).length >= 2 && !/\./.test(slots(k).join()));
        const data = {}; slots(key).forEach((s) => { data[s] = "NILAI"; });
        expect(ts.renderResponseTemplateSafe(key, data)).toBe(ts.renderCategoryTemplate("responseTemplates", key, data).text);
    });

    test("!! slot TAK terisi → TIDAK membocorkan ${slot} + memperingatkan", () => {
        const store = JSON.parse(fs.readFileSync(path.join(AKAR, "database/response_templates.json"), "utf8"));
        const teks = (k) => { const e = store[k]; return typeof e === "string" ? e : (e && (e.text || e.template)) || ""; };
        const slots = (k) => [...new Set([...teks(k).matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim()))];
        const key = Object.keys(store).find((k) => slots(k).length >= 2 && !/\./.test(slots(k).join()));
        const sl = slots(key);
        const data = {}; sl.forEach((s) => { data[s] = "NILAI"; });
        delete data[sl[0]]; // cabut satu slot — simulasi "slot dicabut dari kode"

        const warns = [];
        const asli = console.warn;
        console.warn = (...a) => warns.push(a[0]);
        let out;
        try { out = ts.renderResponseTemplateSafe(key, data); } finally { console.warn = asli; }

        // jalur LAMA bocor; jalur baru TIDAK
        expect(ts.renderCategoryTemplate("responseTemplates", key, data).text).toMatch(/\$\{/); // bukti jalur lama bocor
        expect(out).not.toMatch(/\$\{/);
        expect(warns).toContain("[TEMPLATE_SLOT_BASI]");
    });
});

describe("#b302 — 8 wrapper lib/ mendelegasikan ke jaring pengaman", () => {
    // Yang dijaga: tak ada lagi wrapper `renderResponseTemplate(key,data)` yang memanggil
    // renderCategoryTemplate(...).text LANGSUNG (bocor mentah). Semua lewat safe helper.
    const FILES = [
        "lib/services/customer-service.js", "lib/alert-system.js", "lib/psb-notification.js",
        "lib/report-notification-service.js", "lib/topup-expiry.js",
        "lib/services/speed-request-service.js", "lib/services/profile-update-service.js",
        "lib/services/report-service.js",
    ];
    for (const rel of FILES) {
        test(rel.replace("lib/", "") + " memakai renderResponseTemplateSafe, bukan .text langsung", () => {
            const s = fs.readFileSync(path.join(AKAR, rel), "utf8");
            expect(s).toMatch(/renderResponseTemplateSafe/);
            // pola bocor lama TIDAK boleh ada lagi
            expect(s).not.toMatch(/renderCategoryTemplate\(\s*['"]responseTemplates['"]\s*,\s*key\s*,\s*data\s*\)\.text/);
        });
    }
});
