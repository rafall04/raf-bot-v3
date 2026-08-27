/**
 * Header Doc
 * Purpose : Menjaga aturan silang dua sumber untuk LOS vs dying-gasp (#b279).
 *           LOS = ketiadaan bukti; dying-gasp = bukti positif. Lintas-sumber, DG menang.
 * Caller  : jest
 * Deps    : lib/olt-dg-crosscheck (murni, in-memory)
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const silang = require("../olt-dg-crosscheck");

const MAC = "38:20:28:24:A3:ED";
const T = 1_700_000_000_000;

beforeEach(() => silang._reset());

describe("#b279 — LOS vs dying-gasp diputuskan dari DUA sumber", () => {
    test("dying-gasp lewat begitu saja dan tercatat sebagai jejak", () => {
        const r = silang.putuskanJenis({ event_type: "dying-gasp", mac: MAC, tsMs: T, source: "syslog" });
        expect(r.event_type).toBe("dying-gasp");
        expect(r.dikoreksi).toBe(false);
        expect(silang.adaDyingGaspTerkini(MAC, T + 60_000)).toBe(true);
    });

    test("!! LOS setelah DG dari sumber lain → DIKOREKSI jadi dying-gasp", () => {
        // Pola NYATA di produksi: syslog melihat dying-gasp, scrape menyusul dengan 'los'
        // karena baris DG-nya sudah tergulung dari 3 halaman yang dibaca.
        silang.putuskanJenis({ event_type: "dying-gasp", mac: MAC, tsMs: T, source: "syslog" });
        const r = silang.putuskanJenis({ event_type: "los", mac: MAC, tsMs: T + 110_000, source: "scrape" });
        expect(r.event_type).toBe("dying-gasp");
        expect(r.dikoreksi).toBe(true);
        expect(r.alasan).toMatch(/sumber lain/);
    });

    test("LOS tanpa DG di mana pun → tetap LOS (jangan menutupi fiber putus)", () => {
        const r = silang.putuskanJenis({ event_type: "los", mac: MAC, tsMs: T, source: "syslog" });
        expect(r.event_type).toBe("los");
        expect(r.dikoreksi).toBe(false);
    });

    test("!! DG yang sudah LAMA tidak lagi menutupi LOS baru", () => {
        silang.putuskanJenis({ event_type: "dying-gasp", mac: MAC, tsMs: T, source: "syslog" });
        const jauh = T + silang.JENDELA_MS + 60_000;
        const r = silang.putuskanJenis({ event_type: "los", mac: MAC, tsMs: jauh, source: "scrape" });
        expect(r.event_type).toBe("los");
    });

    test("DG milik MAC LAIN tidak menular", () => {
        silang.putuskanJenis({ event_type: "dying-gasp", mac: "AA:BB:CC:DD:EE:FF", tsMs: T, source: "syslog" });
        const r = silang.putuskanJenis({ event_type: "los", mac: MAC, tsMs: T + 60_000, source: "scrape" });
        expect(r.event_type).toBe("los");
    });

    test("format MAC berbeda tetap dianggap perangkat yang sama", () => {
        silang.putuskanJenis({ event_type: "dying-gasp", mac: "38202824a3ed", tsMs: T, source: "syslog" });
        const r = silang.putuskanJenis({ event_type: "los", mac: "38:20:28:24:A3:ED", tsMs: T + 60_000, source: "scrape" });
        expect(r.dikoreksi).toBe(true);
    });

    test("!! koreksi hanya MAJU — DG yang datang SESUDAH tidak menyulap LOS sebelumnya", () => {
        // Sengaja: pola itu belum pernah terukur, dan menulis ulang baris lama menuntut
        // kehati-hatian yang tak sepadan tanpa bukti.
        const los = silang.putuskanJenis({ event_type: "los", mac: MAC, tsMs: T, source: "scrape" });
        expect(los.event_type).toBe("los");
        silang.putuskanJenis({ event_type: "dying-gasp", mac: MAC, tsMs: T + 60_000, source: "syslog" });
        expect(los.event_type).toBe("los");   // yang sudah diputuskan tidak berubah
    });

    test("!! DG ber-stempel LEBIH BARU tak boleh menutupi LOS yang lebih lama", () => {
        // Menjaga ARAH koreksi. Kalau perbandingannya dibuat dua arah (mis. Math.abs),
        // dying-gasp yang terjadi SESUDAH akan menyulap LOS sebelumnya — padahal fiber
        // yang putus lalu listriknya ikut mati tetap fiber putus, dan teknisi harus tahu.
        silang.catatDyingGasp(MAC, T + 5 * 60_000);
        const r = silang.putuskanJenis({ event_type: "los", mac: MAC, tsMs: T, source: "scrape" });
        expect(r.event_type).toBe("los");
        expect(r.dikoreksi).toBe(false);
        expect(silang.adaDyingGaspTerkini(MAC, T)).toBe(false);
    });

    test("jenis lain (discovery) tak tersentuh", () => {
        silang.putuskanJenis({ event_type: "dying-gasp", mac: MAC, tsMs: T, source: "syslog" });
        const r = silang.putuskanJenis({ event_type: "discovery", mac: MAC, tsMs: T + 60_000, source: "scrape" });
        expect(r.event_type).toBe("discovery");
        expect(r.dikoreksi).toBe(false);
    });

    test("MAC kosong tidak menciptakan jejak hantu", () => {
        silang.putuskanJenis({ event_type: "dying-gasp", mac: null, tsMs: T, source: "syslog" });
        expect(silang._ukuran()).toBe(0);
        expect(silang.putuskanJenis({ event_type: "los", mac: null, tsMs: T }).event_type).toBe("los");
    });

    test("ingatan dipangkas — tidak tumbuh tanpa henti", () => {
        for (let i = 0; i < 50; i++) {
            silang.putuskanJenis({ event_type: "dying-gasp", mac: "aa:bb:cc:00:00:" + String(i).padStart(2, "0"), tsMs: T, source: "syslog" });
        }
        expect(silang._ukuran()).toBe(50);
        // Jauh melewati jendela → dipangkas saat pencatatan berikutnya.
        silang.putuskanJenis({ event_type: "dying-gasp", mac: MAC, tsMs: T + silang.JENDELA_MS * 3, source: "syslog" });
        expect(silang._ukuran()).toBe(1);
    });

    test("jendela bisa disetel pemanggil", () => {
        silang.putuskanJenis({ event_type: "dying-gasp", mac: MAC, tsMs: T, source: "syslog" });
        const r = silang.putuskanJenis({ event_type: "los", mac: MAC, tsMs: T + 60_000, source: "scrape", jendelaMs: 30_000 });
        expect(r.event_type).toBe("los");   // di luar jendela sempit
    });
});
