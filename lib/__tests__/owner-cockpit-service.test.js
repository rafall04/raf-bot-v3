/**
 * Header Doc
 * Purpose: Uji agregasi Owner Cockpit — semua kartu terisi (income today/bulan, ISP overall,
 *          PSB belum-kepasang, tiket aktif/belum-diambil, OLT outage), gate ISP monitor off,
 *          dan ISOLASI kegagalan (satu sumber throw → kartu itu ok:false, kartu lain tetap ok).
 * Caller: jest.
 * Deps: `../owner-cockpit-service` (deps di-inject penuh).
 * SideEffects: Tidak ada.
 */
"use strict";

const { buildCockpit } = require("../owner-cockpit-service");

const DEPS = {
    nowMs: () => Date.parse("2026-07-14T10:00:00Z"),
    getPaymentReport: async () => ({
        summary: { net_paid: 1500000, payment_transactions: 12 },
        transactions: [
            { type: "payment", amount: 100000, created_at: "2026-07-14T08:00:00Z" },
            { type: "payment", amount: 50000, created_at: "2026-07-13T08:00:00Z" },
            { type: "reversal", amount: 20000, created_at: "2026-07-14T09:00:00Z" }
        ]
    }),
    getMonitorConfig: () => ({ enabled: true }),
    buildStatusReport: async () => ({
        paths: [
            { key: "gmdp", label: "GMDP", status: "NORMAL" },
            { key: "mni", label: "IH via MNI", status: "DEGRADASI" }
        ]
    }),
    getScheduleSummary: async () => ({ menunggu: 3, ditugaskan: 2, terpasangBulanIni: 7 }),
    getReports: () => [
        { status: "completed" },
        { status: "process", teknisiId: "t1" },
        { status: "reported" },
        { status: "otw", teknisiId: "t2" }
    ],
    getLosState: () => ({ activeIncidentCount: 1, recoveringCount: 0, pendingCount: 2 })
};

test("cockpit: agregasi semua kartu benar", async () => {
    const c = await buildCockpit(DEPS);
    expect(c.income).toMatchObject({ ok: true, netPaid: 1500000, paymentTransactions: 12, todayCount: 1, todayAmount: 100000 });
    expect(c.isp).toMatchObject({ ok: true, enabled: true, overall: "WARN" });
    expect(c.isp.paths).toHaveLength(2);
    expect(c.psb).toMatchObject({ ok: true, belumKepasang: 5, terpasangBulanIni: 7 });
    // completed di-skip; reported=belum diambil; process/otw sudah ada teknisi
    expect(c.tickets).toMatchObject({ ok: true, active: 3, belumDiambil: 1 });
    expect(c.olt).toMatchObject({ ok: true, activeOutage: 1, recovering: 0 });
    expect(c.generatedAt).toMatch(/^2026-07-14/);
});

test("cockpit: ISP monitor OFF → overall OFF, paths kosong", async () => {
    const c = await buildCockpit({ ...DEPS, getMonitorConfig: () => ({ enabled: false }) });
    expect(c.isp).toMatchObject({ ok: true, enabled: false, overall: "OFF" });
    expect(c.isp.paths).toEqual([]);
});

test("cockpit: kegagalan satu sumber TERISOLASI (finance throw) → income ok:false, lain tetap ok", async () => {
    const c = await buildCockpit({ ...DEPS, getPaymentReport: async () => { throw new Error("db down"); } });
    expect(c.income.ok).toBe(false);
    expect(c.isp.ok).toBe(true);
    expect(c.psb.ok).toBe(true);
    expect(c.tickets.ok).toBe(true);
    expect(c.olt.ok).toBe(true);
});
