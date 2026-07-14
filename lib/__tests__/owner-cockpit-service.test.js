/**
 * Header Doc
 * Purpose: Uji agregasi Owner Cockpit (diperkaya) — Pemasukan (net_paid+today+MRR+tunggakan+pelunasan+
 *          TREN vs bln lalu), ISP (overall+trafik), PSB (belum/terpasang/komisi), Tiket (aktif/lama/status),
 *          OLT (outage LOS), Pelanggan (aktif/isolir/baru/online + OFFLINE PRESISI silang PPPoE mati ×
 *          pelanggan aktif), Perlu Tindakan, gate ISP off, dan ISOLASI kegagalan per kartu.
 *          ISOLIR: dihitung dari PROFIL PPPoE LIVE (bukan users.status — kolom itu tak pernah ditulis
 *          'isolir'); fixture sengaja membuat status BERTENTANGAN dgn profil supaya regresi ke
 *          users.status langsung merah. MikroTik tak terbaca → isolir & offline NULL, bukan 0 palsu.
 * Caller: jest.
 * Deps: `../owner-cockpit-service` (deps di-inject penuh).
 * SideEffects: Tidak ada.
 */
"use strict";

const { buildCockpit } = require("../owner-cockpit-service");

const DEPS = {
    nowMs: () => Date.parse("2026-07-14T10:00:00Z"),
    getCurrentBillingPeriod: () => ({ periodMonth: 7, periodYear: 2026 }),
    // Bulan berjalan (7) net 1.5jt; bulan lalu (6) net 1jt → tren +50%.
    getPaymentReport: async (m) => (m === 7
        ? {
            summary: { net_paid: 1500000, payment_transactions: 12 },
            transactions: [
                { type: "payment", amount: 100000, created_at: "2026-07-14T08:00:00Z" },
                { type: "payment", amount: 50000, created_at: "2026-07-13T08:00:00Z" },
                { type: "reversal", amount: 20000, created_at: "2026-07-14T09:00:00Z" }
            ]
        }
        : { summary: { net_paid: 1000000, payment_transactions: 8 }, transactions: [] }),
    getEffectivePrice: (u) => u.price || 100000,
    getArrears: async () => ({ summary: { total_customers_in_arrears: 4, total_outstanding: 800000 } }),
    getMonitorConfig: () => ({ enabled: true }),
    buildStatusReport: async () => ({
        paths: [
            { key: "gmdp", label: "GMDP", status: "NORMAL", wan: { rx_mbps: 62.0, tx_mbps: 3.8 } },
            { key: "mni", label: "IH via MNI", status: "DEGRADASI", wan: { rx_mbps: 11.7, tx_mbps: 0.8 } }
        ]
    }),
    getScheduleSummary: async () => ({ menunggu: 3, ditugaskan: 2, terpasang_bulan_ini: 7, komisi_bulan_ini: 150000 }),
    getReports: () => [
        { status: "completed" },
        { status: "resolved" },
        { status: "dibatalkan" },
        { status: "process", teknisiId: "t1", createdAt: "2026-07-14T09:00:00Z" },
        { status: "reported", createdAt: "2026-07-10T09:00:00Z" },
        { status: "otw", teknisiId: "t2", createdAt: "2026-07-14T09:00:00Z" }
    ],
    getLosState: () => ({ activeIncidentCount: 1, recoveringCount: 0, pendingCount: 2 }),
    getPppStats: async () => ({ ok: true, data: { online: 120, offline: 8, total: 128, inactive_users_list: ["userA-off", "userB-off"] } }),
    // ISOLIR = profil PPPoE LIVE (peta dari MikroTik), BUKAN users.status.
    // Fixture SENGAJA dibuat BERTENTANGAN: `userB-off` ber-status "aktif" tapi profilnya ISOLIR.
    // Kalau kode kembali membaca users.status, isolir langsung jadi 0 dan test ini merah.
    // (Fixture LAMA mengarang status:"isolir" — nilai yang TAK PERNAH ditulis produksi — sehingga
    // test hijau untuk perilaku yang tak pernah terjadi. Itulah sebabnya bug ini lolos berbulan.)
    getProfileMap: async () => new Map([
        ["usera-off", "PAKET-10M"],
        ["useronline", "PAKET-20M"],
        ["userb-off", "ISOLIR"]
    ]),
    getIsolirProfile: () => "ISOLIR",
    getUsers: () => [
        { status: "aktif", paid: 1, created_at: "2026-07-05", price: 100000, pppoe_username: "userA-off" },
        { status: "aktif", paid: 0, created_at: "2026-06-01", price: 150000, pppoe_username: "userOnline" },
        { status: "aktif", paid: 0, created_at: "2026-01-01", price: 100000, pppoe_username: "userB-off" },
        { account_type: "infrastruktur", status: "aktif" }
    ],
    isInfrastructure: (u) => u.account_type === "infrastruktur",
    getPendingProofs: () => [{}, {}],
    getPackageChangeRequests: () => [{ status: "pending" }, { status: "approved" }],
    getPendingTopups: () => [{}],
    getRequests: () => [{ status: "pending" }, { status: "pending" }]
};

