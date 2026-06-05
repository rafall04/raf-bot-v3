/**
 * OLT LOS Broadcaster
 *
 * Saat pelanggan terdeteksi LOS (Loss of Signal = kemungkinan FIBER PUTUS, bukan
 * Dying Gasp/power), otomatis broadcast WhatsApp ke teknisi. DG TIDAK memicu ini
 * (DG = power outage, tunggu PLN, bukan tugas teknisi).
 *
 * PRESISI (hindari salah-panggil teknisi):
 *   1. Confirmation window — LOS fiber tidak pulih sendiri. Tunggu N menit; kalau
 *      ONU pulih (Discovery) dalam window → BATAL (flap/kedip, bukan putus).
 *   2. Confidence threshold — hanya broadcast kalau classification_confidence cukup.
 *   3. Cluster aggregation — banyak LOS bersamaan → 1 pesan agregat (dugaan
 *      gangguan area/uplink), bukan spam per-pelanggan.
 *   4. Dedup + cooldown — 1 broadcast per insiden; cegah re-broadcast saat flapping.
 *
 * EFISIEN: event-driven (hook emitEvent syslog/scraper), satu timer per pending LOS.
 * ROBUST: kirim via sendCritical (retry + dead-letter), incident dicatat ke file
 * untuk halaman admin + audit. Timer in-memory (restart di tengah window jarang;
 * incident tetap tercatat untuk review manual).
 *
 * Murni-ish: semua I/O & dependency via injeksi (deps) untuk test deterministik.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const INCIDENTS_FILE = path.join(__dirname, "..", "database", "los-incidents.json");
const MAX_INCIDENTS = 1000;

const DEFAULTS = {
    enabled: false,
    confidenceThreshold: 0.6,
    confirmationWindowMs: 3 * 60 * 1000, // 3 menit
    clusterFlushMs: 20 * 1000,           // kumpulkan LOS terkonfirmasi 20s sebelum kirim
    clusterThreshold: 3,                 // >= N LOS satu OLT = framing "gangguan area"
    rebroadcastCooldownMs: 30 * 60 * 1000, // jangan re-broadcast MAC sama dlm 30 menit
};

function defaultLoadIncidents() {
    try {
        if (fs.existsSync(INCIDENTS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(INCIDENTS_FILE, "utf8"));
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch (err) {
        console.error("[LOS-BROADCAST] Gagal baca incidents:", err.message);
    }
    return [];
}

function defaultSaveIncidents(list) {
    try {
        const trimmed = list.length > MAX_INCIDENTS ? list.slice(-MAX_INCIDENTS) : list;
        fs.writeFileSync(INCIDENTS_FILE, JSON.stringify(trimmed, null, 2), "utf8");
    } catch (err) {
        console.error("[LOS-BROADCAST] Gagal tulis incidents:", err.message);
    }
}

function defaultTeknisiRecipients() {
    return (global.accounts || [])
        .filter((acc) => acc && acc.role === "teknisi" && acc.phone_number)
        .map((acc) => String(acc.phone_number).split("|")[0].trim())
        .filter(Boolean);
}

function createLosBroadcaster(deps = {}) {
    const getConfig = deps.getConfig || (() => (global.config && global.config.oltLosBroadcast) || {});
    const getTeknisiRecipients = deps.getTeknisiRecipients || defaultTeknisiRecipients;
    const sendCritical = deps.sendCritical || require("./whatsapp-critical-delivery").sendCritical;
    const resolveCustomer = deps.resolveCustomer || (() => null); // best-effort MAC→customer
    const now = deps.now || (() => Date.now());
    const setTimer = deps.setTimeoutFn || setTimeout;
    const clearTimer = deps.clearTimeoutFn || clearTimeout;
    const loadIncidents = deps.loadIncidents || defaultLoadIncidents;
    const saveIncidents = deps.saveIncidents || defaultSaveIncidents;
    const logger = deps.logger || console;

    const pending = new Map();       // mac -> { incidentId, mac, slot, onu, oltId, customer, timer, detectedAt }
    const lastBroadcast = new Map(); // mac -> ts terakhir broadcast (cooldown)
    let readyQueue = [];             // LOS terkonfirmasi menunggu flush cluster
    let flushTimer = null;

    function cfg() {
        return { ...DEFAULTS, ...(getConfig() || {}) };
    }

    function genId() {
        return `los_${now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function buildIncident(event) {
        let customer = null;
        try {
            customer = resolveCustomer(event.mac) || null;
        } catch (e) {
            logger.error && logger.error("[LOS-BROADCAST] resolveCustomer error:", e.message);
        }
        return {
            incidentId: genId(),
            mac: event.mac,
            slot: event.slot != null ? String(event.slot) : null,
            onu: event.onu != null ? String(event.onu) : null,
            oltId: event.olt_id || event.received_from || null,
            confidence: typeof event.classification_confidence === "number" ? event.classification_confidence : null,
            customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone_number, address: customer.address || customer.alamat || null } : null,
            detectedAt: new Date(now()).toISOString(),
        };
    }

    function recordIncident(incident, status) {
        const list = loadIncidents();
        list.push({ ...incident, status, createdAt: new Date(now()).toISOString() });
        saveIncidents(list);
    }

    function updateIncident(incidentId, patch) {
        const list = loadIncidents();
        const idx = list.findIndex((i) => i.incidentId === incidentId);
        if (idx >= 0) {
            list[idx] = { ...list[idx], ...patch, updatedAt: new Date(now()).toISOString() };
            saveIncidents(list);
        }
    }

    /**
     * Entry point — dipanggil dari syslog receiver / scraper untuk SETIAP event OLT.
     */
    function handleOltEvent(event) {
        const conf = cfg();
        if (!conf.enabled || !event || !event.mac) return;

        if (event.event_type === "discovery") {
            cancelPending(event.mac, "recovered_before_broadcast");
            return;
        }
        if (event.event_type !== "los") return;

        // 2. Confidence gate.
        const confidence = typeof event.classification_confidence === "number" ? event.classification_confidence : 1;
        if (confidence < conf.confidenceThreshold) {
            recordIncident(buildIncident(event), "low_confidence");
            logger.log && logger.log(`[LOS-BROADCAST] LOS confidence rendah (${confidence}) untuk ${event.mac} — tidak auto-broadcast.`);
            return;
        }

        // 4. Dedup: sudah pending atau baru saja di-broadcast (cooldown).
        if (pending.has(event.mac)) return;
        const last = lastBroadcast.get(event.mac);
        if (last && (now() - last) < conf.rebroadcastCooldownMs) return;

        // 1. Confirmation window — tunggu, batal kalau pulih.
        const incident = buildIncident(event);
        recordIncident(incident, "pending");
        const timer = setTimer(() => onConfirm(event.mac), conf.confirmationWindowMs);
        if (timer && typeof timer.unref === "function") timer.unref();
        pending.set(event.mac, { ...incident, timer });
        logger.log && logger.log(`[LOS-BROADCAST] LOS ${event.mac} pending konfirmasi ${Math.round(conf.confirmationWindowMs / 1000)}s.`);
    }

    function cancelPending(mac, status) {
        const p = pending.get(mac);
        if (!p) return;
        clearTimer(p.timer);
        pending.delete(mac);
        updateIncident(p.incidentId, { status, resolvedAt: new Date(now()).toISOString() });
        logger.log && logger.log(`[LOS-BROADCAST] LOS ${mac} dibatalkan (${status}).`);
    }

    function onConfirm(mac) {
        const p = pending.get(mac);
        if (!p) return; // sudah di-cancel (pulih)
        pending.delete(mac);
        readyQueue.push(p);
        if (!flushTimer) {
            flushTimer = setTimer(flush, cfg().clusterFlushMs);
            if (flushTimer && typeof flushTimer.unref === "function") flushTimer.unref();
        }
    }

    async function flush() {
        flushTimer = null;
        const batch = readyQueue;
        readyQueue = [];
        if (!batch.length) return;

        // 3. Group by OLT untuk agregasi cluster.
        const groups = new Map();
        for (const item of batch) {
            const key = item.oltId || "default";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        }
        for (const [oltKey, items] of groups) {
            try {
                await broadcastGroup(oltKey, items);
            } catch (err) {
                logger.error && logger.error("[LOS-BROADCAST] broadcastGroup error:", err.message);
            }
        }
    }

    function formatIncidentLine(it, index) {
        const cust = it.customer ? `${it.customer.name}${it.customer.address ? " — " + it.customer.address : ""}` : "(pelanggan tidak teridentifikasi)";
        const port = it.slot != null || it.onu != null ? ` [slot ${it.slot}/onu ${it.onu}]` : "";
        return `${index + 1}. ${cust}\n   MAC: ${it.mac}${port}`;
    }

    function buildMessage(items, isAreaOutage, oltKey) {
        const waktu = new Date(now()).toLocaleString("id-ID");
        if (isAreaOutage) {
            const lines = items.map(formatIncidentLine).join("\n");
            return `🚨 *DUGAAN GANGGUAN AREA / UPLINK*\n\n*${items.length} ONU LOS bersamaan* (kemungkinan fiber backbone / OLT, bukan 1 drop cable).\nOLT: ${oltKey}\nWaktu: ${waktu}\n\n${lines}\n\n⚠️ Mohon cek jalur fiber utama / OLT.`;
        }
        if (items.length === 1) {
            const it = items[0];
            const cust = it.customer ? `${it.customer.name}` : "(tidak teridentifikasi)";
            const addr = it.customer && it.customer.address ? `\nAlamat: ${it.customer.address}` : "";
            const phone = it.customer && it.customer.phone ? `\nNo. HP: ${it.customer.phone}` : "";
            const port = it.slot != null || it.onu != null ? `\nPort: slot ${it.slot}/onu ${it.onu}` : "";
            return `🔴 *LOS TERDETEKSI* (kemungkinan FIBER PUTUS)\n\nPelanggan: ${cust}${addr}${phone}\nMAC: ${it.mac}${port}\nWaktu: ${waktu}\n\n💡 LOS = sinyal optik hilang (bukan mati listrik). Mohon cek jalur fiber pelanggan.`;
        }
        const lines = items.map(formatIncidentLine).join("\n");
        return `🔴 *${items.length} LOS TERDETEKSI* (kemungkinan fiber putus)\nOLT: ${oltKey}\nWaktu: ${waktu}\n\n${lines}\n\n💡 Mohon cek jalur fiber pelanggan terkait.`;
    }

    async function broadcastGroup(oltKey, items) {
        const conf = cfg();
        const isAreaOutage = items.length >= conf.clusterThreshold;
        const message = buildMessage(items, isAreaOutage, oltKey);
        const recipients = getTeknisiRecipients() || [];

        if (recipients.length === 0) {
            logger.warn && logger.warn("[LOS-BROADCAST] Tidak ada penerima teknisi — broadcast dilewati.");
            for (const it of items) updateIncident(it.incidentId, { status: "no_recipients" });
            return;
        }

        let delivered = 0;
        for (const recipient of recipients) {
            try {
                const r = await sendCritical(recipient, { text: message }, { label: "los_broadcast" });
                if (r && r.delivered) delivered += 1;
            } catch (err) {
                logger.error && logger.error(`[LOS-BROADCAST] Gagal kirim ke ${recipient}:`, err.message);
            }
        }

        const ts = now();
        for (const it of items) {
            lastBroadcast.set(it.mac, ts);
            updateIncident(it.incidentId, {
                status: "broadcasted",
                broadcastedAt: new Date(ts).toISOString(),
                areaOutage: isAreaOutage,
                recipientsCount: recipients.length,
                deliveredCount: delivered,
            });
        }
        logger.log && logger.log(`[LOS-BROADCAST] Broadcast ${items.length} LOS (area=${isAreaOutage}) ke ${delivered}/${recipients.length} teknisi.`);
    }

    return {
        handleOltEvent,
        // Diekspos untuk halaman/route + test.
        listIncidents: () => loadIncidents(),
        _state: () => ({ pendingCount: pending.size, pendingMacs: [...pending.keys()], readyQueue: readyQueue.length }),
        _flush: flush,
    };
}

// Singleton default (dipakai runtime). Test pakai createLosBroadcaster(deps).
let _singleton = null;
function getLosBroadcaster() {
    if (!_singleton) _singleton = createLosBroadcaster();
    return _singleton;
}

module.exports = {
    createLosBroadcaster,
    getLosBroadcaster,
    handleOltEvent: (event) => getLosBroadcaster().handleOltEvent(event),
    listLosIncidents: () => getLosBroadcaster().listIncidents(),
    getLosState: () => getLosBroadcaster()._state(),
    defaultTeknisiRecipients,
    DEFAULTS,
    INCIDENTS_FILE,
};
