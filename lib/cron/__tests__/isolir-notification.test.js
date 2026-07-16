/**
 * Header Doc
 * Purpose: Guardrail notifikasi isolir yang di-harden — (P0) RETRY saat WA putus (kasus Achwan
 *          Fatoni 2026-07-16: WA drop tepat di gilirannya → pesan hilang tapi log bilang "sent"),
 *          (P0) TIDAK BISU (tiap skip tercatat + alasan + ringkasan), (P1) LEWATI paket whitelist
 *          (kasus Mutmainah: pelanggan GRATIS nyangkut di profil ISOLIR ikut di-spam notif).
 * Caller: Jest.
 * Deps: `../jobs/isolir-notification` (runIsolirNotificationCycle, deps di-inject).
 * SideEffects: Tidak ada (semua dependency di-mock).
 */
"use strict";

const { runIsolirNotificationCycle } = require("../jobs/isolir-notification");

const PACKAGES = [
    { name: "PAKET-VOUCHER", profile: "PPP-Monitor", whitelist: true },
    { name: "PAKET-125K", profile: "22Mbps", whitelist: false },
];
const PROF = { "PAKET-VOUCHER": "PPP-Monitor", "PAKET-125K": "22Mbps" };

function harness({ users, liveProfiles, isReady, sendImpl }) {
    const sent = [];
    const logs = [];
    const push = (...a) => logs.push(a.map(String).join(" "));
    const deps = {
        getUsers: () => users,
        getPackages: () => PACKAGES,
        getConfig: () => ({
            isolir_profile: "ISOLIR",
            whatsapp_message_delay: 0,
            waSendRetry: { maxAttempts: 3, waitMs: 40, pollMs: 5 },
        }),
        getPPPoEUserProfile: async (p) => ({ data: { profile: liveProfiles[p] } }),
        assertMikrotikResult: (r) => r,
        renderTemplate: () => "PESAN ISOLIR",
        buildBillPayUrl: () => "http://bayar",
        isReady: isReady || (() => true),
        safeSendMessage: sendImpl || (async (jid) => { sent.push(jid); return { success: true }; }),
        delay: () => new Promise((r) => setTimeout(r, 1)),
        isInfrastructure: (u) => u.account_type === "infrastruktur",
        getProfileBySubscription: (s) => PROF[s] || null,
        logger: { log: push, warn: push, error: push },
    };
    return { deps, sent, logs };
}

const CUST = (over = {}) => ({ name: "X", subscription: "PAKET-125K", pppoe_username: "x@r", phone_number: "62811111111", account_type: "pelanggan", ...over });

describe("isolir-notification (hardened)", () => {
    test("P1: pelanggan paket WHITELIST nyangkut di ISOLIR → TIDAK di-notif (kasus Mutmainah)", async () => {
        const users = [CUST({ name: "Mutmainah", subscription: "PAKET-VOUCHER", pppoe_username: "mutmainah@r" })];
        const { deps, sent, logs } = harness({ users, liveProfiles: { "mutmainah@r": "ISOLIR" } });
        const res = await runIsolirNotificationCycle(deps);
        expect(sent).toHaveLength(0);
        expect(res.sent).toBe(0);
        expect(res.skipped).toBe(1);
        expect(logs.join("\n")).toMatch(/Mutmainah.*whitelist/i);
    });

    test("P0: WA putus saat gilirannya → RETRY setelah pulih, pesan TIDAK hilang (kasus Achwan)", async () => {
        const users = [CUST({ name: "Achwan Fatoni", pppoe_username: "achwan@r", phone_number: "62895384054411" })];
        let calls = 0;
        const isReady = () => { calls += 1; return calls > 2; }; // putus di ronde-1, pulih kemudian
        const { deps, sent } = harness({ users, liveProfiles: { "achwan@r": "ISOLIR" }, isReady });
        const res = await runIsolirNotificationCycle(deps);
        expect(sent).toEqual(["62895384054411@s.whatsapp.net"]);
        expect(res.sent).toBe(1);
        expect(res.failed).toBe(0);
    });

    test("P0: kirim gagal sekali → dicoba ulang sampai sukses", async () => {
        const users = [CUST({ name: "Budi", pppoe_username: "budi@r" })];
        const sent = [];
        let n = 0;
        const sendImpl = async (jid) => {
            n += 1;
            if (n === 1) return { success: false, error: "timeout" };
            sent.push(jid);
            return { success: true };
        };
        const { deps } = harness({ users, liveProfiles: { "budi@r": "ISOLIR" }, sendImpl });
        const res = await runIsolirNotificationCycle(deps);
        expect(sent).toHaveLength(1);
        expect(res.sent).toBe(1);
        expect(res.failed).toBe(0);
    });

    test("P0: WA tak pernah pulih → dilaporkan GAGAL (bukan hilang diam-diam)", async () => {
        const users = [CUST({ name: "Sinta", pppoe_username: "sinta@r" })];
        const { deps, sent, logs } = harness({ users, liveProfiles: { "sinta@r": "ISOLIR" }, isReady: () => false });
        const res = await runIsolirNotificationCycle(deps);
        expect(sent).toHaveLength(0);
        expect(res.failed).toBe(1);
        expect(logs.join("\n")).toMatch(/Sinta.*TAK TERKIRIM setelah 3 ronde/i);
    });

    test("P0: terisolir tapi tanpa No HP → skip TERCATAT + alasannya", async () => {
        const users = [CUST({ name: "Tanpa HP", pppoe_username: "nohp@r", phone_number: "" })];
        const { deps, logs } = harness({ users, liveProfiles: { "nohp@r": "ISOLIR" } });
        const res = await runIsolirNotificationCycle(deps);
        expect(res.skipped).toBe(1);
        expect(logs.join("\n")).toMatch(/Tanpa HP.*tanpa No HP/i);
    });

    test("pelanggan TIDAK terisolir → bukan target (tanpa noise)", async () => {
        const users = [CUST({ name: "Lunas", pppoe_username: "lunas@r" })];
        const { deps, sent } = harness({ users, liveProfiles: { "lunas@r": "22Mbps" } });
        const res = await runIsolirNotificationCycle(deps);
        expect(sent).toHaveLength(0);
        expect(res.target).toBe(0);
        expect(res.skipped).toBe(0);
    });

    test("ringkasan: 2 nomor 1 pelanggan terkirim dua-duanya, akun infra dilewati", async () => {
        const users = [
            CUST({ name: "Risma", pppoe_username: "risma@r", phone_number: "628111|628222" }),
            CUST({ name: "CCTV", pppoe_username: "cctv@r", account_type: "infrastruktur" }),
        ];
        const { deps, sent } = harness({ users, liveProfiles: { "risma@r": "ISOLIR", "cctv@r": "ISOLIR" } });
        const res = await runIsolirNotificationCycle(deps);
        expect(sent).toEqual(["628111@s.whatsapp.net", "628222@s.whatsapp.net"]);
        expect(res.target).toBe(2);
        expect(res.sent).toBe(2);
    });
});
