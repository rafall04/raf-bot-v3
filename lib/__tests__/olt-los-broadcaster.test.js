const { createLosBroadcaster } = require("../olt-los-broadcaster");

function makeManualTimers() {
    let seq = 0;
    const pendingTimers = new Map();
    return {
        setTimeoutFn: (fn, ms) => { const id = ++seq; pendingTimers.set(id, { fn, ms }); return id; },
        clearTimeoutFn: (id) => { pendingTimers.delete(id); },
        fireAll: async () => {
            const fns = [...pendingTimers.values()].map((t) => t.fn);
            pendingTimers.clear();
            for (const fn of fns) await fn();
        },
        count: () => pendingTimers.size,
    };
}

function makeBroadcaster(overrides = {}) {
    const timers = makeManualTimers();
    const sendCritical = jest.fn().mockResolvedValue({ delivered: true });
    let store = [];
    const config = {
        enabled: true,
        confidenceThreshold: 0.6,
        confirmationWindowMs: 180000,
        clusterFlushMs: 20000,
        clusterThreshold: 3,
        rebroadcastCooldownMs: 1800000,
        notifyCustomer: { enabled: false, delayMs: 3600000, onlyIfStillDown: true, messageTemplate: "" },
        ...overrides.config,
    };
    const b = createLosBroadcaster({
        getConfig: () => config,
        getTeknisiRecipients: overrides.recipients || (() => ["62811", "62822"]),
        sendCritical,
        resolveCustomer: overrides.resolveCustomer || ((mac) => ({ id: 1, name: `Cust-${mac}`, phone_number: "62800", address: "Jl. Mawar" })),
        resolveCustomerAsync: overrides.resolveCustomerAsync,
        now: () => Date.now(),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
        loadIncidents: () => store,
        saveIncidents: (l) => { store = l; },
        logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    return { b, timers, sendCritical, getStore: () => store, config };
}

const losEvent = (mac, extra = {}) => ({ mac, event_type: "los", classification_confidence: 0.85, slot: "1", onu: "4", olt_id: "OLT-A", ...extra });
const discEvent = (mac) => ({ mac, event_type: "discovery", slot: "1", onu: "4", olt_id: "OLT-A" });

describe("olt-los-broadcaster", () => {
    test("LOS → setelah confirmation window → broadcast ke semua teknisi", async () => {
        const { b, timers, sendCritical } = makeBroadcaster();
        b.handleOltEvent(losEvent("AABB"));
        expect(b._state().pendingCount).toBe(1);
        expect(sendCritical).not.toHaveBeenCalled(); // belum, masih window

        await timers.fireAll(); // confirmation timer → onConfirm → schedule flush
        await timers.fireAll(); // flush timer → broadcast

        expect(sendCritical).toHaveBeenCalledTimes(2); // 2 teknisi
        const [, payload, opts] = sendCritical.mock.calls[0];
        expect(payload.text).toMatch(/LOS TERDETEKSI/i);
        expect(payload.text).toMatch(/Cust-AABB/);
        expect(opts.label).toBe("los_broadcast");
    });

    test("Discovery dalam window → BATAL, tidak broadcast", async () => {
        const { b, timers, sendCritical, getStore } = makeBroadcaster();
        b.handleOltEvent(losEvent("AABB"));
        b.handleOltEvent(discEvent("AABB")); // pulih sebelum window habis
        expect(b._state().pendingCount).toBe(0);

        await timers.fireAll();
        await timers.fireAll();
        expect(sendCritical).not.toHaveBeenCalled();
        expect(getStore().some((i) => i.status === "recovered_before_broadcast")).toBe(true);
    });

    test("Cluster: 3+ LOS satu OLT → 1 broadcast agregat 'gangguan area'", async () => {
        const { b, timers, sendCritical } = makeBroadcaster();
        b.handleOltEvent(losEvent("M1"));
        b.handleOltEvent(losEvent("M2"));
        b.handleOltEvent(losEvent("M3"));

        await timers.fireAll(); // 3 confirmation timers → semua masuk readyQueue → 1 flush timer
        await timers.fireAll(); // flush → 1 grup (OLT-A) → broadcast

        // 2 teknisi × 1 pesan agregat = 2 panggilan (BUKAN 3×2=6).
        expect(sendCritical).toHaveBeenCalledTimes(2);
        expect(sendCritical.mock.calls[0][1].text).toMatch(/GANGGUAN AREA/i);
        expect(sendCritical.mock.calls[0][1].text).toMatch(/3 ONU LOS/);
    });

    test("Confidence < threshold → skip auto-broadcast (low_confidence)", async () => {
        const { b, timers, sendCritical, getStore } = makeBroadcaster();
        b.handleOltEvent(losEvent("LOWC", { classification_confidence: 0.4 }));
        expect(b._state().pendingCount).toBe(0);
        await timers.fireAll();
        expect(sendCritical).not.toHaveBeenCalled();
        expect(getStore().some((i) => i.status === "low_confidence")).toBe(true);
    });

    test("Dedup: LOS kedua untuk MAC sama saat pending → diabaikan", async () => {
        const { b } = makeBroadcaster();
        b.handleOltEvent(losEvent("AABB"));
        b.handleOltEvent(losEvent("AABB"));
        expect(b._state().pendingCount).toBe(1);
    });

    test("Cooldown: re-LOS setelah broadcast dalam cooldown → skip", async () => {
        const { b, timers, sendCritical } = makeBroadcaster();
        b.handleOltEvent(losEvent("AABB"));
        await timers.fireAll();
        await timers.fireAll();
        expect(sendCritical).toHaveBeenCalledTimes(2);

        sendCritical.mockClear();
        b.handleOltEvent(losEvent("AABB")); // dalam cooldown 30min
        expect(b._state().pendingCount).toBe(0);
        await timers.fireAll();
        expect(sendCritical).not.toHaveBeenCalled();
    });

    test("DG (dying-gasp) → diabaikan total (bukan tugas teknisi)", async () => {
        const { b } = makeBroadcaster();
        b.handleOltEvent({ mac: "AABB", event_type: "dying-gasp", olt_id: "OLT-A" });
        expect(b._state().pendingCount).toBe(0);
    });

    test("Tanpa penerima teknisi → status no_recipients, tidak crash", async () => {
        const { b, timers, sendCritical, getStore } = makeBroadcaster({ recipients: () => [] });
        b.handleOltEvent(losEvent("AABB"));
        await timers.fireAll();
        await timers.fireAll();
        expect(sendCritical).not.toHaveBeenCalled();
        expect(getStore().some((i) => i.status === "no_recipients")).toBe(true);
    });

    test("disabled → tidak ada pending", () => {
        const { b } = makeBroadcaster({ config: { enabled: false } });
        b.handleOltEvent(losEvent("AABB"));
        expect(b._state().pendingCount).toBe(0);
    });

    test("MAC beda OLT → 2 grup broadcast terpisah", async () => {
        const { b, timers, sendCritical } = makeBroadcaster();
        b.handleOltEvent(losEvent("X1", { olt_id: "OLT-A" }));
        b.handleOltEvent(losEvent("X2", { olt_id: "OLT-B" }));
        await timers.fireAll();
        await timers.fireAll();
        // 2 grup × 2 teknisi = 4 panggilan.
        expect(sendCritical).toHaveBeenCalledTimes(4);
    });

    test("1 broadcast per insiden: LOS ulang (tanpa pulih) setelah broadcast → tidak broadcast lagi", async () => {
        const { b, timers, sendCritical } = makeBroadcaster();
        b.handleOltEvent(losEvent("AABB"));
        await timers.fireAll(); // confirm
        await timers.fireAll(); // broadcast (2 teknisi)
        expect(sendCritical).toHaveBeenCalledTimes(2);
        expect(b._state().activeIncidentCount).toBe(1);

        sendCritical.mockClear();
        b.handleOltEvent(losEvent("AABB")); // masih down, belum pulih → diabaikan
        await timers.fireAll();
        expect(sendCritical).not.toHaveBeenCalled();
    });
});

describe("olt-los-broadcaster — notifikasi pelanggan terjadwal", () => {
    const cfgOn = { notifyCustomer: { enabled: true, delayMs: 3600000, onlyIfStillDown: true, messageTemplate: "" } };

    test("setelah broadcast teknisi → timer → notif pelanggan terkirim (label los_customer_notify)", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({ config: cfgOn });
        b.handleOltEvent(losEvent("AABB"));
        await timers.fireAll(); // confirm
        await timers.fireAll(); // flush → broadcast teknisi + jadwalkan timer pelanggan
        const teknisiCalls = sendCritical.mock.calls.filter((c) => c[2].label === "los_broadcast").length;
        expect(teknisiCalls).toBe(2);
        expect(sendCritical.mock.calls.some((c) => c[2].label === "los_customer_notify")).toBe(false); // belum

        await timers.fireAll(); // timer pelanggan → notif pelanggan
        const custCall = sendCritical.mock.calls.find((c) => c[2].label === "los_customer_notify");
        expect(custCall).toBeTruthy();
        expect(custCall[0]).toBe("62800");                 // phone pelanggan
        expect(custCall[1].text).toMatch(/Cust-AABB/);     // template terisi nama
    });

    test("pelanggan pulih sebelum jadwal → notif pelanggan DIBATALKAN", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({ config: cfgOn });
        b.handleOltEvent(losEvent("AABB"));
        await timers.fireAll(); // confirm
        await timers.fireAll(); // broadcast teknisi + jadwal timer pelanggan
        sendCritical.mockClear();

        b.handleOltEvent(discEvent("AABB")); // pulih sebelum timer pelanggan
        expect(b._state().activeIncidentCount).toBe(0);

        await timers.fireAll(); // timer pelanggan (kalau ada) → harus no-op
        expect(sendCritical.mock.calls.some((c) => c[2].label === "los_customer_notify")).toBe(false);
    });

    test("pelanggan tak teridentifikasi → status customer_unresolved, tidak kirim", async () => {
        const { b, timers, sendCritical, getStore } = makeBroadcaster({
            config: cfgOn,
            resolveCustomer: () => null,
            resolveCustomerAsync: async () => null,
        });
        b.handleOltEvent(losEvent("ZZZZ"));
        await timers.fireAll();
        await timers.fireAll();
        await timers.fireAll(); // timer pelanggan
        expect(sendCritical.mock.calls.some((c) => c[2].label === "los_customer_notify")).toBe(false);
        expect(getStore().some((i) => i.customerNotifyStatus === "customer_unresolved")).toBe(true);
    });

    test("notifyCustomer disabled → tidak ada notif pelanggan", async () => {
        const { b, timers, sendCritical } = makeBroadcaster(); // default disabled
        b.handleOltEvent(losEvent("AABB"));
        await timers.fireAll();
        await timers.fireAll();
        await timers.fireAll();
        expect(sendCritical.mock.calls.some((c) => c[2].label === "los_customer_notify")).toBe(false);
    });
});
