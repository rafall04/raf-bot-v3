/**
 * Header Doc
 * Purpose: Unit test `lib/area-outage-gate` — mengunci dua perilaku yang mudah rusak diam-diam:
 *          (a) verdict "gangguan area" untuk menjawab pelanggan/teknisi, dan (b) gerbang penahan
 *          gangguan-massal yang HARUS diukur dari ukuran batch kiriman, bukan dari jumlah pelanggan
 *          offline apa adanya — kalau tertukar, pelanggan isolir/churn menyalakannya permanen dan
 *          mematikan auto outage tanpa gejala apa pun.
 * Caller: Jest.
 * Deps: `lib/area-outage-gate`.
 * MainFuncs: -
 * SideEffects: Tidak ada (modul murni, tak menyentuh global.config).
 */
"use strict";

const { evaluateAreaOutage, evaluateMassOutage, getAreaOutageThresholds } = require("../area-outage-gate");

describe("evaluateAreaOutage (verdict untuk menjawab)", () => {
    test("jumlah offline mencapai ambang absolut → gangguan area", () => {
        const result = evaluateAreaOutage({ offlineCount: 5, totalWithPppoe: 96, config: {} });
        expect(result.areaOutage).toBe(true);
        expect(result.minOffline).toBe(5);
    });

    test("di bawah ambang absolut & rasio → bukan gangguan area", () => {
        expect(evaluateAreaOutage({ offlineCount: 4, totalWithPppoe: 96, config: {} }).areaOutage).toBe(false);
    });

    test("rasio tinggi tetap dihitung gangguan area walau jumlahnya kecil", () => {
        // 2 dari 4 = 50% ≥ 30%. Untuk MENJAWAB pelanggan ini benar: mayoritas tetangganya mati.
        const result = evaluateAreaOutage({ offlineCount: 2, totalWithPppoe: 4, config: {} });
        expect(result.areaOutage).toBe(true);
        expect(result.ratio).toBeCloseTo(0.5);
    });

    test("ambang bisa disetel lewat config lama outage_area_threshold", () => {
        const config = { outage_area_threshold: 20, outage_area_ratio: 0.9 };
        expect(evaluateAreaOutage({ offlineCount: 10, totalWithPppoe: 96, config }).areaOutage).toBe(false);
        expect(getAreaOutageThresholds(config).minOffline).toBe(20);
    });

    test("input kosong/aneh tidak melempar dan tidak membagi nol", () => {
        const result = evaluateAreaOutage({ offlineCount: 0, totalWithPppoe: 0, config: {} });
        expect(result.areaOutage).toBe(false);
        expect(result.ratio).toBe(0);
    });
});

describe("evaluateMassOutage (gerbang penahan kiriman)", () => {
    test("batch besar → gerbang menyala", () => {
        const result = evaluateMassOutage({ eligibleCount: 30, totalWithPppoe: 96, config: {} });
        expect(result.active).toBe(true);
        expect(result.eligibleCount).toBe(30);
        expect(result.reason).toBe("batch_too_large");
    });

    test("batch kecil lolos — gangguan tunggal tetap ditanya", () => {
        expect(evaluateMassOutage({ eligibleCount: 1, totalWithPppoe: 96, config: {} }).active).toBe(false);
        expect(evaluateMassOutage({ eligibleCount: 4, totalWithPppoe: 96, config: {} }).active).toBe(false);
    });

    // REGRESI PALING BERBAHAYA. Kalau gerbang memakai jumlah OFFLINE apa adanya, pelanggan isolir/
    // churn yang sudah mati berminggu-minggu membuatnya menyala TERUS — auto outage mati diam-diam,
    // tanpa error, cuma pesan yang tak pernah terkirim. Ukuran batch kebal karena pelanggan yang
    // sudah pernah disapa tertahan `broadcast_count` dan tak pernah masuk hitungan lagi.
    test("hanya menghitung batch yang AKAN dikirim, bukan seluruh pelanggan offline", () => {
        // 40 pelanggan offline lama, tapi semuanya sudah pernah disapa → batch 0.
        const result = evaluateMassOutage({ eligibleCount: 0, totalWithPppoe: 96, config: {} });
        expect(result.active).toBe(false);
        expect(result.eligibleCount).toBe(0);
    });

    test("ambang batch bisa disetel lewat config", () => {
        const config = { autoOutageMassGate: { maxBatchSize: 20 } };
        expect(evaluateMassOutage({ eligibleCount: 10, totalWithPppoe: 96, config }).active).toBe(false);
        expect(evaluateMassOutage({ eligibleCount: 20, totalWithPppoe: 96, config }).active).toBe(true);
    });

    test("bisa dimatikan sengaja lewat config → inert", () => {
        const result = evaluateMassOutage({
            eligibleCount: 30,
            totalWithPppoe: 96,
            config: { autoOutageMassGate: { enabled: false } },
        });
        expect(result.active).toBe(false);
        expect(result.enabled).toBe(false);
        expect(result.eligibleCount).toBe(30);
    });

    test("default AKTIF tanpa config apa pun (gerbang pengaman, bukan fitur)", () => {
        const result = evaluateMassOutage({ eligibleCount: 30, totalWithPppoe: 96, config: {} });
        expect(result.enabled).toBe(true);
        expect(result.active).toBe(true);
    });

    test("input aneh tidak melempar", () => {
        expect(evaluateMassOutage().active).toBe(false);
        expect(evaluateMassOutage({ eligibleCount: "bukan angka", config: {} }).active).toBe(false);
    });
});
