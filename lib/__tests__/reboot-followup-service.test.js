/**
 * Header Doc
 * Purpose: Mengunci perilaku alur reboot berbantu yang paling mudah rusak — gate keamanan (jangan
 *          reboot saat gangguan area / ISP sakit / pelanggan sudah cabut sendiri), dan aturan
 *          "verifikasi dulu, baru bertanya" pada tindak lanjut.
 * Caller: jest.
 * Deps: `lib/reboot-followup-service`, `lib/reboot-followup-store` (file test terpisah).
 * MainFuncs: -
 * SideEffects: Menulis `database/reboot-followups_test.json` lalu menghapusnya.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const STORE_FILE = path.join(__dirname, "..", "..", "database", "reboot-followups_test.json");

jest.mock("../device-status", () => ({ isDeviceOnline: jest.fn() }));
jest.mock("../mikrotik", () => ({ getActivePPPoEUsers: jest.fn() }));
jest.mock("../whatsapp-critical-delivery", () => ({ sendCritical: jest.fn().mockResolvedValue({ ok: true }) }));
jest.mock("../wifi", () => ({ rebootRouter: jest.fn(), getCustomerRedaman: jest.fn() }));
jest.mock("../../message/handlers/conversation-handler", () => ({ setUserState: jest.fn() }));

const { isDeviceOnline } = require("../device-status");
const { getActivePPPoEUsers } = require("../mikrotik");
const { sendCritical } = require("../whatsapp-critical-delivery");
const { setUserState } = require("../../message/handlers/conversation-handler");

const service = require("../reboot-followup-service");
const store = require("../reboot-followup-store");

const BASE_USER = {
    id: 7,
    name: "Widya",
    device_id: "00259E-HG8145V5-ABC",
    pppoe_username: "widya",
    subscription: "10 Mbps"
};

function cleanStore() {
    if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
}

beforeEach(() => {
    jest.clearAllMocks();
    cleanStore();
    global.config = { rebootAssist: { enabled: true }, upstreamMonitor: { enabled: false } };
    isDeviceOnline.mockResolvedValue({ online: true, minutesAgo: 1 });
    getActivePPPoEUsers.mockResolvedValue([{ name: "widya", address: "10.0.0.5" }]);
});

afterAll(() => cleanStore());

describe("evaluateRebootGate", () => {
    test("menolak saat fitur mati", async () => {
        global.config.rebootAssist.enabled = false;
        const gate = await service.evaluateRebootGate({ user: BASE_USER, lineStatus: "online", areaOutage: false, offlineCount: 0 });
        expect(gate.allowed).toBe(false);
        expect(gate.reason).toBe("FITUR_MATI");
    });

    test("menolak saat gangguan area — reboot satu modem tak menolong", async () => {
        const gate = await service.evaluateRebootGate({ user: BASE_USER, lineStatus: "offline", areaOutage: true, offlineCount: 12 });
        expect(gate.allowed).toBe(false);
        expect(gate.reason).toBe("GANGGUAN_AREA");
    });

    test("menolak saat pelanggan sudah mencabut modemnya sendiri", async () => {
        const gate = await service.evaluateRebootGate({
            user: BASE_USER,
            lineStatus: "online",
            areaOutage: false,
            offlineCount: 0,
            customerText: "Ini baru dicoba cabut"
        });
        expect(gate.allowed).toBe(false);
        expect(gate.reason).toBe("SUDAH_RESTART_SENDIRI");
    });

    test("menolak pelanggan voucher (tanpa modem terkelola)", async () => {
        const gate = await service.evaluateRebootGate({
            user: { ...BASE_USER, subscription: "PAKET-VOUCHER" },
            lineStatus: "online",
            areaOutage: false,
            offlineCount: 0
        });
        expect(gate.allowed).toBe(false);
        expect(gate.reason).toBe("PELANGGAN_VOUCHER");
    });

    test("menolak saat modem tak terjangkau ACS (task reboot takkan mendarat)", async () => {
        isDeviceOnline.mockResolvedValue({ online: false, minutesAgo: 40 });
        const gate = await service.evaluateRebootGate({ user: BASE_USER, lineStatus: "offline", areaOutage: false, offlineCount: 0 });
        expect(gate.allowed).toBe(false);
        expect(gate.reason).toBe("MODEM_TAK_TERJANGKAU");
    });

    test("mode STRICT (tanpa sinyal upstream): menolak bila ada pelanggan lain ikut offline", async () => {
        const gate = await service.evaluateRebootGate({ user: BASE_USER, lineStatus: "offline", areaOutage: false, offlineCount: 2 });
        expect(gate.mode).toBe("strict");
        expect(gate.allowed).toBe(false);
        expect(gate.reason).toBe("STRICT_ADA_OFFLINE_LAIN");
    });

    test("mengizinkan saat terisolasi & modem masih inform (pola PPPoE hang)", async () => {
        const gate = await service.evaluateRebootGate({ user: BASE_USER, lineStatus: "offline", areaOutage: false, offlineCount: 0 });
        expect(gate.allowed).toBe(true);
        expect(gate.reason).toBe("PPPOE_HANG");
    });
});

describe("tindak lanjut: verifikasi dulu, baru bertanya", () => {
    function seedJob(overrides = {}) {
        return store.addJob({
            jid: "628123@s.whatsapp.net",
            userId: BASE_USER.id,
            name: BASE_USER.name,
            deviceId: BASE_USER.device_id,
            pppoeUsername: BASE_USER.pppoe_username,
            dueAt: new Date(Date.now() - 1000).toISOString(),
            ...overrides
        });
    }

    test("modem terbukti kembali → bertanya ke pelanggan dan memasang state REBOOTFU_ASK", async () => {
        const job = seedJob();
        await service.tickOnce();

        expect(sendCritical).toHaveBeenCalledTimes(1);
        const [jid, payload] = sendCritical.mock.calls[0];
        expect(jid).toBe("628123@s.whatsapp.net");
        expect(typeof payload).toBe("object"); // kontrak: { text }, bukan string
        expect(payload.text).toMatch(/sudah lancar/i);

        expect(setUserState).toHaveBeenCalledWith("628123@s.whatsapp.net", expect.objectContaining({ step: "REBOOTFU_ASK" }));
        expect(store.loadJobs().find((j) => j.id === job.id).status).toBe(store.STATUS.ASKED);
    });

    test("modem BELUM kembali → tidak bertanya 'sudah aman?', menjadwalkan ulang", async () => {
        isDeviceOnline.mockResolvedValue({ online: false, minutesAgo: 9 });
        const job = seedJob();
        await service.tickOnce();

        const [, payload] = sendCritical.mock.calls[0];
        expect(payload.text).not.toMatch(/sudah lancar/i);
        expect(payload.text).toMatch(/belum menyala kembali/i);
        expect(setUserState).not.toHaveBeenCalled();

        const saved = store.loadJobs().find((j) => j.id === job.id);
        expect(saved.status).toBe(store.STATUS.SCHEDULED);
        expect(saved.attempts).toBe(1);
        expect(new Date(saved.dueAt).getTime()).toBeGreaterThan(Date.now());
    });

    test("modem tetap mati setelah percobaan terakhir → eskalasi, bukan klaim sukses", async () => {
        isDeviceOnline.mockResolvedValue({ online: false, minutesAgo: 20 });
        const job = seedJob({ });
        store.updateJob(job.id, { attempts: 1 });
        global.accounts = [];

        await service.tickOnce();

        const saved = store.loadJobs().find((j) => j.id === job.id);
        expect(saved.status).toBe(store.STATUS.ESCALATED);
        const texts = sendCritical.mock.calls.map((c) => c[1].text);
        expect(texts.some((t) => /teknisi/i.test(t))).toBe(true);
    });

    test("PPPoE masih down walau ACS inform → belum dianggap kembali", async () => {
        getActivePPPoEUsers.mockResolvedValue([]); // sesi pelanggan tidak ada
        seedJob();
        await service.tickOnce();

        expect(setUserState).not.toHaveBeenCalled();
        const [, payload] = sendCritical.mock.calls[0];
        expect(payload.text).toMatch(/belum menyala kembali/i);
    });

    test("pekerjaan bertahan lintas 'restart proses' — dibaca ulang dari disk", () => {
        const job = seedJob();
        jest.resetModules(); // simulasikan proses baru
        const freshStore = require("../reboot-followup-store");
        const due = freshStore.listDueJobs(Date.now());
        expect(due.map((j) => j.id)).toContain(job.id);
    });

    test("menolak menjadwalkan follow-up untuk JID @lid (invarian: bukan nomor telepon)", () => {
        const job = service.scheduleFollowupForReboot({ user: BASE_USER, jid: "273426359050386@lid" });
        expect(job).toBeNull();
        expect(store.loadJobs()).toHaveLength(0);
    });
});
