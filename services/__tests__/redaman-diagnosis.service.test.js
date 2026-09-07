/**
 * Header Doc
 * Purpose: Guard fondasi #b350 — service diagnosa redaman dua-sisi: gabung ACS+OLT, vonis via
 *   rx_tolerance, HORMATI rxPowerValid (ONU non-Online → RX tak divonis), never-throw saat sumber gagal.
 * Caller: Jest.
 * Deps: ../redaman-diagnosis.service (murni, deps di-mock).
 * SideEffects: -
 */
"use strict";
const { createRedamanDiagnosisService, formatDetailLines, summarizeAffectedFromSnapshot } = require("../redaman-diagnosis.service");

const CFG = () => ({ rx_tolerance: -25 });
const user = { id: 7, name: "Budi|Net", pppoe_username: "budi@isp|x", device_id: "DEV-1" };

function mk(overrides = {}) {
    return createRedamanDiagnosisService({
        getCustomerRedaman: overrides.getCustomerRedaman || (async () => ({ redaman: -24 })),
        getOltSnapshot: overrides.getOltSnapshot || (async () => ({ onus: [] })),
        resolveByCustomer: overrides.resolveByCustomer || (() => ({ matched: true, identifiable: true, rxPower: -26.5, rxPowerValid: true, status: "Online", isLos: false, isDyingGasp: false, oltName: "OLT-A", ponName: "PON1", onuId: 3 })),
        getActivePPPoEUsers: overrides.getActivePPPoEUsers || (async () => ({ ok: true, data: [] })),
        getConfig: overrides.getConfig || CFG,
    });
}

describe("redaman-diagnosis.service (#b350)", () => {
    test("dua sumber terbaca: modem BAIK (-20) + OLT BURUK (-26.5) vs tol -25; terburuk=OLT", async () => {
        const d = await mk({ getCustomerRedaman: async () => ({ redaman: -20 }) }).diagnoseCustomer(user);
        expect(d.nama).toBe("Budi");            // split '|' + trim
        expect(d.pppoe).toBe("budi@isp");
        expect(d.modem.reachable).toBe(true);
        expect(d.modem.verdict.label).toBe("BAIK");
        expect(d.oltVerdict.label).toBe("BURUK");
        expect(d.combined.terburuk).toBe(-26.5);
        expect(d.sources).toEqual({ modem: true, olt: true });
    });

    test("ONU non-Online (rxPowerValid=false, LOS) → OLT TIDAK divonis + kesimpulan LOS", async () => {
        const d = await mk({
            resolveByCustomer: () => ({ matched: true, identifiable: true, rxPower: -40, rxPowerValid: false, status: "LOS", isLos: true, isDyingGasp: false }),
        }).diagnoseCustomer(user);
        expect(d.oltVerdict).toBeNull();                      // angka basi TIDAK divonis
        expect(d.combined.olt).toBeNull();                    // tak masuk gabungan
        expect(d.kesimpulan).toMatch(/LOS/);
        const lines = formatDetailLines(d).join("\n");
        expect(lines).toMatch(/RX belum valid/);
        expect(lines).not.toMatch(/-40 dBm — /);              // -40 tak dipamerkan sebagai kondisi kini
    });

    test("Dying Gasp → kesimpulan catu daya", async () => {
        const d = await mk({
            resolveByCustomer: () => ({ matched: true, identifiable: true, rxPowerValid: false, status: "Dying Gasp", isLos: false, isDyingGasp: true }),
        }).diagnoseCustomer(user);
        expect(d.kesimpulan).toMatch(/Dying Gasp|catu daya/);
    });

    test("modem tak terjangkau (ACS throw) + OLT tak terpetakan → NEVER-THROW, sources false", async () => {
        const d = await mk({
            getCustomerRedaman: async () => { throw new Error("ACS timeout"); },
            resolveByCustomer: () => ({ matched: false, identifiable: false }),
        }).diagnoseCustomer(user);
        expect(d.modem.reachable).toBe(false);
        expect(d.sources).toEqual({ modem: false, olt: false });
        expect(d.kesimpulan).toBeNull();
    });

    test("resolveByCustomer MELEMPAR → ditelan (never-throw), olt null", async () => {
        const d = await mk({ resolveByCustomer: () => { throw new Error("boom"); } }).diagnoseCustomer(user);
        expect(d.olt).toBeNull();
        expect(d.modem.reachable).toBe(true);                 // sisi modem tetap jalan
    });

    test("tanpa device_id → sisi ACS dilewati (hasDevice false), OLT tetap jalan", async () => {
        const d = await mk().diagnoseCustomer({ id: 8, name: "Sari", pppoe_username: "sari@isp" });
        expect(d.modem.hasDevice).toBe(false);
        expect(d.modem.reachable).toBe(false);
        expect(d.sources.olt).toBe(true);
    });

    test("pppoeActive dioper (batch share) → getActivePPPoEUsers TIDAK dipanggil", async () => {
        const spy = jest.fn(async () => ({ ok: true, data: [] }));
        const d = await mk({ getActivePPPoEUsers: spy }).diagnoseCustomer(user, { pppoeActive: [{ name: "budi@isp", caller_id: "AA:BB" }] });
        expect(spy).not.toHaveBeenCalled();
        expect(d.sources.olt).toBe(true);
    });
});

