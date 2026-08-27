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

describe("#b272 — gangguan 1 pelanggan juga dibuktikan redamannya", () => {
    function scheduling(overrides = {}) {
        const timers = [];
        const snapshotCalls = { n: 0 };
        const { verifier, sent } = makeVerifier({
            // TANPA minAffected: yang diuji justru BAWAAN barunya (1).
            getConfig: () => ({ enabled: true, settleDelayMs: 1000, rxWarnDbm: -25, rxDegradeDb: 3 }),
            setTimeoutFn: (fn) => { timers.push(fn); return { unref: () => {} }; },
            getOltSnapshot: async () => {
                snapshotCalls.n += 1;
                return {
                    status: "success",
                    onus: [
                        onu("aa:bb:cc:dd:01:01", "Online", "-21.40"),
                        onu("aa:bb:cc:dd:02:02", "Online", "-19.10"),
                    ],
                };
            },
            ...overrides,
        });
        return { verifier, sent, timers, snapshotCalls };
    }

    test("!! SATU pelanggan pulih → tetap diverifikasi (dulu diam karena ambang 3)", async () => {
        // TERUKUR di produksi: 82-87% gangguan hanya 1-2 pelanggan. Ambang 3 membuat justru
        // kasus yang paling butuh bukti — teknisi baru menyambung drop cable satu orang —
        // tak pernah dibuktikan redamannya.
        const { verifier, sent, timers } = scheduling();
        const r = verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[0]], stillDown: [] });
        expect(r).toMatchObject({ scheduled: true, affected: 1 });
        await timers[0]();
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toContain("Budi");
        expect(sent[0].text).toMatch(/-21[.,]40/);
    });

    test("teks 1 pelanggan tidak berbunyi \"Semua pelanggan\"", async () => {
        const { verifier, sent, timers } = scheduling();
        verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[0]], stillDown: [] });
        await timers[0]();
        expect(sent[0].text).toContain("Pelanggan terbukti online kembali");
        expect(sent[0].text).not.toContain("Semua pelanggan terdampak");
    });

    test("!! pemulihan beruntun digabung → OLT hanya ditarik SEKALI", async () => {
        // Tanpa penggabungan, ambang 1 berarti tiap pemulihan menarik snapshot OLT penuh
        // sendiri-sendiri — pola serentak yang pernah menjatuhkan breaker global.
        const { verifier, sent, timers, snapshotCalls } = scheduling();
        const r1 = verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[0]], stillDown: [] });
        const r2 = verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[1]], stillDown: [] });
        expect(r1.scheduled).toBe(true);
        expect(r2).toMatchObject({ scheduled: true, coalesced: true, affected: 2 });
        expect(timers).toHaveLength(1);          // satu jadwal, bukan dua
        await timers[0]();
        expect(snapshotCalls.n).toBe(1);         // satu tarikan ke OLT
        expect(sent).toHaveLength(1);
        expect(sent[0].text).toContain("Budi");
        expect(sent[0].text).toContain("Sari");
    });

    test("pelanggan yang sama datang dua kali → tidak digandakan", async () => {
        const { verifier, sent, timers } = scheduling();
        verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[0]], stillDown: [] });
        const r2 = verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[0]], stillDown: [] });
        expect(r2.affected).toBe(1);
        await timers[0]();
        expect((sent[0].text.match(/Budi/g) || []).length).toBe(1);
    });

    test("OLT berbeda tidak saling menggabung", () => {
        const { verifier, timers } = scheduling();
        verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[0]], stillDown: [] });
        verifier.reportAfterRecovery({ oltKey: "olt-2", recovered: [AFFECTED[1]], stillDown: [] });
        expect(timers).toHaveLength(2);
    });

    test("!! jadwal dibuang setelah dipakai — pemulihan berikutnya dapat jadwal BARU", async () => {
        const { verifier, timers } = scheduling();
        verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[0]], stillDown: [] });
        await timers[0]();
        const r = verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[1]], stillDown: [] });
        expect(r.coalesced).toBeUndefined();
        expect(timers).toHaveLength(2);
    });

    test("ambang masih dihormati bila pemilik menaikkannya", () => {
        const { verifier, timers } = scheduling({
            getConfig: () => ({ enabled: true, minAffected: 3, settleDelayMs: 1000, rxWarnDbm: -25, rxDegradeDb: 3 }),
        });
        const r = verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: [AFFECTED[0]], stillDown: [] });
        expect(r).toMatchObject({ scheduled: false, reason: "below_min_affected" });
        expect(timers).toHaveLength(0);
    });
});

describe("#b273 — OLT tak terjangkau != pelanggan bermasalah", () => {
    function jalankan(snapshot, affected) {
        const timers = [];
        const { verifier, sent } = makeVerifier({
            getConfig: () => ({ enabled: true, settleDelayMs: 1, rxWarnDbm: -25, rxDegradeDb: 3 }),
            getOltSnapshot: async () => snapshot,
            setTimeoutFn: (fn) => { timers.push(fn); return { unref: () => {} }; },
        });
        verifier.reportAfterRecovery({ oltKey: "olt-1", recovered: affected, stillDown: [] });
        return { timers, sent };
    }

    test("!! OLT tak menjawab → sebut OLT-nya, JANGAN pakai ⛔ seolah pelanggan masih mati", async () => {
        // Nyata di Dander: 192.168.11.2 tak terjangkau berhari-hari (ping/80/SNMP semua gagal),
        // 47 ONU di baliknya. Tanpa ini tiap pemulihan menghasilkan "⛔ belum terbukti normal"
        // — teknisi akan belajar mengabaikan alarmnya.
        const { timers, sent } = jalankan(
            { status: "success", onus: [], failedOlts: [{ oltName: "OLT Server", oltHost: "192.168.11.2" }] },
            [AFFECTED[0]]
        );
        await timers[0]();
        expect(sent[0].text).toContain("OLT Server");
        expect(sent[0].text).toContain("tidak menjawab saat diukur");
        expect(sent[0].text).toContain("bukan berarti mereka mati");
        expect(sent[0].text).not.toContain("⛔");
    });

    test("OLT sehat tapi ONU memang tak ada di daftar → ⛔ TETAP muncul", async () => {
        const { timers, sent } = jalankan(
            { status: "success", onus: [], failedOlts: [] },
            [AFFECTED[0]]
        );
        await timers[0]();
        expect(sent[0].text).toContain("⛔");
        expect(sent[0].text).not.toContain("tidak menjawab saat diukur");
    });

    test("ada yang benar-benar MASIH MATI → ⛔ menang walau OLT lain tak terjangkau", async () => {
        const { timers, sent } = jalankan(
            {
                status: "success",
                onus: [onu("aa:bb:cc:dd:01:01", "LOS", "-24.80")],
                failedOlts: [{ oltName: "OLT Server", oltHost: "192.168.11.2" }],
            },
            [AFFECTED[0]]
        );
        await timers[0]();
        expect(sent[0].text).toContain("⛔");
        expect(sent[0].text).toContain("OLT Server");   // tetap disebut, tapi tak menutupi vonis mati
    });
});
