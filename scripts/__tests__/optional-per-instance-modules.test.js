"use strict";

/**
 * Header Doc
 * Purpose: Menjaga agar fitur yang sengaja dipasang HANYA di sebagian instance (dompet pribadi:
 *   menumpang satu nomor bot, jadi berkasnya memang tak ada di instance lain) tidak pernah
 *   di-`require` di TINGKAT ATAS jalur boot. `require` tingkat-atas ke modul yang absen membuat
 *   instance itu gagal boot — dan kegagalannya menyeret hal yang tak bersalah: satu job backup
 *   opsional pernah menahan SELURUH cron, dan satu registrar route menahan API kas usaha
 *   menyeberang ke bot kedua.
 *   Pengujiannya statis (bukan require sungguhan) karena memuat index.js akan menyalakan server.
 * Caller: Jest (`npx jest scripts/__tests__/optional-per-instance-modules.test.js`).
 * Deps: fs/path.
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

// Modul yang BOLEH absen di sebagian instance produksi.
const OPSIONAL = ["personal-finance-auth", "personal-finance-backup", "admin-personal-finance-routes"];

// Berkas yang dijalankan saat boot — sebuah require tingkat-atas di sini = proses mati.
const JALUR_BOOT = ["index.js", "lib/cron.js", "routes/admin-router.js", "lib/routes-registry.js"];

/** Baris require di kolom 1 (`const x = require(...)` / `require(...)`) = tingkat atas. */
function requireTingkatAtas(isi) {
    return isi
        .split(/\r?\n/)
        .filter((b) => /^(const|let|var)\s|^require\(/.test(b))
        .filter((b) => /require\(/.test(b));
}

describe("modul opsional per-instance tak boleh menjatuhkan boot instance lain", () => {
    for (const berkas of JALUR_BOOT) {
        test(`${berkas}: tak ada require tingkat-atas ke modul opsional`, () => {
            const isi = baca(...berkas.split("/"));
            const pelanggar = requireTingkatAtas(isi).filter((b) => OPSIONAL.some((m) => b.includes(m)));
            expect(pelanggar).toEqual([]);
        });
    }

    test("pemakaiannya bergerbang config ATAU dibungkus try/catch", () => {
        for (const berkas of ["index.js", "lib/cron.js", "routes/admin-router.js"]) {
            const isi = baca(...berkas.split("/"));
            const baris = isi.split(/\r?\n/);
            for (let i = 0; i < baris.length; i++) {
                if (!OPSIONAL.some((m) => baris[i].includes(m)) || !baris[i].includes("require(")) continue;
                // Lihat 12 baris sebelumnya: harus ada gerbang config atau try.
                const sekitar = baris.slice(Math.max(0, i - 12), i).join("\n");
                expect(`${berkas}:${i + 1} → ${sekitar.includes("try") || sekitar.includes("personalFinance") ? "terjaga" : "TELANJANG"}`)
                    .toContain("terjaga");
            }
        }
    });

    test("PORT tetap dari environment — deploy berkas tak boleh memindahkan port instance", () => {
        // Dander :3010 dan Tanjungharjo :3200 dipasok PM2 lewat env, bukan ditulis di berkas.
        // Menghardcode angka di sini akan menabrakkan dua bot di satu port saat deploy.
        const isi = baca("index.js");
        expect(isi).toMatch(/const PORT = process\.env\.PORT \|\| \d+/);
        const cocok = isi.match(/\.listen\(\s*([A-Za-z_$][\w$]*)/g) || [];
        for (const c of cocok) {
            expect(c).toMatch(/\.listen\(\s*(PORT|PUBLIC_PORT|server|port)/);
        }
    });
});
