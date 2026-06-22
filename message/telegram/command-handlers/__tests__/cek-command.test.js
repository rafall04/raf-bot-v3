/**
 * Test /cek (diagnosa lengkap one-shot) — orkestrasi + vonis untuk skenario sehat, LOS,
 * gangguan area, dan putus tunggal. Service diinjeksi fake (tanpa jaringan).
 */
"use strict";

const { createCekCommand } = require("../cek-command");
const { findOneCustomer, findById } = require("../../customer-lookup");

// 10 pelanggan ber-PPPoE (budi=id1) untuk menguji heuristik gangguan area vs putus tunggal.
const users = [{ id: 1, name: "Budi Santoso", pppoe_username: "budi@isp", device_id: "dev-1" }];
for (let i = 2; i <= 10; i++) users.push({ id: i, name: `User ${i}`, pppoe_username: `u${i}@isp` });

const ONLINE_ALL = { ok: true, data: users.map((u) => ({ name: u.pppoe_username })) };
const ONLINE_EXCEPT_BUDI = { ok: true, data: users.filter((u) => u.id !== 1).map((u) => ({ name: u.pppoe_username })) };
const ONLINE_NONE = { ok: true, data: [] };

function cekDeps(over = {}) {
    return {
        getUsers: () => users,
        getConfig: () => ({ rx_tolerance: -25, outage_area_threshold: 5 }),
        findOneCustomer,
        findById,
        getActivePPPoEUsers: async () => ONLINE_ALL,
        getCustomerRedaman: async () => ({ redaman: "-20" }),
        getOltSnapshot: async () => ({ status: "success", onus: [] }),
        resolveByCustomer: () => ({ identifiable: true, matched: true, status: "Online", rxPower: "-22", isLos: false, isDyingGasp: false, ponName: "1/1/1" }),
        ...over,
    };
}

function makeCtx(args) {
    const replies = [];
    const opts = [];
    return {
        ctx: { args, reply: async (t, o) => { replies.push(t); opts.push(o); return { success: true }; } },
        last: () => replies[replies.length - 1],
        lastOpts: () => opts[opts.length - 1],
    };
}

test("SEHAT: online + redaman baik + OLT online → 🟢 Sehat + rincian + tombol", async () => {
    const handle = createCekCommand(cekDeps());
    const { ctx, last, lastOpts } = makeCtx("budi@isp");
    await handle(ctx);
    const out = last();
    expect(out).toContain("DIAGNOSA");
    expect(out).toContain("🟢");
    expect(out).toContain("Sehat");
    expect(out).toContain("🔌 Koneksi: 🟢 Online");
    expect(out).toContain("📶 Redaman modem");
    expect(out).toContain("🛰️ OLT:");
    expect(out).toContain("diperbarui");
    expect(lastOpts().replyMarkup.inline_keyboard).toBeTruthy();
});

test("LOS: OLT lapor LOS → 🔴 Fiber bermasalah (LOS), walau PPPoE online", async () => {
    const handle = createCekCommand(
        cekDeps({ resolveByCustomer: () => ({ identifiable: true, matched: true, status: "LOS", rxPower: "N/A", isLos: true, isDyingGasp: false }) })
    );
    const { ctx, last } = makeCtx("budi@isp");
    await handle(ctx);
    expect(last()).toContain("🔴");
    expect(last()).toContain("LOS");
});

test("GANGGUAN AREA: semua offline → 🔴 Gangguan area + jumlah", async () => {
    const handle = createCekCommand(
        cekDeps({
            getActivePPPoEUsers: async () => ONLINE_NONE,
            resolveByCustomer: () => ({ identifiable: true, matched: false, status: "Offline", rxPower: "N/A", isLos: false, isDyingGasp: false }),
        })
    );
    const { ctx, last } = makeCtx("budi@isp");
    await handle(ctx);
    expect(last()).toContain("Gangguan area");
    expect(last()).toContain("🔴 Terputus (gangguan area ~10)");
});

test("PUTUS TUNGGAL: hanya budi offline → 🔴 hanya pelanggan ini", async () => {
    const handle = createCekCommand(
        cekDeps({
            getActivePPPoEUsers: async () => ONLINE_EXCEPT_BUDI,
            resolveByCustomer: () => ({ identifiable: true, matched: false, status: "Offline", rxPower: "N/A", isLos: false, isDyingGasp: false }),
        })
    );
    const { ctx, last } = makeCtx("budi@isp");
    await handle(ctx);
    expect(last()).toContain("hanya pelanggan ini");
});

test("MikroTik tak terjangkau → koneksi ⚪, tapi OLT LOS tetap menang", async () => {
    const handle = createCekCommand(
        cekDeps({
            getActivePPPoEUsers: async () => ({ ok: false, message: "down" }),
            resolveByCustomer: () => ({ identifiable: true, matched: true, status: "LOS", rxPower: "N/A", isLos: true, isDyingGasp: false }),
        })
    );
    const { ctx, last } = makeCtx("budi@isp");
    await handle(ctx);
    expect(last()).toContain("LOS");
    expect(last()).toContain("🔌 Koneksi: ⚪");
});
