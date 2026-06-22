/**
 * Test diagnosis-verdict — vonis berperingkat dari kombinasi sinyal (toleransi -25).
 * Menjaga urutan prioritas: LOS → Dying Gasp → gangguan area → putus tunggal →
 * online+redaman buruk/waspada → sehat → unknown; serta pemilihan RX terburuk.
 */
"use strict";

const { buildVerdict, worseRx } = require("../diagnosis-verdict");
const { rxVerdict } = require("../../../../lib/telegram/telegram-format");

const TOL = -25;

describe("buildVerdict — prioritas", () => {
    test("LOS → merah (paling diutamakan, walau online)", () => {
        const v = buildVerdict({ lineStatus: "online", oltStatus: "LOS", isLos: true, modemRxRaw: "-20", tolerance: TOL });
        expect(v.level).toBe("red");
        expect(v.headline).toContain("LOS");
    });

    test("Dying Gasp → merah", () => {
        const v = buildVerdict({ lineStatus: "offline", isDyingGasp: true, tolerance: TOL });
        expect(v.level).toBe("red");
        expect(v.headline).toContain("Dying Gasp");
    });

    test("offline + gangguan area → merah, sebut jumlah terdampak", () => {
        const v = buildVerdict({ lineStatus: "offline", areaOutage: true, offlineCount: 12, tolerance: TOL });
        expect(v.level).toBe("red");
        expect(v.headline).toContain("area");
        expect(v.penyebab).toContain("12");
    });

    test("offline tunggal → merah (hanya pelanggan ini)", () => {
        const v = buildVerdict({ lineStatus: "offline", areaOutage: false, offlineCount: 1, tolerance: TOL });
        expect(v.level).toBe("red");
        expect(v.headline).toContain("hanya pelanggan ini");
    });

    test("online + redaman BURUK → kuning", () => {
        const v = buildVerdict({ lineStatus: "online", modemRxRaw: "-27", tolerance: TOL });
        expect(v.level).toBe("yellow");
        expect(v.headline).toContain("BURUK");
        expect(v.rx.label).toBe("BURUK");
    });

    test("online + redaman WASPADA → kuning", () => {
        const v = buildVerdict({ lineStatus: "online", modemRxRaw: "-24", tolerance: TOL });
        expect(v.level).toBe("yellow");
        expect(v.headline).toContain("ambang");
    });

    test("online + redaman BAIK → hijau sehat", () => {
        const v = buildVerdict({ lineStatus: "online", modemRxRaw: "-20", tolerance: TOL });
        expect(v.level).toBe("green");
        expect(v.headline).toBe("Sehat");
    });

    test("online tanpa data redaman → hijau (online)", () => {
        const v = buildVerdict({ lineStatus: "online", modemRxRaw: null, oltRxRaw: null, tolerance: TOL });
        expect(v.level).toBe("green");
        expect(v.saran).toBeNull();
    });

    test("status tak lengkap (semua tak terjangkau) → abu-abu", () => {
        const v = buildVerdict({ lineStatus: "unknown", tolerance: TOL });
        expect(v.level).toBe("gray");
        expect(v.saran).toContain("/redaman");
    });
});

describe("worseRx", () => {
    test("pilih yang lebih buruk antara modem & OLT", () => {
        const buruk = rxVerdict("-27", TOL);
        const baik = rxVerdict("-20", TOL);
        expect(worseRx(baik, buruk).label).toBe("BURUK");
        expect(worseRx(buruk, baik).label).toBe("BURUK");
    });
    test("abaikan yang tak ada nilainya", () => {
        const baik = rxVerdict("-20", TOL);
        const kosong = rxVerdict("N/A", TOL);
        expect(worseRx(kosong, baik).label).toBe("BAIK");
        expect(worseRx(null, baik).label).toBe("BAIK");
    });
});
