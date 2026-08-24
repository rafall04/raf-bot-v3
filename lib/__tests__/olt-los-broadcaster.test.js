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
        // Default: verifikasi scrape no-op (Map kosong → tak ada yang disaring). Test spesifik
        // meng-override untuk mensimulasikan verdict DG.
        verifyLosBatch: overrides.verifyLosBatch || (async () => new Map()),
    });
    return { b, timers, sendCritical, getStore: () => store, config };
}

const losEvent = (mac, extra = {}) => ({ mac, event_type: "los", classification_confidence: 0.85, slot: "1", onu: "4", olt_id: "OLT-A", ...extra });
const discEvent = (mac) => ({ mac, event_type: "discovery", slot: "1", onu: "4", olt_id: "OLT-A" });

describe("olt-los-broadcaster", () => {
    test("LOS akun infrastruktur → broadcast teknisi tetap, notif pelanggan DILEWATI", async () => {
        const { b, timers, sendCritical, getStore } = makeBroadcaster({
            config: { notifyCustomer: { enabled: true, delayMs: 1000, onlyIfStillDown: true, messageTemplate: "" } },
            resolveCustomer: () => ({ id: 9, name: "CCTV Pasar", phone_number: "62800", address: "Pasar", account_type: "infrastruktur" }),
        });
        b.handleOltEvent(losEvent("INFRA1"));
        await timers.fireAll(); // confirmation window → onConfirm (set flush timer)
        await timers.fireAll(); // flush → broadcast teknisi + jadwalkan notif pelanggan
        await timers.fireAll(); // timer notif pelanggan → onCustomerNotify (harus skip infra)

        // Teknisi TETAP diberi tahu (alihkan ke teknisi), dengan penanda INFRA.
        const teknisiCalls = sendCritical.mock.calls.filter((c) => c[2] && c[2].label === "los_broadcast");
        expect(teknisiCalls.length).toBeGreaterThan(0);
        expect(teknisiCalls[0][1].text).toMatch(/INFRA/);
        // TIDAK ada notif "internet putus" ke nomor akun infrastruktur.
        const customerCalls = sendCritical.mock.calls.filter((c) => c[2] && c[2].label === "los_customer_notify");
        expect(customerCalls.length).toBe(0);
        // Insiden ditandai skipped_infrastructure.
        expect(getStore().some((i) => i.customerNotifyStatus === "skipped_infrastructure")).toBe(true);
    });

    test("verify scrape vonis DG → LOS DISARING (tak broadcast, status suppressed_dg_scrape)", async () => {
        const { b, timers, sendCritical, getStore } = makeBroadcaster({
            verifyLosBatch: async (macs) => new Map(macs.map((m) => [m, "dying-gasp"])),
        });
        b.handleOltEvent(losEvent("PWR1"));
        await timers.fireAll(); // window → onConfirm
        await timers.fireAll(); // flush → broadcastGroup (verify menyaring)
        const teknisiCalls = sendCritical.mock.calls.filter((c) => c[2] && c[2].label === "los_broadcast");
        expect(teknisiCalls.length).toBe(0); // DG → tidak di-broadcast
        expect(getStore().some((i) => i.status === "suppressed_dg_scrape")).toBe(true);
    });

    test("verify scrape vonis LOS → TETAP broadcast", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({
            verifyLosBatch: async (macs) => new Map(macs.map((m) => [m, "los"])),
        });
        b.handleOltEvent(losEvent("FIB1"));
        await timers.fireAll();
        await timers.fireAll();
        const teknisiCalls = sendCritical.mock.calls.filter((c) => c[2] && c[2].label === "los_broadcast");
        expect(teknisiCalls.length).toBeGreaterThan(0);
    });

    test("gerbang MATI-LISTRIK-AREA: LOS di tengah klaster DG tetangga → DISARING (suppressed_area_dg)", async () => {
        const { b, timers, sendCritical, getStore } = makeBroadcaster({
            verifyLosBatch: async (macs) => {
                const m = new Map(macs.map((x) => [x, "los"])); // web-log tetap 'los' (ONU gagal gasp)
                m.areaDgClusterByMac = new Map(macs.map((x) => [x, 50])); // 50 tetangga gasp serentak
                return m;
            },
        });
        b.handleOltEvent(losEvent("PWRFAIL"));
        await timers.fireAll();
        await timers.fireAll();
        const teknisiCalls = sendCritical.mock.calls.filter((c) => c[2] && c[2].label === "los_broadcast");
        expect(teknisiCalls.length).toBe(0); // mati listrik area → tidak dikira fiber putus
        expect(getStore().some((i) => i.status === "suppressed_area_dg")).toBe(true);
    });

    test("LOS terisolasi (klaster DG < threshold) → TETAP broadcast (fiber putus asli)", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({
            verifyLosBatch: async (macs) => {
                const m = new Map(macs.map((x) => [x, "los"]));
                m.areaDgClusterByMac = new Map(macs.map((x) => [x, 1])); // 1 tetangga < threshold 5
                return m;
            },
        });
        b.handleOltEvent(losEvent("REALCUT"));
        await timers.fireAll();
        await timers.fireAll();
        const teknisiCalls = sendCritical.mock.calls.filter((c) => c[2] && c[2].label === "los_broadcast");
        expect(teknisiCalls.length).toBeGreaterThan(0);
    });

    test("gerbang area: >= clusterThreshold LOS serentak → auto-tiket per-ONU DILEWATI", async () => {
        const ticketSvc = require("../los-ticket-service");
        const spy = jest.spyOn(ticketSvc, "maybeCreateLosTicket").mockReturnValue("T-X");
        try {
            const { b, timers } = makeBroadcaster({ config: { autoTicket: { enabled: true }, clusterThreshold: 3 } });
            b.handleOltEvent(losEvent("A1"));
            b.handleOltEvent(losEvent("A2"));
            b.handleOltEvent(losEvent("A3"));
            await timers.fireAll(); // 3 window → onConfirm
            await timers.fireAll(); // flush → broadcastGroup (area outage)
            expect(spy).not.toHaveBeenCalled(); // banjir tiket dicegah
        } finally { spy.mockRestore(); }
    });

    test("LOS terisolasi (< threshold) → auto-tiket TETAP dibuat", async () => {
        const ticketSvc = require("../los-ticket-service");
        const spy = jest.spyOn(ticketSvc, "maybeCreateLosTicket").mockReturnValue("T-Y");
        try {
            const { b, timers } = makeBroadcaster({ config: { autoTicket: { enabled: true }, clusterThreshold: 3 } });
            b.handleOltEvent(losEvent("SOLO"));
            await timers.fireAll();
            await timers.fireAll();
            expect(spy).toHaveBeenCalledTimes(1);
        } finally { spy.mockRestore(); }
    });

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

