/**
 * Header Doc
 * Purpose: Unit test laporan verifikasi pasca-perbaikan. Yang dikunci di sini adalah hal-hal yang
 *          membuat laporan ini ADA gunanya: pengukuran harus SEGAR (force-refresh, bukan cache),
 *          pelanggan yang MASIH MATI wajib muncul (notif pulih bawaan hanya menyebut yang online
 *          lagi), redaman sisa milik ONU mati tidak boleh dihitung pulih, dan snapshot gagal harus
 *          diakui alih-alih menghasilkan laporan "semua aman" yang palsu.
 * Caller: Jest.
 * Deps: `lib/post-repair-verification` dengan seluruh dependency diinjeksi (tanpa SNMP & WhatsApp).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
"use strict";

const { createPostRepairVerifier } = require("../post-repair-verification");

const NOW = Date.parse("2026-07-31T10:00:00.000Z");

function onu(mac, status, rxPower, extra = {}) {
    return { macAddress: mac, status, rxPower, slotId: 1, id: 5, ...extra };
}

function makeVerifier(overrides = {}) {
    const sent = [];
    const verifier = createPostRepairVerifier({
        getConfig: () => ({ enabled: true, minAffected: 3, settleDelayMs: 1000, rxWarnDbm: -25, rxDegradeDb: 3 }),
        getOltSnapshot: jest.fn(async () => ({ status: "success", onus: [] })),
        buildOnuIndex: (onus) => ({
            oltByMac: Object.fromEntries((onus || []).map((o) => [String(o.macAddress).replace(/[^0-9a-f]/gi, "").toLowerCase().substring(0, 10), o])),
            oltByPppoe: {},
            oltBySerial: {},
        }),
        isRxPowerValid: (o, status) => !!o && o.statusKnown !== false && status === "Online" && Number.isFinite(parseFloat(o.rxPower)),
        normalizeMAC: (mac) => String(mac || "").replace(/[^0-9a-f]/gi, "").toLowerCase(),
        getRxHistory: () => [],
        postToGroup: jest.fn(async (groupId, text) => {
            sent.push({ groupId, text });
            return { sent: true };
        }),
        getLosConfig: () => ({ groupId: "grup-alarm@g.us" }),
        getTeknisiRecipients: () => [],
        now: () => NOW,
        logger: { log: () => {}, error: () => {} },
        ...overrides,
    });
    return { verifier, sent };
}

const AFFECTED = [
    { mac: "aa:bb:cc:dd:01:01", name: "Budi", slot: 1, onu: 5, downAtMs: NOW - 3600000 },
    { mac: "aa:bb:cc:dd:02:02", name: "Sari", slot: 1, onu: 6, downAtMs: NOW - 3600000 },
    { mac: "aa:bb:cc:dd:03:03", name: "Tono", slot: 1, onu: 7, downAtMs: NOW - 3600000 },
];

describe("buildReport", () => {
    test("mengukur dari snapshot SEGAR (force-refresh), bukan cache", async () => {
        const getOltSnapshot = jest.fn(async () => ({ status: "success", onus: [] }));
        const { verifier } = makeVerifier({ getOltSnapshot });

        await verifier.buildReport({ oltKey: "olt-1", affected: AFFECTED });

        expect(getOltSnapshot).toHaveBeenCalledWith({ forceRefresh: true });
    });

    test("memilah pulih / masih mati / tak terbaca", async () => {
        const { verifier } = makeVerifier({
            getOltSnapshot: async () => ({
                status: "success",
                onus: [
                    onu("aa:bb:cc:dd:01:01", "Online", "-21.40"),
                    onu("aa:bb:cc:dd:02:02", "LOS", "-24.80"),
                    // ee:03 sengaja tidak ada di snapshot → tak terbaca
                ],
            }),
        });

        const report = await verifier.buildReport({ oltKey: "olt-1", affected: AFFECTED });

        expect(report.summary).toMatchObject({ total: 3, pulih: 1, masihMati: 1, takTerbaca: 1 });
        expect(report.rows.find((r) => r.name === "Budi").verdict).toBe("PULIH");
        expect(report.rows.find((r) => r.name === "Sari").verdict).toBe("MASIH_MATI");
        expect(report.rows.find((r) => r.name === "Tono").verdict).toBe("TIDAK_TERBACA");
    });

    // Inti dari seluruh perbaikan ini: OLT EPON menyimpan rxPower terakhir ONU yang sudah mati.
    // Kalau angka itu diperlakukan sebagai hasil ukur, laporan "pasca-perbaikan" justru mengesahkan
    // pelanggan yang masih mati sebagai pulih — persis kesalahan yang mau dihentikan.
    test("redaman sisa milik ONU mati TIDAK dihitung pulih", async () => {
        const { verifier } = makeVerifier({
            getOltSnapshot: async () => ({
                status: "success",
                onus: [onu("aa:bb:cc:dd:01:01", "LOS", "-19.10")], // angka bagus, tapi ONU mati
            }),
        });

        const report = await verifier.buildReport({ oltKey: "olt-1", affected: [AFFECTED[0]] });

        expect(report.rows[0].verdict).toBe("MASIH_MATI");
        expect(report.rows[0].rxPowerValid).toBe(false);
    });

    test("status ONU tak terbaca (walk SNMP setengah jadi) → TIDAK_TERBACA, bukan pulih", async () => {
        const { verifier } = makeVerifier({
            getOltSnapshot: async () => ({
                status: "success",
                onus: [onu("aa:bb:cc:dd:01:01", "Online", "-21.00", { statusKnown: false })],
            }),
        });

        const report = await verifier.buildReport({ oltKey: "olt-1", affected: [AFFECTED[0]] });
        expect(report.rows[0].verdict).toBe("TIDAK_TERBACA");
    });

    test("online tapi redaman melewati ambang → perlu dicek, bukan langsung 'pulih'", async () => {
        const { verifier } = makeVerifier({
            getOltSnapshot: async () => ({
                status: "success",
                onus: [onu("aa:bb:cc:dd:01:01", "Online", "-26.50")],
            }),
        });

        const report = await verifier.buildReport({ oltKey: "olt-1", affected: [AFFECTED[0]] });
        expect(report.rows[0].verdict).toBe("REDAMAN_MEMBURUK");
    });

    test("memburuk dibanding sebelum gangguan terdeteksi lewat riwayat redaman", async () => {
        const { verifier } = makeVerifier({
            getOltSnapshot: async () => ({
                status: "success",
                onus: [onu("aa:bb:cc:dd:01:01", "Online", "-23.50")], // masih di atas ambang -25
            }),
            getRxHistory: () => [{ at: NOW - 7200000, rx: -19.0 }], // turun 4.5 dB sesudah perbaikan
        });

        const report = await verifier.buildReport({ oltKey: "olt-1", affected: [AFFECTED[0]] });
        expect(report.rows[0].verdict).toBe("REDAMAN_MEMBURUK");
        expect(report.rows[0].rxBefore).toBe(-19);
    });

    test("snapshot gagal → semua TIDAK_TERBACA dan laporan mengakuinya", async () => {
        const { verifier } = makeVerifier({
            getOltSnapshot: async () => ({ status: "error", onus: [], message: "timeout" }),
        });

        const report = await verifier.buildReport({ oltKey: "olt-1", affected: AFFECTED });

        expect(report.snapshotOk).toBe(false);
        expect(report.summary.takTerbaca).toBe(3);
        expect(verifier.buildMessage(report, { oltKey: "olt-1" })).toContain("Snapshot OLT gagal");
    });
});

describe("buildMessage", () => {
    test("menyebut yang MASIH MATI dan menahan penutupan pekerjaan", async () => {
        const { verifier } = makeVerifier({
            getOltSnapshot: async () => ({
                status: "success",
                onus: [
                    onu("aa:bb:cc:dd:01:01", "Online", "-21.40"),
                    onu("aa:bb:cc:dd:02:02", "LOS", "-24.80"),
                    onu("aa:bb:cc:dd:03:03", "Online", "-22.00"),
                ],
            }),
        });

        const report = await verifier.buildReport({ oltKey: "olt-1", affected: AFFECTED });
        const text = verifier.buildMessage(report, { oltKey: "olt-1" });

        expect(text).toContain("VERIFIKASI PASCA-PERBAIKAN");
        expect(text).toContain("MASIH MATI");
        expect(text).toContain("Sari");
        expect(text).toContain("-21.40 dBm");
        expect(text).toContain("Jangan tutup pekerjaan dulu");
    });

    test("semua pulih → pernyataan tegas, tanpa penahanan", async () => {
        const { verifier } = makeVerifier({
            getOltSnapshot: async () => ({
                status: "success",
                onus: AFFECTED.map((a) => onu(a.mac, "Online", "-21.00")),
            }),
        });

        const report = await verifier.buildReport({ oltKey: "olt-1", affected: AFFECTED });
        const text = verifier.buildMessage(report, { oltKey: "olt-1" });

        expect(text).toContain("Semua pelanggan terdampak terbukti online kembali");
        expect(text).not.toContain("Jangan tutup pekerjaan dulu");
    });
});

describe("reportAfterRecovery (hook dari LOS broadcaster)", () => {
    function scheduling(overrides = {}) {
        const timers = [];
        const { verifier, sent } = makeVerifier({
            setTimeoutFn: (fn) => {
                timers.push(fn);
                return { unref: () => {} };
            },
            ...overrides,
        });
        return { verifier, sent, timers };
    }

    test("default OFF — tak menjadwalkan apa pun tanpa config", () => {
        const { verifier, timers } = scheduling({ getConfig: () => ({ enabled: false, minAffected: 3 }) });
        const result = verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: AFFECTED, stillDown: [] });
        expect(result.scheduled).toBe(false);
        expect(timers).toHaveLength(0);
    });

    test("yang masih mati IKUT dilaporkan, tidak hanya yang pulih", async () => {
        const { verifier, sent, timers } = scheduling({
            getOltSnapshot: async () => ({
                status: "success",
                onus: [onu("aa:bb:cc:dd:01:01", "Online", "-21.40"), onu("aa:bb:cc:dd:02:02", "LOS", "-24.80")],
            }),
        });

        const result = verifier.reportAfterRecovery({
            oltKey: "olt-1",
            recovered: [AFFECTED[0]],
            stillDown: [AFFECTED[1], AFFECTED[2]],
        });
        expect(result).toMatchObject({ scheduled: true, affected: 3 });

        await timers[0]();
        expect(sent).toHaveLength(1);
        expect(sent[0].groupId).toBe("grup-alarm@g.us");
        expect(sent[0].text).toContain("Sari");
        expect(sent[0].text).toContain("Tono");
    });

    test("kejadian kecil di bawah ambang tidak memicu laporan", () => {
        const { verifier, timers } = scheduling();
        const result = verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[0]], stillDown: [] });
        expect(result).toMatchObject({ scheduled: false, reason: "below_min_affected" });
        expect(timers).toHaveLength(0);
    });
});
