/**
 * Header Doc
 * Purpose : Menjaga gerbang merk pada snapshot kesehatan OLT (#b275) — SNMP hanya ditembakkan
 *           ke OLT ZTE. OID di `olt-snmp-health` adalah ZTE enterprise; menembakkannya ke OLT
 *           HIOSO tidak menghasilkan apa pun, hanya beban — dan SNMP membuat OLT hang.
 * Caller  : jest
 * Deps    : pemeriksaan sumber (jalur SNMP-nya tak punya seam injeksi)
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "olt-health-service.js"), "utf8");

describe("#b275 — SNMP kesehatan OLT dikunci ke merk ZTE", () => {
    test("panggilan getSnmpHealth berada di dalam gerbang merk", () => {
        const i = SRC.indexOf("await getSnmpHealth(device)");
        expect(i).toBeGreaterThan(0);
        // Gerbangnya harus muncul SEBELUM pemanggilan, di dekatnya.
        const sebelum = SRC.slice(Math.max(0, i - 600), i);
        expect(sebelum).toMatch(/merk === "zte"/);
    });

    test("merk diambil dari device, bukan dianggap ZTE begitu saja", () => {
        expect(SRC).toMatch(/const merk = String\(\(device && device\.brand\) \|\| ""\)\.toLowerCase\(\)/);
    });

    test("!! gerbangnya tidak boleh selalu benar", () => {
        // Mutasi yang pernah lolos: `if (merk === "zte")` diubah jadi `if (true)`.
        const i = SRC.indexOf("await getSnmpHealth(device)");
        const sebelum = SRC.slice(Math.max(0, i - 600), i);
        expect(sebelum).not.toMatch(/if \(true\)/);
        expect(sebelum).not.toMatch(/if \(1\)/);
    });

    test("brand 'auto' berarti HIOSO — tidak boleh ikut lewat gerbang", () => {
        // Dicatat eksplisit di komentar supaya niatnya tak hilang saat refactor.
        expect(SRC).toMatch(/brand: "auto".*HIOSO|HIOSO.*brand: "auto"/s);
    });
});