describe("olt-los-broadcaster — notif PULIH (recovery)", () => {
    const recCfg = { notifyRecovery: true, recoveryConfirmMs: 60000, recoveryClusterFlushMs: 20000 };

    async function broadcastThenRecover(b, timers, mac) {
        b.handleOltEvent(losEvent(mac));
        await timers.fireAll(); // confirm window → onConfirm
        await timers.fireAll(); // flush → broadcast (active incident set)
    }

    test("default notifyRecovery OFF → discovery tidak kirim notif pulih (perilaku lama)", async () => {
        const { b, timers, sendCritical } = makeBroadcaster();
        await broadcastThenRecover(b, timers, "AABB");
        sendCritical.mockClear();
        b.handleOltEvent(discEvent("AABB"));
        await timers.fireAll();
        await timers.fireAll();
        expect(sendCritical.mock.calls.some((c) => c[2].label === "los_recovery")).toBe(false);
    });

    test("ONU pulih setelah broadcast → notif PULIH ber-durasi ke teknisi (debounce + flush)", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({ config: recCfg });
        await broadcastThenRecover(b, timers, "AABB");
        sendCritical.mockClear();

        b.handleOltEvent(discEvent("AABB")); // pulih → masuk debounce
        expect(b._state().activeIncidentCount).toBe(0);
        expect(b._state().recoveringCount).toBe(1);
        expect(sendCritical).not.toHaveBeenCalled(); // masih debounce

        await timers.fireAll(); // recoveryConfirm → masuk recoveryReadyQueue + schedule flush
        await timers.fireAll(); // recoveryFlush → kirim
        const recCalls = sendCritical.mock.calls.filter((c) => c[2].label === "los_recovery");
        expect(recCalls.length).toBe(2); // 2 teknisi
        expect(recCalls[0][1].text).toMatch(/LOS PULIH/i);
        expect(recCalls[0][1].text).toMatch(/Durasi putus/i);
        expect(recCalls[0][1].text).toMatch(/Cust-AABB/);
    });

    test("anti-flap: ONU LOS lagi selama debounce pulih → notif pulih DIBATALKAN, tetap aktif", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({ config: recCfg });
        await broadcastThenRecover(b, timers, "AABB");
        sendCritical.mockClear();

        b.handleOltEvent(discEvent("AABB")); // pulih → debounce
        expect(b._state().recoveringCount).toBe(1);
        b.handleOltEvent(losEvent("AABB"));  // turun lagi sebelum debounce habis
        expect(b._state().recoveringCount).toBe(0);
        expect(b._state().activeIncidentCount).toBe(1); // kembali aktif (insiden sama)

        await timers.fireAll();
        await timers.fireAll();
        expect(sendCritical.mock.calls.some((c) => c[2].label === "los_recovery")).toBe(false);
    });

    test("pemulihan area: 3 ONU pulih serentak → 1 pesan 'PEMULIHAN AREA'", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({ config: { ...recCfg, clusterThreshold: 3 } });
        // 3 LOS di OLT sama → broadcast area
        b.handleOltEvent(losEvent("M1"));
        b.handleOltEvent(losEvent("M2"));
        b.handleOltEvent(losEvent("M3"));
        await timers.fireAll(); // confirm ×3
        await timers.fireAll(); // flush → broadcast area
        sendCritical.mockClear();

        b.handleOltEvent(discEvent("M1"));
        b.handleOltEvent(discEvent("M2"));
        b.handleOltEvent(discEvent("M3"));
        await timers.fireAll(); // 3 recoveryConfirm → readyQueue + 1 flush timer
        await timers.fireAll(); // recoveryFlush → 1 pesan area
        const recCalls = sendCritical.mock.calls.filter((c) => c[2].label === "los_recovery");
        expect(recCalls.length).toBe(2); // 1 pesan agregat × 2 teknisi
        expect(recCalls[0][1].text).toMatch(/PEMULIHAN AREA/i);
        expect(recCalls[0][1].text).toMatch(/3 ONU/);
    });

    test("restart-robust: discovery tanpa active in-memory → notif pulih dari file incidents", async () => {
        // Simulasikan pasca-restart: incidents file berisi insiden 'broadcasted' tanpa active.
        const { b, timers, sendCritical, getStore } = makeBroadcaster({ config: recCfg });
        // Seed store manual (seolah broadcast sebelum restart).
        const store = getStore();
        store.push({
            incidentId: "los_old_1", mac: "REBOOT1", slot: "1", onu: "4", oltId: "OLT-A",
            customer: { id: 5, name: "Pak Budi", address: "Jl. Melati" },
            status: "broadcasted", broadcastedAt: new Date(Date.now() - 15 * 60000).toISOString(),
        });
        b.handleOltEvent(discEvent("REBOOT1")); // tak ada di activeIncidents → dari file
        expect(b._state().recoveringCount).toBe(1);
        await timers.fireAll();
        await timers.fireAll();
        const recCalls = sendCritical.mock.calls.filter((c) => c[2].label === "los_recovery");
        expect(recCalls.length).toBe(2);
        expect(recCalls[0][1].text).toMatch(/Pak Budi/);
        // Idempoten: discovery kedua tak kirim ulang (recoveredNotifiedAt sudah ada).
        sendCritical.mockClear();
        b.handleOltEvent(discEvent("REBOOT1"));
        await timers.fireAll();
        await timers.fireAll();
        expect(sendCritical.mock.calls.some((c) => c[2].label === "los_recovery")).toBe(false);
    });

    const custRecCfg = (extra = {}) => ({
        ...recCfg,
        notifyCustomer: { enabled: true, delayMs: 1000, onlyIfStillDown: true, messageTemplate: "", notifyOnRecovery: true, recoveryMessageTemplate: "", ...extra },
    });

    test("notif PULIH pelanggan: yang sempat dikabari saat gangguan → dapat pesan pulih (los_customer_recovery)", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({ config: custRecCfg() });
        b.handleOltEvent(losEvent("CUST1"));
        await timers.fireAll(); // confirm
        await timers.fireAll(); // broadcast + jadwal timer pelanggan
        await timers.fireAll(); // timer pelanggan → onCustomerNotify (customerNotified=true)
        expect(sendCritical.mock.calls.some((c) => c[2].label === "los_customer_notify")).toBe(true);

        sendCritical.mockClear();
        b.handleOltEvent(discEvent("CUST1")); // pulih → debounce
        await timers.fireAll(); // recoveryConfirm → readyQueue + flush timer
        await timers.fireAll(); // recoveryFlush → sendRecovery (teknisi + PELANGGAN)
        const custRec = sendCritical.mock.calls.filter((c) => c[2] && c[2].label === "los_customer_recovery");
        expect(custRec.length).toBe(1);
        expect(custRec[0][0]).toBe("62800"); // phone pelanggan
    });

    test("notif PULIH pelanggan DILEWATI kalau tak pernah dikabari (pulih sebelum delay)", async () => {
        // delay 1 jam → pelanggan tak sempat dikabari sebelum pulih.
        const { b, timers, sendCritical } = makeBroadcaster({ config: custRecCfg({ delayMs: 3600000 }) });
        b.handleOltEvent(losEvent("CUST2"));
        await timers.fireAll(); // confirm
        await timers.fireAll(); // broadcast + jadwal timer pelanggan (1 jam, tak akan fire)
        sendCritical.mockClear();
        b.handleOltEvent(discEvent("CUST2")); // pulih dulu (customerNotified masih false)
        await timers.fireAll();
        await timers.fireAll();
        expect(sendCritical.mock.calls.some((c) => c[2] && c[2].label === "los_customer_recovery")).toBe(false);
    });

    // ---- #b259: catatan GANGGUAN AREA di pesan pelanggan ----
    // TERUKUR di produksi Tanjungharjo: 21 dari 25 notifikasi (84%) adalah gangguan AREA.
    // Bagi pelanggan itu fakta paling menenangkan yang bisa disampaikan, dan paling mengurangi
    // telepon masuk — ia menjawab lebih dulu "apa cuma saya?" dan "apa gara-gara alat saya?".
    const areaCfg = (extra = {}) => ({
        clusterThreshold: 3,
        notifyCustomer: {
            enabled: true, delayMs: 1000, onlyIfStillDown: true,
            messageTemplate: "Halo {customer_name}\n\n{area_note}\n\nSalam.",
            ...extra
        }
    });
    const teksPelanggan = (sendCritical) =>
        sendCritical.mock.calls.filter((c) => c[2] && c[2].label === "los_customer_notify").map((c) => c[1].text);

    test("#b259 — gangguan AREA (>= clusterThreshold): pesan pelanggan menyebutkan area", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({ config: areaCfg() });
        ["A1", "A2", "A3"].forEach((m) => b.handleOltEvent(losEvent(m)));
        await timers.fireAll(); // confirm
        await timers.fireAll(); // flush → broadcast + jadwal notif pelanggan
        await timers.fireAll(); // notif pelanggan
        const teks = teksPelanggan(sendCritical);
        expect(teks.length).toBeGreaterThan(0);
        expect(teks[0]).toMatch(/area Kakak/);
    });

    test("#b259 — LOS TUNGGAL: slot area kosong, dan tidak meninggalkan celah baris", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({ config: areaCfg() });
        b.handleOltEvent(losEvent("S1"));
        await timers.fireAll();
        await timers.fireAll();
        await timers.fireAll();
        const teks = teksPelanggan(sendCritical);
        expect(teks.length).toBeGreaterThan(0);
        expect(teks[0]).not.toMatch(/area Kakak/);
        // Slot kosong TIDAK boleh menyisakan baris kosong beruntun di tengah pesan.
        expect(teks[0]).not.toMatch(/\n\n\n/);
        expect(teks[0]).toMatch(/^Halo /);
    });

    test("#b259 — catatan area dapat disunting admin lewat areaNoteTemplate", async () => {
        const { b, timers, sendCritical } = makeBroadcaster({
            config: areaCfg({ areaNoteTemplate: "Banyak tetangga Kakak juga terdampak." })
        });
        ["B1", "B2", "B3"].forEach((m) => b.handleOltEvent(losEvent(m)));
        await timers.fireAll();
        await timers.fireAll();
        await timers.fireAll();
        expect(teksPelanggan(sendCritical)[0]).toMatch(/Banyak tetangga Kakak/);
    });
});
