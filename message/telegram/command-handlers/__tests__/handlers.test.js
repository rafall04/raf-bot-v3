/**
 * Test command-handlers Telegram teknisi — orkestrasi tiap perintah dengan service
 * diinjeksi fake (tanpa GenieACS/MikroTik/SNMP asli). Memverifikasi isi balasan untuk
 * /pelanggan, /koneksi, /modem, /olt, /redaman (dua arah), serta jalur resolve
 * (arg kosong / tak ditemukan / ambigu) lewat resolve-helper + customer-lookup nyata.
 */
"use strict";

const { buildCommandMap } = require("../index");

const users = [
    {
        id: 1,
        name: "Budi Santoso",
        pppoe_username: "budi@isp",
        phone_number: "081234567890",
        address: "Jl. Mawar 1",
        device_id: "dev-1",
        olt_serial: "ZTEGC0000001",
    },
    { id: 2, name: "Budiman", pppoe_username: "budiman@isp", phone_number: "081300000002", device_id: "dev-2" },
    { id: 3, name: "Tanpa Modem", pppoe_username: "nodev@isp", phone_number: "081300000003" },
];

function makeCtx(args, extra = {}) {
    const replies = [];
    const opts = [];
    const ctx = {
        args,
        reply: async (text, o) => {
            replies.push(text);
            opts.push(o);
            return { success: true };
        },
        ...extra,
    };
    return {
        ctx,
        replies,
        last: () => replies[replies.length - 1],
        lastOpts: () => opts[opts.length - 1],
        all: () => replies.join("\n"),
    };
}

function baseDeps(overrides = {}) {
    return {
        getUsers: () => users,
        getConfig: () => ({ rx_tolerance: -25 }),
        // findOneCustomer dibiarkan default (implementasi nyata) untuk uji integrasi lookup.
        getCustomerRedaman: async () => ({ redaman: "-27" }),
        getDeviceCoreInfo: async () => ({ modemType: "HG8145V5", serialNumber: "SN123", softwareVersion: "V5R0", temperature: 46 }),
        getSSIDInfo: async () => ({ uptime: "3d 2h", ssid: [{ associatedDevices: [1, 2] }, { associatedDevices: [3] }] }),
        getActivePPPoEUsers: async () => ({ ok: true, data: [{ name: "budi@isp", address: "10.1.1.2", uptime: "2h10m", caller_id: "AA:BB:CC:DD:EE:01" }] }),
        resolveByCustomer: () => ({
            identifiable: true,
            matched: true,
            status: "Online",
            rxPower: "-22.50",
            oltName: "OLT-ZTE",
            oltHost: "10.0.0.1",
            ponName: "1/1/1",
            slotId: 1,
            onuId: 5,
            serial: "ZTEGC0000001",
            isLos: false,
            isDyingGasp: false,
        }),
        getOltSnapshot: async () => ({ status: "success", onus: [] }),
        ...overrides,
    };
}

describe("/pelanggan", () => {
    test("tampilkan kartu data pelanggan", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("budi@isp");
        await map["/pelanggan"](ctx);
        expect(last()).toContain("DATA PELANGGAN");
        expect(last()).toContain("Budi Santoso");
        expect(last()).toContain("budi@isp");
    });
});

describe("resolve-helper (via /pelanggan)", () => {
    test("arg kosong → minta kata kunci", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("");
        await map["/pelanggan"](ctx);
        expect(last()).toContain("Sertakan kata kunci");
    });

    test("tak ditemukan", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("zzz-nope");
        await map["/pelanggan"](ctx);
        expect(last()).toContain("tidak ditemukan");
    });

    test("ambigu → daftar kandidat", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("budi"); // cocok Budi Santoso & Budiman
        await map["/pelanggan"](ctx);
        expect(last()).toContain("Ketuk tombol");
        expect(last()).toContain("budi@isp");
        expect(last()).toContain("budiman@isp");
    });
});

describe("/koneksi", () => {
    test("online → tampil IP & uptime", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("budi@isp");
        await map["/koneksi"](ctx);
        expect(last()).toContain("ONLINE");
        expect(last()).toContain("10.1.1.2");
    });

    test("offline → TERPUTUS", async () => {
        const map = buildCommandMap(baseDeps({ getActivePPPoEUsers: async () => ({ ok: true, data: [] }) }));
        const { ctx, last } = makeCtx("budi@isp");
        await map["/koneksi"](ctx);
        expect(last()).toContain("TERPUTUS");
    });
});

