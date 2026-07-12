/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service broadcast admin mempertahankan validasi WA session, target selection, dan placeholder legacy.
 * Caller: Jest test runner.
 * Deps: `../admin-broadcast.service`.
 * MainFuncs: Memverifikasi accepted path, target kosong, dan placeholder formatting.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createAdminBroadcastService, formatBroadcastMessage } = require("../admin-broadcast.service");

describe("admin-broadcast.service", () => {
    test("queueBroadcast mengirim accepted dan mempertahankan placeholder user", async () => {
        const sendMessageToMany = jest.fn(() => Promise.resolve({ ok: true }));
        const service = createAdminBroadcastService({
            hasAuthenticatedSession: jest.fn(() => true),
            sendMessageToMany,
            normalizePhoneNumber: jest.fn((value) => value)
        });

        const result = await service.queueBroadcast({
            text: "Halo ${nama} paket ${paket}",
            sendToAll: false,
            selectedUsers: [{ id: 1, name: "Raf", subscription: "20Mbps", phone_number: "08123" }]
        });

        await new Promise((resolve) => setImmediate(resolve));

        expect(result.status).toBe(202);
        expect(sendMessageToMany).toHaveBeenCalledWith(["08123"], { text: "Halo Raf paket 20Mbps" });
    });

    test("queueBroadcast menolak saat whatsapp offline atau target kosong", async () => {
        const offlineService = createAdminBroadcastService({
            hasAuthenticatedSession: jest.fn(() => false)
        });
        await expect(offlineService.queueBroadcast({ text: "x", sendToAll: true, allUsers: [{}] }))
            .rejects.toMatchObject({ statusCode: 500 });

        const emptyTargetService = createAdminBroadcastService({
            hasAuthenticatedSession: jest.fn(() => true)
        });
        await expect(emptyTargetService.queueBroadcast({ text: "x", sendToAll: false, selectedUsers: [] }))
            .rejects.toMatchObject({ statusCode: 400 });
    });
});

describe("formatBroadcastMessage — placeholder pembayaran", () => {
    const user = { id: 42, name: "Budi", subscription: "PAKET-110K", phone_number: "0812", odp: "ODP-01" };

    beforeAll(() => {
        global.packages = [{ name: "PAKET-110K", price: 110000 }];
        global.config = {
            tanggal_batas_bayar: 10,
            site_url_bot: "https://portal.example.com",
            ipaymuSecret: "sekret-uji"
        };
    });
    afterAll(() => {
        delete global.packages;
        delete global.config;
    });

    test("mengganti ${harga}, ${jatuh_tempo}, ${periode} (dan nama/paket)", () => {
        const out = formatBroadcastMessage(
            "Tagihan ${nama_pelanggan} paket ${paket} sebesar ${harga}, jatuh tempo ${jatuh_tempo} periode ${periode}.",
            user
        );
        expect(out).toContain("Budi");
        expect(out).toContain("PAKET-110K");
        expect(out).toMatch(/110[.,]000/); // rupiah-format
        expect(out).not.toContain("${harga}");
        expect(out).not.toContain("${jatuh_tempo}");
        expect(out).not.toContain("${periode}");
    });

    test("mengganti ${link_bayar} dengan URL bayar bertoken", () => {
        const out = formatBroadcastMessage("Bayar di sini: ${link_bayar}", user);
        expect(out).toContain("https://portal.example.com/bayar/");
        expect(out).not.toContain("${link_bayar}");
    });

    test("tanpa placeholder pembayaran → tak menghitung apa pun (aman utk broadcast biasa)", () => {
        const out = formatBroadcastMessage("Info gangguan area ${odp}", user);
        expect(out).toBe("Info gangguan area ODP-01");
    });
});

describe("formatBroadcastMessage — placeholder rekening/identitas (selaras jalur cron)", () => {
    const user = { id: 7, name: "Sari", subscription: "PAKET-165K", phone_number: "0813" };

    beforeAll(() => {
        global.packages = [{ name: "PAKET-165K", price: 165000 }];
        global.config = {
            nama: "RAF NET",
            namabot: "RAF BOT",
            bankAccounts: [
                { bank: "BRI", number: "1234", name: "Rafli" },
                { bank: "DANA", number: "0852", name: "Rafli" }
            ]
        };
    });
    afterAll(() => {
        delete global.packages;
        delete global.config;
    });

    test("mengganti ${rekening} (daftar bank), ${nama_wifi}, ${nama_bot}", () => {
        const out = formatBroadcastMessage(
            "Dari *${nama_wifi}* (${nama_bot}). Transfer ke:\n${rekening}",
            user
        );
        expect(out).toContain("RAF NET");
        expect(out).toContain("RAF BOT");
        expect(out).toContain("BRI");
        expect(out).toContain("1234");
        expect(out).toContain("DANA");
        expect(out).not.toContain("${rekening}");
        expect(out).not.toContain("${nama_wifi}");
        expect(out).not.toContain("${nama_bot}");
    });

    test("tanpa ${rekening} → tak menyusun daftar rekening (aman broadcast biasa)", () => {
        const out = formatBroadcastMessage("Info gangguan ${nama_wifi}", user);
        expect(out).toBe("Info gangguan RAF NET");
    });
});

describe("formatBroadcastMessage — slot broadcast terarah (tenggang & selamat datang)", () => {
    const user = { id: 9, name: "Andi", subscription: "PAKET-200K", phone_number: "0814" };

    afterEach(() => {
        delete global.packages;
        delete global.config;
    });

    test("mengganti ${tanggal_isolir} dari config (bulan berjalan, default tanggal 16)", () => {
        global.config = { tanggal_isolir: 16 };
        const out = formatBroadcastMessage("Bayar sebelum ${tanggal_isolir} ya", user);
        // Format id-ID: "16 <bulan> <tahun>" — mis. "16 Juli 2026".
        expect(out).toMatch(/^Bayar sebelum 16 \w+ \d{4} ya$/);
        expect(out).not.toContain("${tanggal_isolir}");
    });

    test("${tanggal_isolir} default 16 saat config kosong", () => {
        global.config = {};
        const out = formatBroadcastMessage("${tanggal_isolir}", user);
        expect(out).toMatch(/^16 \w+ \d{4}$/);
    });

    test("mengganti ${display_profile} dari packages (kecepatan paket)", () => {
        global.packages = [{ name: "PAKET-200K", price: 200000, display_profile: "50 Mbps", profile: "prof-200k" }];
        const out = formatBroadcastMessage("Paket ${nama_paket} kecepatan ${display_profile}", user);
        expect(out).toBe("Paket PAKET-200K kecepatan 50 Mbps");
    });

    test("${display_profile} fallback: profile → subscription bila display_profile kosong", () => {
        global.packages = [{ name: "PAKET-200K", price: 200000, profile: "prof-only" }];
        expect(formatBroadcastMessage("${display_profile}", user)).toBe("prof-only");
        global.packages = [{ name: "PAKET-200K", price: 200000 }];
        expect(formatBroadcastMessage("${display_profile}", user)).toBe("PAKET-200K");
    });

    test("tanpa slot terarah → tak berubah (aman broadcast biasa)", () => {
        global.config = { tanggal_isolir: 16 };
        expect(formatBroadcastMessage("Halo ${nama}", user)).toBe("Halo Andi");
    });
});
