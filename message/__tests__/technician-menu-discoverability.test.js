/**
 * Header Doc
 * Purpose: Menjaga perintah yang HANYA bisa ditemukan lewat menu tetap tercantum di `technicianmenu`.
 *          LATAR: wizard titik rumah pelanggan (`lokasi`) selesai dibangun 2026-07-21 dan berfungsi
 *          penuh di produksi, tapi TIDAK PERNAH dipakai sekali pun selama 12 hari — 147 pelanggan di
 *          dua bot tanpa titik, kolom `location_source` kosong di semua baris. Sebabnya bukan bug:
 *          perintahnya tak disebut di menu mana pun, jadi tak ada teknisi yang tahu. Fitur yang tak
 *          diketahui sama saja dengan fitur yang tak ada — tes ini yang menahannya kambuh.
 * Caller: Jest.
 * Deps: `database/wifi_menu_templates.json` (template tersimpan yang benar-benar dikirim ke WA).
 * SideEffects: tidak ada (baca file).
 */
"use strict";

const path = require("path");
const fs = require("fs");

const TEMPLATE_PATH = path.join(__dirname, "..", "..", "database", "wifi_menu_templates.json");

function technicianMenu() {
    return JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8")).technicianmenu || "";
}

describe("menu teknisi mencantumkan perintah yang tak punya pintu lain", () => {
    test("perintah `lokasi` (titik rumah pelanggan) tercantum", () => {
        const menu = technicianMenu();
        expect(menu).toMatch(/\*lokasi\*/);
    });

    test("menjelaskan CARA memberi titik, bukan cuma menyebut nama perintahnya", () => {
        // Teknisi di sini bukan orang teknis: menyebut "lokasi" saja tak cukup, dia perlu tahu
        // bahwa yang dikirim adalah pin WA / link Maps. Lihat [[newbie-sdm-design-principle]].
        const menu = technicianMenu();
        expect(menu).toMatch(/pin lokasi/i);
        expect(menu).toMatch(/maps/i);
    });

    test("mode borongan disebut — itu yang membuat pekerjaan menumpuk bisa dihabiskan sekali duduk", () => {
        expect(technicianMenu()).toMatch(/belum ada titiknya/i);
    });

    test("template tetap utuh: perintah lama tak ikut tergeser saat menu disunting", () => {
        const menu = technicianMenu();
        for (const perintah of ["list tiket", "proses [ID]", "cekwifi 1", "reboot 1", "monitorwifi"]) {
            expect(menu).toContain(perintah);
        }
    });
});
