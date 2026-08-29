/**
 * Header Doc
 * Purpose : GUARD cron ISOLIR PER-PAKET (#b305) — pemilihan kandidat per hari isolir_day, dedup via
 *           profil LIVE, FAIL-SAFE saat gagal baca profil, gerbang fail-closed, prioritas akhir_bulan,
 *           dan penjaga struktural (isolir standar mengecualikan kohort).
 * Caller  : jest
 * Deps    : lib/cron/jobs/isolir-paket + lib/account-classification (REAL); MikroTik/IsolirService/WA di-mock.
 * MainFuncs: -
 * SideEffects: set/reset global.config/cronConfig/users/packages.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const AKAR = path.join(__dirname, "..", "..", "..", "..");

// --- MOCK dependency berat (tak boleh sentuh MikroTik/WA nyata) ---
let mockProfilLive = "NORMAL";       // profil PPPoE live yang dikembalikan mock
let mockFetchError = null;           // set string utk mensimulasikan gagal baca profil
const mockExecuteCalls = [];
jest.mock("../../../mikrotik", () => ({
    getPPPoEUserProfile: jest.fn(async () => { if (mockFetchError) throw new Error(mockFetchError); return { ok: true, data: { profile: mockProfilLive } }; }),
    assertMikrotikResult: jest.fn((res) => res),
}));
jest.mock("../../../services/isolir-service", () => ({
    executeProfileAction: jest.fn(async (user, opts) => { mockExecuteCalls.push({ user: user.id, opts }); return { ok: true }; }),
}));
jest.mock("../../wa-send-queue", () => ({
    sendQueueWithRetry: jest.fn(async ({ items }) => ({ sent: items.length, failed: [] })),
    buildJid: jest.fn((raw) => (raw ? String(raw).trim() + "@s.whatsapp.net" : null)),
    resolveRetryConfig: jest.fn(() => ({ maxAttempts: 1, waWaitMs: 0, pollMs: 0 })),
}));
jest.mock("../../../templating", () => ({ renderTemplate: jest.fn(() => "Pesan isolir uji") }));
jest.mock("../../../bill-pay-token", () => ({ buildBillPayUrl: jest.fn(() => "https://bayar/uji") }));
jest.mock("../../../whatsapp-gateway", () => ({ isReady: jest.fn(() => true), getConnectionState: jest.fn(() => "open") }));
jest.mock("../../shared", () => ({
    delay: jest.fn(async () => {}),
    isValidCron: jest.fn((s) => typeof s === "string" && s.trim().split(/\s+/).length === 5 && !s.startsWith("#")),
    loadCronConfig: jest.fn(() => global.cronConfig || {}),
    safeSendMessage: jest.fn(async () => ({ ok: true })),
}));

const { runIsolirPaketCycle, isCohortMember } = require("../isolir-paket");
const ac = require("../../../account-classification");

const cfgAsli = global.config, cronAsli = global.cronConfig, usersAsli = global.users, pkgAsli = global.packages;
afterEach(() => {
    global.config = cfgAsli; global.cronConfig = cronAsli; global.users = usersAsli; global.packages = pkgAsli;
    mockProfilLive = "NORMAL"; mockFetchError = null; mockExecuteCalls.length = 0;
    const mt = require("../../../mikrotik"); mt.getPPPoEUserProfile.mockClear();
});

function setup({ enabled = true, cron = true, isolirDay = 20, paid = 0, billing_cycle = "awal_bulan", account_type = "pelanggan", whitelist = false } = {}) {
    global.config = { isolirPerPaket: { enabled }, isolir_profile: "ISOLIR", sync_to_mikrotik: true, isolirFeatureEnabled: true };
    global.cronConfig = { status_isolir_paket: cron };
    global.packages = [{ name: "PAKET-X", price: 100000, profile: "20M", isolir_day: isolirDay, whitelist }];
    global.users = [{ id: 1, name: "Uji", subscription: "PAKET-X", pppoe_username: "uji@realm", phone_number: "628111", paid, billing_cycle, account_type }];
}

describe("#b305 classifier — getPackageIsolirDay & isPerPackageIsolirActive", () => {
    test("getPackageIsolirDay: valid 1-28, selain itu null", () => {
        global.packages = [{ name: "A", isolir_day: 20 }, { name: "B", isolir_day: 0 }, { name: "C", isolir_day: 31 }, { name: "D" }];
        expect(ac.getPackageIsolirDay({ subscription: "A" })).toBe(20);
        expect(ac.getPackageIsolirDay({ subscription: "B" })).toBeNull();
        expect(ac.getPackageIsolirDay({ subscription: "C" })).toBeNull();
        expect(ac.getPackageIsolirDay({ subscription: "D" })).toBeNull();
        expect(ac.getPackageIsolirDay({ subscription: "X" })).toBeNull();
    });

    test("isPerPackageIsolirActive: butuh fitur ON + cron ON (fail-closed) + paket punya isolir_day", () => {
        setup({ enabled: true, cron: true, isolirDay: 20 });
        const u = global.users[0];
        expect(ac.isPerPackageIsolirActive(u)).toBe(true);
        // cron OFF → fail-closed
        global.cronConfig = { status_isolir_paket: false };
        expect(ac.isPerPackageIsolirActive(u)).toBe(false);
        // fitur OFF
        global.cronConfig = { status_isolir_paket: true };
        global.config.isolirPerPaket.enabled = false;
        expect(ac.isPerPackageIsolirActive(u)).toBe(false);
    });

    test("prioritas: pelanggan akhir_bulan TIDAK diklaim isolir-paket (akhir_bulan menang)", () => {
        setup({ enabled: true, cron: true, isolirDay: 20, billing_cycle: "akhir_bulan" });
        expect(ac.isPerPackageIsolirActive(global.users[0])).toBe(false);
    });

    test("infra dikecualikan", () => {
        setup({ account_type: "infrastruktur" });
        expect(ac.isPerPackageIsolirActive(global.users[0])).toBe(false);
    });

    test("paket tanpa isolir_day → tak aktif", () => {
        setup({ isolirDay: null });
        expect(ac.isPerPackageIsolirActive(global.users[0])).toBe(false);
    });
});

describe("#b305 job — runIsolirPaketCycle", () => {
    test("fitur OFF → skipped feature-off", async () => {
        setup({ enabled: false });
        expect(await runIsolirPaketCycle(new Date(2026, 7, 25))).toEqual({ skipped: "feature-off" });
        expect(mockExecuteCalls.length).toBe(0);
    });

    test("hari < isolir_day → tak ada yang diisolir", async () => {
        setup({ isolirDay: 20 });
        const r = await runIsolirPaketCycle(new Date(2026, 7, 15)); // hari 15 < 20
        expect(r.isolated).toBe(0);
        expect(mockExecuteCalls.length).toBe(0);
    });

    test("hari >= isolir_day + profil NORMAL → DIISOLIR + notif", async () => {
        setup({ isolirDay: 20 });
        mockProfilLive = "NORMAL";
        const r = await runIsolirPaketCycle(new Date(2026, 7, 20)); // hari 20 == isolir_day
        expect(r.isolated).toBe(1);
        expect(mockExecuteCalls.length).toBe(1);
        expect(mockExecuteCalls[0].opts.targetProfile).toBe("ISOLIR");
        expect(r.notified).toBe(1);
    });

    test("DEDUP: profil sudah ISOLIR → tak isolir ulang (jaga grace + tak reboot berulang)", async () => {
        setup({ isolirDay: 20 });
        mockProfilLive = "ISOLIR";
        const r = await runIsolirPaketCycle(new Date(2026, 7, 25));
        expect(r.isolated).toBe(0);
        expect(r.alreadyIsolir).toBe(1);
        expect(mockExecuteCalls.length).toBe(0);
    });

    test("FAIL-SAFE: gagal baca profil → JANGAN isolir buta (skip)", async () => {
        setup({ isolirDay: 20 });
        mockFetchError = "MikroTik unreachable";
        const r = await runIsolirPaketCycle(new Date(2026, 7, 25));
        expect(r.isolated).toBe(0);
        expect(r.fetchFail).toBe(1);
        expect(mockExecuteCalls.length).toBe(0);
    });

    test("pelanggan yang sudah BAYAR tak diisolir", async () => {
        setup({ isolirDay: 20, paid: 1 });
        const r = await runIsolirPaketCycle(new Date(2026, 7, 25));
        expect(r.isolated).toBe(0);
        expect(mockExecuteCalls.length).toBe(0);
    });

    test("paket whitelist tak diisolir", async () => {
        setup({ isolirDay: 20, whitelist: true });
        const r = await runIsolirPaketCycle(new Date(2026, 7, 25));
        expect(r.isolated).toBe(0);
        expect(mockExecuteCalls.length).toBe(0);
    });

    test("isolir_profile tak diset → batal aman", async () => {
        setup({ isolirDay: 20 });
        delete global.config.isolir_profile;
        const r = await runIsolirPaketCycle(new Date(2026, 7, 25));
        expect(r.skipped).toBe("no-isolir-profile");
        expect(mockExecuteCalls.length).toBe(0);
    });

    test("isCohortMember konsisten dengan gerbang", () => {
        setup({ isolirDay: 20 });
        expect(isCohortMember(global.users[0])).toBe(true);
    });
});

describe("#b305 penjaga struktural", () => {
    test("isolir.js standar mengecualikan kohort per-paket", () => {
        const s = fs.readFileSync(path.join(AKAR, "lib/cron/jobs/isolir.js"), "utf8");
        expect(s).toMatch(/isPerPackageIsolirActive\s*\(\s*user\s*\)/);
    });
    test("isolir-paket.js punya gerbang MISCONFIG (enabled tapi tak terjadwal → teriak)", () => {
        const s = fs.readFileSync(path.join(AKAR, "lib/cron/jobs/isolir-paket.js"), "utf8");
        expect(s).toMatch(/CRON_ISOLIR_PAKET_MISCONFIG/);
    });
    test("route packages memvalidasi isolir_day (parseIsolirDay 1-28)", () => {
        const s = fs.readFileSync(path.join(AKAR, "routes/packages.js"), "utf8");
        expect(s).toMatch(/parseIsolirDay/);
        expect(s).toMatch(/n >= 1 && n <= 28/);
    });
});