describe("/modem", () => {
    test("tampil model/serial + jumlah perangkat (2+1=3)", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("budi@isp");
        await map["/modem"](ctx);
        expect(last()).toContain("HG8145V5");
        expect(last()).toContain("SN123");
        expect(last()).toContain("Perangkat terhubung: <b>3</b>");
    });

    test("pelanggan tanpa device ACS → pesan jelas", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("nodev@isp");
        await map["/modem"](ctx);
        expect(last()).toContain("tidak ada device ACS");
    });
});

describe("/olt", () => {
    test("teridentifikasi → status + RX OLT", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("budi@isp");
        await map["/olt"](ctx);
        expect(last()).toContain("STATUS OLT");
        expect(last()).toContain("-22.50");
        expect(last()).toContain("OLT-ZTE");
    });

    test("tak teridentifikasi → pesan tak dapat dipetakan", async () => {
        const map = buildCommandMap(baseDeps({ resolveByCustomer: () => ({ identifiable: false }) }));
        const { ctx, last } = makeCtx("budi@isp");
        await map["/olt"](ctx);
        expect(last()).toContain("Tidak dapat dipetakan");
    });
});

describe("/redaman (dua arah)", () => {
    test("modem BURUK (-27 vs tol -25) + OLT online → laporan gabungan + kesimpulan BURUK", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("budi@isp");
        await map["/redaman"](ctx);
        const out = last();
        expect(out).toContain("REDAMAN");
        expect(out).toContain("Sisi Modem");
        expect(out).toContain("-27");
        expect(out).toContain("BURUK");
        expect(out).toContain("Sisi OLT");
        expect(out).toContain("-22.50");
    });

    test("OLT LOS → kesimpulan LOS, walau modem tak terjangkau", async () => {
        const map = buildCommandMap(
            baseDeps({
                getCustomerRedaman: async () => {
                    throw new Error("genieacs down");
                },
                resolveByCustomer: () => ({ identifiable: true, matched: false, status: "LOS", isLos: true, isDyingGasp: false, rxPower: "N/A" }),
            })
        );
        const { ctx, last } = makeCtx("budi@isp");
        await map["/redaman"](ctx);
        const out = last();
        expect(out).toContain("tidak terjangkau"); // sisi modem gagal
        expect(out).toContain("LOS");
        expect(out).toContain("fiber putus");
    });

    test("pelanggan tanpa device ACS → sisi modem 'tidak ada device ACS'", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("nodev@isp");
        await map["/redaman"](ctx);
        expect(last()).toContain("Tidak ada device ACS");
    });
});

describe("/help", () => {
    test("daftar perintah", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("");
        await map["/help"](ctx);
        expect(last()).toContain("/redaman");
        expect(last()).toContain("/koneksi");
        expect(last()).toContain("Bot Teknisi");
    });
});

describe("tombol aksi & callback (resolvedUserId)", () => {
    test("hasil /pelanggan menyertakan inline keyboard aksi (do:redaman:<id>)", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, lastOpts } = makeCtx("budi@isp");
        await map["/pelanggan"](ctx);
        const kb = lastOpts() && lastOpts().replyMarkup;
        expect(kb).toBeTruthy();
        const flat = JSON.stringify(kb.inline_keyboard);
        expect(flat).toContain("do:cek:1");
        expect(flat).toContain("do:redaman:1");
        expect(flat).toContain("do:olt:1");
    });

    test("ambigu → list kandidat jadi tombol yang mempertahankan command", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, lastOpts } = makeCtx("budi"); // 2 kandidat
        await map["/redaman"](ctx);
        const kb = lastOpts() && lastOpts().replyMarkup;
        expect(kb).toBeTruthy();
        const flat = JSON.stringify(kb.inline_keyboard);
        expect(flat).toContain("do:redaman:1");
        expect(flat).toContain("do:redaman:2");
    });

    test("resolvedUserId (dari tombol) → handler jalan tanpa pencarian teks", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("", { resolvedUserId: "1" });
        await map["/redaman"](ctx);
        expect(last()).toContain("REDAMAN");
        expect(last()).toContain("Budi Santoso");
    });

    test("resolvedUserId tak ditemukan → pesan jelas", async () => {
        const map = buildCommandMap(baseDeps());
        const { ctx, last } = makeCtx("", { resolvedUserId: "999" });
        await map["/olt"](ctx);
        expect(last()).toContain("tidak ditemukan");
    });
});
