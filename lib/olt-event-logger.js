/**
 * Header Doc
 * Purpose: Funnel ENRICH + persist event OLT ke log durable (`olt_events.sqlite`). Resolusi
 *          pelanggan by MAC (reuse `olt-customer-resolver`) lalu tulis via
 *          `repositories/olt-event.repository`. Menjawab "simpan log OLT dengan data akurat
 *          (pelanggan siapa)". Never-throw & fire-and-forget — kegagalan log TAK boleh ganggu
 *          deteksi/broadcast LOS.
 * Caller: `lib/olt-syslog-receiver.emitEvent` (semua event: DG/LOS/discovery) &
 *         `lib/olt-log-scraper.dispatchLosTransitions` (backstop los/discovery).
 * Deps: `repositories/olt-event.repository`, `lib/olt-customer-resolver`, `global.config.oltEventLog`.
 * MainFuncs: `recordOltEventSafe(event)`.
 * SideEffects: tulis 1 baris ke `olt_events.sqlite` (async, error ditelan).
 */
"use strict";

function cfg() {
    return (global.config && global.config.oltEventLog) || {};
}

// Default AKTIF (log internal, tanpa egress ke luar); mati hanya bila eksplisit enabled:false.
function isEnabled() {
    const c = cfg();
    return !c || c.enabled !== false;
}

function resolveCustomer(mac) {
    try {
        const c = require("./olt-customer-resolver").resolveCustomerByMac(mac);
        if (c) return c;
    } catch (_e) {
        /* best-effort — jangan throw */
    }
    return null;
}

// Snapshot ringkas pelanggan (denormalized, disimpan apa adanya di baris log).
function toCustomerSnapshot(u) {
    if (!u) return null;
    // Sudah berbentuk snapshot (pre-resolved, mis. poller ZTE GPON by pppoe) → pakai apa adanya.
    if (u.name && (u.phone || u.pppoe_username || u.pppoe)) return u;
    return {
        id: u.id,
        name: u.name,
        pppoe_username: u.pppoe_username,
        phone: u.phone_number || u.phone || null,
        address: u.address || u.alamat || null,
        account_type: u.account_type || "pelanggan",
    };
}

/**
 * Fire-and-forget. Enrich event dengan pelanggan lalu simpan ke log. Tidak pernah throw.
 * @param {object} event - { event_type, mac, slot, onu, olt_id|received_from, source,
 *                           classification_confidence, server_time?, customer? }
 */
function recordOltEventSafe(event) {
    try {
        if (!isEnabled() || !event || !event.event_type) return;

        let customer = null;
        if (event.customer) {
            customer = toCustomerSnapshot(event.customer);
        } else if (event.mac) {
            customer = toCustomerSnapshot(resolveCustomer(event.mac));
        }

        const record = {
            ts_ms: Number.isFinite(event.server_time_ms)
                ? event.server_time_ms
                : (event.server_time ? Date.parse(event.server_time) : undefined),
            event_type: event.event_type,
            mac: event.mac || null,
            slot: event.slot,
            onu: event.onu,
            olt_id: event.olt_id || event.received_from || null,
            confidence: event.classification_confidence,
            source: event.source || null,
            customer,
        };

        const repo = require("../repositories/olt-event.repository").getOltEventRepository();
        Promise.resolve()
            .then(() => repo.recordEvent(record))
            .catch(() => {});

        // Proyeksikan event yang SAMA menjadi STATE modem (`olt_state.sqlite`: insiden + status kini).
        // Never-throw & gated (`config.oltModemState`, default aktif). Tabel BARU tanpa konsumen
        // destruktif — mode shadow, tak menyentuh deteksi/broadcast LOS. Lihat docs/olt-modem-state-blueprint.md.
        try {
            require("./olt-incident-projector").projectEventSafe({
                event_type: event.event_type,
                mac: event.mac || null,
                slot: event.slot,
                onu: event.onu,
                olt_id: event.olt_id || event.received_from || null,
                source: event.source || null,
                confidence: event.classification_confidence,
                server_time_ms: record.ts_ms,
                olt_reported_ts: event.olt_reported_ts || event.timestamp || null,
                customer,
            });
        } catch (_projErr) {
            // never-throw dari jalur event OLT.
        }
    } catch (_e) {
        // Jangan pernah throw dari jalur event OLT.
    }
}

module.exports = { recordOltEventSafe };