test("cockpit: metrik + TREN vs bln lalu + OFFLINE presisi benar", async () => {
    const c = await buildCockpit(DEPS);

    // mrr = SELURUH pelanggan non-infra (100rb+150rb+100rb), TERMASUK yang terisolir: mereka diisolir
    // justru karena BELUM BAYAR — tagihannya masih berjalan (konsisten dgn kartu tunggakan).
    expect(c.income).toMatchObject({
        ok: true, netPaid: 1500000, todayCount: 1, todayAmount: 100000,
        mrr: 350000, totalCustomers: 3, lunas: 1, collectionRate: 33,
        arrearsCustomers: 4, arrearsOutstanding: 800000,
        prevNetPaid: 1000000, trendPct: 50
    });
    expect(c.isp).toMatchObject({ ok: true, overall: "WARN", rxMbps: 73.7, txMbps: 4.6 });
    expect(c.psb).toMatchObject({ ok: true, belumKepasang: 5, terpasangBulanIni: 7, komisiBulanIni: 150000 });
    expect(c.tickets).toMatchObject({ ok: true, active: 3, belumDiambil: 1, lama: 1 });
    expect(c.olt).toMatchObject({ ok: true, activeOutage: 1 });

    // Pelanggan: isolir = 1 dari PROFIL LIVE (userB-off profil ISOLIR, walau users.status="aktif").
    // OFFLINE presisi = pelanggan aktif yg sesi PPPoE-nya mati (userA-off) TANPA isolir (userB-off ada
    // di inactive_users_list tapi memang SENGAJA dimatikan → tak dihitung gangguan).
    expect(c.customers).toMatchObject({ ok: true, total: 3, aktif: 2, isolir: 1, baru: 1, pppoeOnline: 120, offline: 1 });

    expect(c.actions).toMatchObject({ ok: true, buktiBayar: 2, gantiPaket: 1, topup: 1, bayarApproval: 2, total: 6 });
});

test("cockpit: ISP monitor OFF → overall OFF, trafik null", async () => {
    const c = await buildCockpit({ ...DEPS, getMonitorConfig: () => ({ enabled: false }) });
    expect(c.isp).toMatchObject({ ok: true, enabled: false, overall: "OFF", rxMbps: null });
});

test("cockpit: PPP gagal → online/offline null tapi isolir tetap terbaca (beda sumber)", async () => {
    const c = await buildCockpit({ ...DEPS, getPppStats: async () => { throw new Error("mikrotik timeout"); } });
    expect(c.customers).toMatchObject({ ok: true, pppoeOnline: null, offline: null, isolir: 1 });
});

test("isolir: users.status DIABAIKAN — status 'isolir' tapi profil live normal → TIDAK dihitung", async () => {
    const c = await buildCockpit({
        ...DEPS,
        getUsers: () => [
            { status: "isolir", paid: 0, created_at: "2026-01-01", price: 100000, pppoe_username: "userOnline" },
            { status: "isolir", paid: 0, created_at: "2026-01-01", price: 100000, pppoe_username: "userA-off" }
        ]
    });
    // Keduanya ber-status 'isolir' di DB, tapi profil PPPoE-nya PAKET-* → mereka JALAN, bukan terisolir.
    expect(c.customers).toMatchObject({ ok: true, total: 2, aktif: 2, isolir: 0 });
});

test("isolir: cocokkan profil TANPA peduli besar-kecil huruf", async () => {
    const c = await buildCockpit({
        ...DEPS,
        getIsolirProfile: () => "ISOLIR",
        getProfileMap: async () => new Map([["usera-off", "isolir"], ["useronline", "paket-20m"], ["userb-off", " Isolir "]])
    });
    expect(c.customers).toMatchObject({ ok: true, isolir: 2 });
});

test("isolir: MikroTik tak terbaca → isolir & offline NULL (jujur), bukan 0 palsu", async () => {
    const c = await buildCockpit({ ...DEPS, getProfileMap: async () => { throw new Error("RouterOS timeout"); } });
    // "Tak bisa melihat" ≠ "melihat aman". 0 akan membohongi owner ("tak ada yang terisolir"),
    // dan offline ikut null karena tanpa peta isolir angkanya tak presisi lagi (isolir ikut terhitung).
    expect(c.customers).toMatchObject({ ok: true, total: 3, isolir: null, offline: null, pppoeOnline: 120 });
});

test("isolir: config.isolir_profile kosong → isolir null (tak menebak)", async () => {
    const c = await buildCockpit({ ...DEPS, getIsolirProfile: () => "" });
    expect(c.customers).toMatchObject({ ok: true, isolir: null, offline: null });
});

test("cockpit: isolasi kegagalan (finance throw) → income ok:false, lain tetap ok", async () => {
    const c = await buildCockpit({ ...DEPS, getPaymentReport: async () => { throw new Error("db down"); } });
    expect(c.income.ok).toBe(false);
    expect(c.isp.ok).toBe(true);
    expect(c.customers.ok).toBe(true);
    expect(c.actions.ok).toBe(true);
});
