/**
 * Header Doc
 * Purpose : Menjaga aturan pemilihan sumber redaman (#b277) — OLT didahulukan, ACS menambal,
 *           dan beda besar dibaca sebagai masalah PEMETAAN, bukan masalah optik.
 * Caller  : jest
 * Deps    : lib/redaman-sumber-silang (murni)
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const { pilihNilaiRedaman, AMBANG_BEDA_DB, SUMBER } = require("../redaman-sumber-silang");

describe("#b277 — memilih angka redaman dari ACS + OLT", () => {
    test("keduanya diam → tidak ada angka, tidak menebak", () => {
        const r = pilihNilaiRedaman({ acs: null, olt: null });
        expect(r.angka).toBeNull();
        expect(r.sumber).toBe(SUMBER.TIDAK_ADA);
        expect(r.integritasMencurigakan).toBe(false);
    });

    test("!! modem tak inform (ACS kosong) → OLT menambal, alarm tak lagi buta", () => {
        const r = pilihNilaiRedaman({ acs: null, olt: -27.4 });
        expect(r.angka).toBeCloseTo(-27.4, 2);
        expect(r.sumber).toBe(SUMBER.OLT);
    });

    test("OLT tak terjangkau → ACS dipakai", () => {
        const r = pilihNilaiRedaman({ acs: -26, olt: null });
        expect(r.angka).toBe(-26);
        expect(r.sumber).toBe(SUMBER.ACS);
    });

    test("!! keduanya ada dan sepakat → pakai OLT (2 desimal; Huawei memotong desimal)", () => {
        // Pola truncation nyata: OLT -24,81 dilaporkan ACS sebagai -24.
        const r = pilihNilaiRedaman({ acs: -24, olt: -24.81 });
        expect(r.sumber).toBe(SUMBER.OLT);
        expect(r.angka).toBeCloseTo(-24.81, 2);
        expect(r.integritasMencurigakan).toBe(false);
        expect(r.beda).toBeCloseTo(0.81, 2);
    });

    test("selisih EKOR terukur (s/d 1,85 dB) TIDAK dianggap mencurigakan", () => {
        // Nyata di produksi: sppg -19 vs -20,81 dan mochamad_dayat -24 vs -25,85 — keduanya
        // HG8145V5 dengan pemetaan yang benar.
        for (const [acs, olt] of [[-18, -18.93], [-23, -23.28], [-19, -20.81], [-24, -25.85]]) {
            const r = pilihNilaiRedaman({ acs, olt });
            expect(r.integritasMencurigakan).toBe(false);
            expect(r.sumber).toBe(SUMBER.OLT);
        }
    });

    test("!! beda di atas ambang → DITAHAN, ditandai masalah pemetaan (bukan optik)", () => {
        const r = pilihNilaiRedaman({ acs: -20, olt: -30.4 });
        expect(r.integritasMencurigakan).toBe(true);
        expect(r.angka).toBeNull();          // tak ada angka yang layak dipercaya
        expect(r.sumber).toBe(SUMBER.TIDAK_ADA);
        expect(r.beda).toBeCloseTo(10.4, 2);
    });

    test("ambang berada di atas MAKSIMUM terukur pada pemetaan yang benar", () => {
        // Di atas MAKSIMUM terukur pada perangkat yang pemetaannya benar (1,85 dB pada HG8145V5,
        // n=92) — bukan sekadar di atas p90. Ambang 1,5 terbukti menandai 2 dari 97 secara keliru.
        expect(AMBANG_BEDA_DB).toBeGreaterThan(1.85);
        expect(AMBANG_BEDA_DB).toBeLessThanOrEqual(3);
    });

    test("tepat di ambang belum mencurigakan; sedikit di atasnya baru ya", () => {
        expect(pilihNilaiRedaman({ acs: -20, olt: -22.5 }).integritasMencurigakan).toBe(false);
        expect(pilihNilaiRedaman({ acs: -20, olt: -22.6 }).integritasMencurigakan).toBe(true);
    });

    test("string dari ACS ikut terbaca; sampah tidak", () => {
        expect(pilihNilaiRedaman({ acs: "-24.5", olt: null }).angka).toBeCloseTo(-24.5, 2);
        expect(pilihNilaiRedaman({ acs: "N/A", olt: null }).angka).toBeNull();
        expect(pilihNilaiRedaman({ acs: "", olt: null }).angka).toBeNull();
    });

    test("ambang bisa disetel pemanggil", () => {
        expect(pilihNilaiRedaman({ acs: -20, olt: -24, ambangBedaDb: 5 }).integritasMencurigakan).toBe(false);
        expect(pilihNilaiRedaman({ acs: -20, olt: -24, ambangBedaDb: 1 }).integritasMencurigakan).toBe(true);
    });
});
