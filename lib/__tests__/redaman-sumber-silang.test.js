/**
 * Header Doc
 * Purpose : Menjaga penyajian redaman DUA SUMBER apa adanya (#b277) — tidak disinkronkan,
 *           tidak ada yang ditahan, dan alarm memakai aturan "salah satu melewati ambang".
 * Caller  : jest
 * Deps    : lib/redaman-sumber-silang (murni)
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const { ringkasDuaSumber, AMBANG_BEDA_DB } = require("../redaman-sumber-silang");

const TOL = -26;
const r = (acs, olt, extra = {}) => ringkasDuaSumber({ acs, olt, ambangAlert: TOL, ...extra });

describe("#b277 — dua sumber ditampilkan apa adanya", () => {
    test("keduanya ada → dua-duanya disebut, tak ada yang dibuang", () => {
        const h = r(-24, -25.85);
        expect(h.teks).toBe("GenieACS -24 dBm · OLT -25.85 dBm");
        expect(h.acs).toBe(-24);
        expect(h.olt).toBeCloseTo(-25.85, 2);
        expect(h.adaData).toBe(true);
    });

    test("!! ACS diam (modem tak inform) → OLT tetap tampil, alarm tak buta", () => {
        const h = r(null, -27.4);
        expect(h.teks).toBe("GenieACS (tidak terbaca) · OLT -27.40 dBm");
        expect(h.layakAlert).toBe(true);
    });

    test("OLT tak terjangkau → ACS tetap tampil", () => {
        const h = r(-27, null);
        expect(h.teks).toBe("GenieACS -27 dBm · OLT (tidak terbaca)");
        expect(h.layakAlert).toBe(true);
    });

    test("tak ada sumber sama sekali → adaData false, tidak mengarang angka", () => {
        const h = r(null, null);
        expect(h.adaData).toBe(false);
        expect(h.layakAlert).toBe(false);
        expect(h.terburuk).toBeNull();
    });

    test("!! alarm bila SALAH SATU melewati ambang — tak perlu sepakat", () => {
        expect(r(-25, -26.2).layakAlert).toBe(true);    // hanya OLT yang lewat
        expect(r(-26.4, -25).layakAlert).toBe(true);    // hanya ACS yang lewat
        expect(r(-24, -24.81).layakAlert).toBe(false);  // dua-duanya aman
    });

    test("tepat DI ambang dihitung kena (batasnya inklusif)", () => {
        expect(r(-26, -25).layakAlert).toBe(true);
        expect(r(-25.99, -25).layakAlert).toBe(false);
    });

    test("!! beda jauh TIDAK menahan alarm — hanya jadi catatan", () => {
        // Versi pertama modul ini MENAHAN alarm saat dua sumber berselisih. Itu berpotensi
        // menyembunyikan gangguan nyata; teknisi yang melihat dua angka bisa menilai sendiri.
        const h = r(-20, -30.4);
        expect(h.bedaBesar).toBe(true);
        expect(h.layakAlert).toBe(true);                 // TETAP alarm
        expect(h.teks).toMatch(/GenieACS -20 dBm · OLT -30\.40 dBm/);
        expect(h.teks).toMatch(/cek pemetaan pelanggan\/ONU/);
        expect(h.beda).toBeCloseTo(10.4, 2);
    });

    test("selisih EKOR terukur (s/d 1,85 dB) bukan 'beda jauh'", () => {
        // Nyata di produksi, keduanya HG8145V5 dengan pemetaan BENAR.
        for (const [acs, olt] of [[-19, -20.81], [-24, -25.85], [-18, -18.93]]) {
            expect(r(acs, olt).bedaBesar).toBe(false);
        }
    });

    test("ambang catatan di atas MAKSIMUM terukur pada pemetaan yang benar", () => {
        expect(AMBANG_BEDA_DB).toBeGreaterThan(1.85);
    });

    test("terburuk = yang paling parah dari yang tersedia", () => {
        expect(r(-24, -25.85).terburuk).toBeCloseTo(-25.85, 2);
        expect(r(-27, null).terburuk).toBe(-27);
        expect(r(null, -21.5).terburuk).toBeCloseTo(-21.5, 2);
    });

    test("string dari ACS terbaca; sampah tidak dianggap angka", () => {
        expect(r("-24.5", null).acs).toBeCloseTo(-24.5, 2);
        expect(r("N/A", -21).acs).toBeNull();
        expect(r("", -21).teks).toBe("GenieACS (tidak terbaca) · OLT -21 dBm");
    });
});
