/**
 * Header Doc
 * Purpose : Menjaga agar verifikasi pasca-perbaikan membaca redaman lewat WEB, bukan SNMP (#b274).
 *           SNMP membuat OLT hang — kalau bawaannya diam-diam kembali ke SNMP lewat refactor,
 *           kerusakannya baru terasa saat OLT sudah tak menjawab.
 * Caller  : jest
 * Deps    : lib/post-repair-verification
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const fs = require("fs");
const path = require("path");
const { DEFAULTS, createPostRepairVerifier } = require("../post-repair-verification");

const SRC = fs.readFileSync(path.join(__dirname, "..", "post-repair-verification.js"), "utf8");

describe("#b274 — sumber redaman: WEB secara bawaan", () => {
    test("bawaan config = web", () => {
        expect(DEFAULTS.sumber).toBe("web");
    });

    test("pembaca web dipanggil, dan SNMP hanya lewat pilihan eksplisit", () => {
        expect(SRC).toMatch(/getWebOpticalSnapshot/);
        expect(SRC).toMatch(/sumber === "snmp"/);
    });

    test("config tanpa `sumber` tetap memilih web", async () => {
        let dipanggil = null;
        // Dep di-inject dari luar tetap menang — ini yang dipakai seluruh tes lain.
        const v = createPostRepairVerifier({
            getConfig: () => ({ enabled: true, settleDelayMs: 1 }),
            getOltSnapshot: async () => { dipanggil = "disuntik"; return { status: "success", onus: [] }; },
            buildOnuIndex: () => ({ oltByMac: {}, oltByPppoe: {}, oltBySerial: {} }),
            isRxPowerValid: () => false,
            normalizeMAC: (m) => String(m),
            getRxHistory: () => [],
            postToGroup: async () => ({ sent: true }),
            getLosConfig: () => ({ groupId: "g@g.us" }),
            getTeknisiRecipients: () => [],
            setTimeoutFn: (fn) => { setImmediate(fn); return { unref: () => {} }; },
            logger: { log: () => {}, error: () => {} },
        });
        v.reportAfterRecovery({ oltKey: "o", recovered: [{ mac: "AA", slot: 1, onu: 1, name: "X" }], stillDown: [] });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        expect(dipanggil).toBe("disuntik");
    });

    test("!! berkas ini tak boleh mengimpor SNMP secara langsung", () => {
        expect(SRC).not.toMatch(/net-snmp/);
    });
});
