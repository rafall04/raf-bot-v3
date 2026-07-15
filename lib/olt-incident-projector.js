/**
 * Header Doc
 * Purpose: PROJECTOR state modem OLT — mengubah stream event terklasifikasi (los/dying-gasp/
 *          discovery dari syslog/scrape/ZTE-SNMP) menjadi INSIDEN (down→up) + STATE terkini
 *          per modem. Idempoten & tahan urutan-acak (dedup_key + "1 insiden open/MAC"),
 *          waktu-server sebagai patokan, inferensi reboot & reklasifikasi LOS→DG saat DG menyusul,
 *          + tag gangguan area sederhana. Never-throw dari jalur ingest.
 *          Lihat `docs/olt-modem-state-blueprint.md`.
 * Caller: `lib/olt-event-logger.recordOltEventSafe` (fire-and-forget, setelah event mentah dicatat).
 * Deps: `repositories/olt-incident.repository`, `global.config.oltModemState` (gate + ambang).
 * MainFuncs: `createProjector({repo, now, config})` → `handleEvent(event)`; `projectEventSafe(event)`.
 * SideEffects: Menulis ke `olt_state.sqlite` (insiden + modem_state). Best-effort.
 */
"use strict";

function numOr(v, fb) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fb;
}

function getThresholds(config) {
    const c = (config && config.oltModemState) || {};
    return {
        // Lost→Discovery lebih pendek dari ini → diklasifikasi 'reboot' (inferensi). Kalibrasi!
        rebootWindowMs: numOr(c.rebootWindowMs, 5 * 60 * 1000),
        // Bucket dedup event kembar (syslog+scrape / reorder UDP) yang nyaris bersamaan.
        dedupBucketMs: numOr(c.dedupBucketMs, 60 * 1000),
        // ≥ ini insiden open serempak di 1 OLT dalam window → tandai gangguan area.
        clusterThreshold: numOr(c.clusterThreshold, 5),
        clusterWindowMs: numOr(c.clusterWindowMs, 3 * 60 * 1000),
    };
}

// Gate: default AKTIF (tulis tabel internal, tanpa egress). Mati hanya bila eksplisit false.
function isEnabled(config) {
    const c = (config && config.oltModemState) || {};
    return c.enabled !== false;
}

// Normalisasi tipe event mentah → tipe kanonik.
function normalizeType(raw) {
    const t = String(raw || "").toLowerCase().replace(/[\s_]+/g, "-");
    if (t === "los" || t === "lost") return "los";
    if (t === "dying-gasp" || t === "dg") return "dying_gasp";
    if (t === "discovery" || t === "online" || t === "working") return "discovery";
    return null;
}

// tipe insiden down → nama state modem.
function downStateOf(incidentType) {
    return incidentType === "dying_gasp" ? "dying_gasp" : "los";
}

