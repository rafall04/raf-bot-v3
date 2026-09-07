/**
 * Header Doc
 * Purpose: Mengunci Gelombang C ronde 4 (koreksi cron/ACS #b347) — perilaku yang tak mudah
 *   di-eksekusi-isolasi, dijaga via pemindaian sumber:
 *   #7  auto-outage-check: guard re-entrancy (anti dobel-DM) + reset di finally.
 *   #13 billing-akhir-bulan: dedup profil LIVE (anti re-isolir+reboot berulang) seperti isolir-paket.
 *   #15 refreshDeviceObjects: purge task ber-202 (anti kebocoran antrean ACS di jalur cek-wifi).
 *   #16 speed-revert & compensation-revert: kegagalan TRANSIEN tak di-finalize error permanen (retry).
 *   #18 redaman-check: resolveByCustomer dioper pppoeActive live (MAC EPON) — jalur saudara #b340.
 * Caller: Jest.
 * Deps: fs, path (baca sumber, tidak eksekusi). Uji fungsional rebootDevice 202 ada di genieacs.test.js.
 * SideEffects: -
 */
"use strict";
const fs = require("fs");
const path = require("path");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");

describe("#7 auto-outage-check re-entrancy guard (#b347)", () => {
    const src = read("lib/cron/jobs/auto-outage-check.js");
    test("punya boolean 'autoOutageRunning' + guard di awal callback", () => {
        expect(src).toMatch(/let\s+autoOutageRunning\s*=\s*false/);
        expect(src).toMatch(/if\s*\(\s*autoOutageRunning\s*\)/);
    });
    test("reset autoOutageRunning=false di finally (tak nyangkut bila error)", () => {
        expect(src).toMatch(/finally\s*\{[\s\S]*autoOutageRunning\s*=\s*false/);
    });
});

describe("#13 billing-akhir-bulan dedup profil LIVE (#b347)", () => {
    const src = read("lib/cron/jobs/billing-akhir-bulan.js");
    test("membaca getPPPoEUserProfile live di runIsolirPhase (bukan cuma profil paket statis)", () => {
        expect(src).toMatch(/getPPPoEUserProfile\(/);
        expect(src).toMatch(/assertMikrotikResult\(/);
    });
    test("skip bila liveProfile === isolirProfile (dedup) + fetchFail continue (fail-safe)", () => {
        expect(src).toMatch(/liveProfile\s*===\s*isolirProfile/);
        expect(src).toMatch(/fetchFail\+\+|fetchFail \+= 1/);
    });
});

describe("#15 refreshDeviceObjects purge task 202 (#b347)", () => {
    const src = read("lib/genieacs.js");
    test("mengumpulkan task ber-httpStatus 202 lalu menghapusnya (/tasks delete)", () => {
        const i = src.indexOf("async function refreshDeviceObjects");
        const blok = src.slice(i, i + 3000);
        expect(blok).toMatch(/purgeTaskIds/);
        expect(blok).toMatch(/httpStatus === 202/);
        expect(blok).toMatch(/genieacsRequest\(\s*['"]delete['"]\s*,\s*`\/tasks\//);
    });
});

describe("#16 revert boost: kegagalan transien tak finalize error permanen (#b347)", () => {
    for (const rel of ["lib/cron/jobs/speed-revert.js", "lib/cron/jobs/compensation-revert.js"]) {
        test(`${rel}: ada isTransientMikrotikError + MAX_REVERT_RETRIES + retry counter`, () => {
            const src = read(rel);
            expect(src).toMatch(/function isTransientMikrotikError/);
            expect(src).toMatch(/MAX_REVERT_RETRIES/);
            expect(src).toMatch(/revertRetryCount/);
            // Eskalasi admin saat menyerah (bukan diam).
            expect(src).toMatch(/alertRevertStuck/);
        });
    }
});

describe("#18 redaman-check oper pppoeActive live ke resolveByCustomer (#b347)", () => {
    const src = read("lib/cron/jobs/redaman-check.js");
    test("hoist sesiAktifPenuh (objek penuh, bukan .map(name)) + oper sebagai pppoeActive", () => {
        expect(src).toMatch(/let\s+sesiAktifPenuh\s*=\s*\[\]/);
        expect(src).toMatch(/resolveByCustomer\(user,\s*\{\s*oltSnapshot:\s*petaOlt,\s*pppoeActive:\s*sesiAktifPenuh\s*\}\)/);
    });
});
