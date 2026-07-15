/**
 * Header Doc
 * Purpose: Perawatan state modem OLT — (1) reconcile: tutup insiden `open` yang menggantung
 *          (assumed_recovered) + prune retensi; (2) backfill/rebuild: replay `olt_events`
 *          historis lewat projector untuk membangun ulang `olt_state` (rebuildable). Menegakkan
 *          prinsip "state = cache turunan yang bisa dibangun ulang". Lihat docs/olt-modem-state-blueprint.md.
 * Caller: `lib/app-runtime.js` (startOltStateMaintenance saat boot); util rebuild on-demand.
 * Deps: `repositories/olt-incident.repository`, `repositories/olt-event.repository`,
 *        `lib/olt-incident-projector`, `global.config.oltModemState`.
 * MainFuncs: `reconcileOltState`, `backfillOltStateFromEvents`, `startOltStateMaintenance`.
 * SideEffects: Menulis `olt_state.sqlite` (tutup/prune insiden, rebuild state). Never-throw dari boot hook.
 */
"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;

function cfg(config) {
    return (config && config.oltModemState) || {};
}

function isEnabled(config) {
    return cfg(config).enabled !== false;
}

/**
 * Reconcile: tutup insiden nyangkut (tak pernah pulih) sebagai backstop + prune retensi.
 * @returns {Promise<{closed_stale:number, pruned:number}>}
 */
async function reconcileOltState({ repo, config = null, now = () => Date.now() } = {}) {
    const c = cfg(config);
    const maxOpenMs = Number.isFinite(c.maxOpenIncidentMs) ? c.maxOpenIncidentMs : 3 * DAY_MS;
    const retentionDays = Number.isFinite(c.incidentRetentionDays) ? c.incidentRetentionDays : 365;
    const closed = await repo.closeStaleIncidents({ maxOpenMs, now_ms: now() });
    const pruned = await repo.pruneOldIncidents(retentionDays);
    return { closed_stale: closed.closed, pruned };
}

// Baris `olt_events` → event untuk projector.
function eventRowToProjectorEvent(row) {
    const hasCustomer = row.customer_id || row.customer_name || row.pppoe_username;
    return {
        event_type: row.event_type,
        mac: row.mac,
        slot: row.slot,
        onu: row.onu,
        olt_id: row.olt_id,
        source: row.source,
        confidence: row.confidence,
        server_time_ms: row.ts_ms,
        customer: hasCustomer
            ? { id: row.customer_id, name: row.customer_name, pppoe_username: row.pppoe_username, phone: row.phone, address: row.address }
            : null,
    };
}

/**
 * Bangun ulang `olt_state` dari `olt_events` (replay kronologis). Idempoten — event yang sama
 * (dedup_key) tak menggandakan insiden; close ganda jadi no-op. Aman dijalankan berulang.
 * @returns {Promise<{processed:number}>}
 */
async function backfillOltStateFromEvents({ eventRepo, projector, sinceMs = 0, pageSize = 2000 } = {}) {
    const collected = [];
    let offset = 0;
    let more = true;
    // listEvents mengurut DESC; ambil per halaman sampai keluar jendela, lalu balik ke ASC.
    while (more) {
        const page = await eventRepo.listEvents({ from: sinceMs, limit: pageSize, offset });
        collected.push(...page);
        offset += pageSize;
        more = page.length >= pageSize && offset <= 100000; // batas pengaman
    }
    const asc = collected.slice().sort((a, b) => (a.ts_ms || 0) - (b.ts_ms || 0));
    let processed = 0;
    for (const row of asc) {
        try {
            await projector.handleEvent(eventRowToProjectorEvent(row));
            processed += 1;
        } catch (_e) {
            // best-effort per baris
        }
    }
    return { processed };
}

// Backfill sekali saat state masih kosong (populasi awal dari riwayat event).
async function maybeBackfillOnEmpty({ repo, config = null } = {}) {
    const c = cfg(config);
    if (c.backfillOnEmpty === false) return { skipped: "disabled" };
    const existing = await repo.listModemStates({ limit: 1 });
    if (existing.length > 0) return { skipped: "not_empty" };
    const days = Number.isFinite(c.backfillDays) ? c.backfillDays : 7;
    const eventRepo = require("../repositories/olt-event.repository").getOltEventRepository();
    const { createProjector } = require("./olt-incident-projector");
    const projector = createProjector({ repo, config });
    const res = await backfillOltStateFromEvents({ eventRepo, projector, sinceMs: Date.now() - days * DAY_MS });
    if (res.processed > 0) console.log(`[OLT-State] backfill ${res.processed} event → state modem.`);
    return res;
}

/** Hook boot (app-runtime). Never-throw. Reconcile berkala + backfill-if-empty. */
function startOltStateMaintenance() {
    try {
        if (!isEnabled(global.config)) return;
        const { getOltIncidentRepository } = require("../repositories/olt-incident.repository");
        const repo = getOltIncidentRepository();

        reconcileOltState({ repo, config: global.config }).catch(() => {});
        const timer = setInterval(() => {
            reconcileOltState({ repo, config: global.config }).catch(() => {});
        }, DAY_MS);
        if (timer && typeof timer.unref === "function") timer.unref();

        maybeBackfillOnEmpty({ repo, config: global.config }).catch(() => {});
    } catch (err) {
        console.error("[OLT-State] maintenance init gagal:", err.message);
    }
}

module.exports = {
    reconcileOltState,
    backfillOltStateFromEvents,
    eventRowToProjectorEvent,
    maybeBackfillOnEmpty,
    startOltStateMaintenance,
};