describe("summarizeAffectedFromSnapshot (#b352 Fase 3, snapshot-direct)", () => {
    const SNAP = { onus: [
        { description: "los@isp", status: "LOS", isLos: true, isDyingGasp: false, statusKnown: true, olt_name: "OLT-A", ponName: "PON1", id: 1, rxPower: -40 },
        { description: "buruk@isp", status: "Online", statusKnown: true, olt_name: "OLT-A", ponName: "PON1", id: 2, rxPower: -27 },
        { description: "baik@isp", status: "Online", statusKnown: true, olt_name: "OLT-B", ponName: "PON2", id: 3, rxPower: -20 },
    ] };
    const TOL = -25;

    test("onlyBad: LOS + Online-BURUK; ranking LOS (offline) dulu lalu RX terburuk; ONU baik dibuang", () => {
        const r = summarizeAffectedFromSnapshot(SNAP, { onlyBad: true, tolerance: TOL });
        expect(r.total).toBe(2);
        expect(r.rows[0].label).toBe("los@isp");   // offline paling parah
        expect(r.rows[0].rxValid).toBe(false);      // LOS → RX tak valid (tak dipamerkan)
        expect(r.rows[1].label).toBe("buruk@isp");  // Online -27 BURUK
        expect(r.rows[1].verdict.label).toBe("BURUK");
        expect(r.rows.find((x) => x.label === "baik@isp")).toBeUndefined();
    });

    test("filter oltName → hanya OLT-B (baik@isp), onlyBad off menampilkan semua di OLT itu", () => {
        const r = summarizeAffectedFromSnapshot(SNAP, { oltName: "olt-b", onlyBad: false, tolerance: TOL });
        expect(r.total).toBe(1);
        expect(r.rows[0].label).toBe("baik@isp");
        expect(r.rows[0].rxValid).toBe(true);
        expect(r.rows[0].verdict.label).toBe("BAIK");
    });

    test("limit → truncated true + rows terpotong", () => {
        const r = summarizeAffectedFromSnapshot(SNAP, { onlyBad: false, tolerance: TOL, limit: 1 });
        expect(r.total).toBe(3);
        expect(r.truncated).toBe(true);
        expect(r.rows.length).toBe(1);
    });

    test("snapshot null/kosong → total 0 (never-throw)", () => {
        expect(summarizeAffectedFromSnapshot(null, { tolerance: TOL }).total).toBe(0);
        expect(summarizeAffectedFromSnapshot({ onus: [] }, { tolerance: TOL }).total).toBe(0);
    });
});