function createProjector({ repo, now = () => Date.now(), config = null } = {}) {
    if (!repo) throw new Error("projector butuh repo");

    async function applyState({ mac, current_state, state_since_ms, last_event_at_ms, last_source, open_incident_id, customer, event }) {
        await repo.upsertModemState({
            mac,
            olt_id: event.olt_id,
            slot: event.slot,
            onu: event.onu,
            current_state,
            state_since_ms,
            last_event_at_ms,
            last_source,
            open_incident_id,
            customer,
            now_ms: last_event_at_ms,
        });
    }

    /**
     * Proses satu event terklasifikasi. Return {ok, action, mac, incidentId?}.
     * @param {object} event { event_type, mac, slot, onu, olt_id, source, confidence,
     *                         server_time_ms, olt_reported_ts, customer }
     */
    async function handleEvent(event = {}) {
        const type = normalizeType(event.event_type);
        if (!type) return { ok: false, reason: "invalid_type" };
        const mac = repo.normMac(event.mac);
        if (!mac) return { ok: false, reason: "no_mac" };

        const serverMs = Number.isFinite(event.server_time_ms) ? event.server_time_ms : now();
        const source = event.source || null;
        const customer = event.customer || null;
        const identityVerified = !!(customer && customer.id != null);
        const th = getThresholds(config);

        const open = await repo.getOpenIncidentByMac(mac);

        // ---- UP / recovery ----
        if (type === "discovery") {
            if (open) {
                let finalType = open.incident_type;
                let finalConf = open.confidence;
                let verify = open.verify_method;
                const duration = serverMs - open.started_at_ms;
                // Inferensi reboot: LOS pendek yang cepat pulih = modem restart (bukan fiber putus).
                if (open.incident_type === "los" && duration >= 0 && duration < th.rebootWindowMs) {
                    finalType = "reboot";
                    finalConf = 0.6;
                    verify = "inferred_reboot";
                }
                await repo.closeIncident(open.id, {
                    ended_at_ms: serverMs, up_source: source,
                    incident_type: finalType, confidence: finalConf, verify_method: verify, now_ms: serverMs,
                });
            }
            await applyState({
                mac, current_state: "online", state_since_ms: serverMs,
                last_event_at_ms: serverMs, last_source: source, open_incident_id: null, customer, event,
            });
            return { ok: true, action: open ? "closed" : "online", mac };
        }

        // ---- DOWN (los / dying_gasp) ----
        const incType = type; // los | dying_gasp

        if (open) {
            // Sudah down. DG menyusul LOS → naikkan klasifikasi (DG lebih spesifik).
            if (incType === "dying_gasp" && open.incident_type !== "dying_gasp") {
                await repo.reclassifyOpenIncident(open.id, {
                    incident_type: "dying_gasp",
                    confidence: Math.max(0.85, Number(open.confidence) || 0),
                    verify_method: "dg_pair", now_ms: serverMs,
                });
                await applyState({
                    mac, current_state: "dying_gasp", state_since_ms: open.started_at_ms,
                    last_event_at_ms: serverMs, last_source: source, open_incident_id: open.id, customer, event,
                });
                return { ok: true, action: "reclassified", mac, incidentId: open.id };
            }
            // Event down berulang untuk gangguan yang sama → idempoten, cukup segarkan last_event.
            await applyState({
                mac, current_state: downStateOf(open.incident_type), state_since_ms: open.started_at_ms,
                last_event_at_ms: serverMs, last_source: source, open_incident_id: open.id, customer, event,
            });
            return { ok: true, action: "still_down", mac, incidentId: open.id };
        }

        // Buka insiden baru.
        const dedupKey = `${mac}:${incType}:${Math.floor(serverMs / th.dedupBucketMs)}`;

        // Deteksi gangguan area sederhana: hitung insiden open di OLT ini dalam window.
        let isArea = false;
        let clusterId = null;
        if (event.olt_id) {
            const openOnOlt = await repo.countOpenIncidentsByOlt(String(event.olt_id), serverMs - th.clusterWindowMs);
            if (openOnOlt + 1 >= th.clusterThreshold) {
                isArea = true;
                clusterId = `${event.olt_id}:${Math.floor(serverMs / th.clusterWindowMs)}`;
            }
        }

        const confidence = Number.isFinite(event.confidence)
            ? event.confidence
            : (incType === "dying_gasp" ? 0.85 : 0.6);
        const verifyMethod = incType === "dying_gasp"
            ? "dg_pair"
            : (source === "scrape" ? "scrape_confirmed" : (source === "snmp" ? "snmp_state" : "syslog_only"));

        const opened = await repo.openIncident({
            mac, olt_id: event.olt_id, slot: event.slot, onu: event.onu,
            incident_type: incType, started_at_ms: serverMs, olt_reported_ts: event.olt_reported_ts,
            down_source: source, confidence, verify_method: verifyMethod,
            identity_verified: identityVerified, is_area_event: isArea, cluster_id: clusterId,
            dedup_key: dedupKey, customer, now_ms: serverMs,
        });

        await applyState({
            mac, current_state: downStateOf(incType), state_since_ms: serverMs,
            last_event_at_ms: serverMs, last_source: source, open_incident_id: opened.id, customer, event,
        });

        return { ok: true, action: opened.opened ? "opened" : "dup", mac, incidentId: opened.id };
    }

    return { handleEvent, getThresholds: () => getThresholds(config) };
}

// === Singleton fire-and-forget untuk jalur ingest ===
let singletonProjector = null;
function getProjector() {
    if (!singletonProjector) {
        const { getOltIncidentRepository } = require("../repositories/olt-incident.repository");
        singletonProjector = createProjector({
            repo: getOltIncidentRepository(),
            config: global.config,
        });
    }
    return singletonProjector;
}

/**
 * Hook never-throw untuk funnel event OLT. Meng-update state modem dari event yang SAMA
 * yang dicatat ke `olt_events`. Gagal → ditelan (deteksi/broadcast LOS tak boleh terganggu).
 */
function projectEventSafe(event) {
    try {
        if (!isEnabled(global.config) || !event || !event.event_type) return;
        const projector = getProjector();
        Promise.resolve()
            .then(() => projector.handleEvent(event))
            .catch(() => {});
    } catch (_e) {
        // Jangan pernah throw dari jalur event OLT.
    }
}

module.exports = {
    createProjector,
    projectEventSafe,
    normalizeType,
    getThresholds,
    isEnabled,
};
