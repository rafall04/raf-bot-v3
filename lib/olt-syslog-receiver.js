/**
 * OLT Syslog Receiver
 *
 * UDP syslog listener untuk OLT Hioso events realtime. Pengganti yang lebih
 * robust dibanding HTTP scrape ke web UI log page:
 *   - Push-based (sub-second resolution vs polling 1 menit)
 *   - Tidak perlu auth web UI (cookies/session)
 *   - Format RFC 3164 standard (lebih stabil terhadap firmware update)
 *   - Tidak ada race rotation (event diterima saat dihasilkan)
 *
 * Catatan deployment:
 *   - Bind ke port configurable (default 5514 supaya bisa run non-root).
 *     Untuk port 514 standard, perlu CAP_NET_BIND_SERVICE atau jalankan
 *     sebagai root (TIDAK direkomendasi).
 *   - Admin OLT harus config: `logging host <bot-ip> port 5514` (lihat docs).
 *   - Berjalan PARALLEL dengan olt-log-scraper.js untuk validasi 1-2 minggu
 *     sebelum decide remove scraper.
 *
 * Output event: ditulis ke `database/olt-events.json` dengan source='syslog'
 * (sama schema dengan scraper, beda field source). Caller (Smart Report,
 * dashboard) bisa filter berdasarkan source kalau perlu.
 */

const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const {
    parseHiosoLogMessage,
    createEventCorrelator,
    scoreEventConfidence,
} = require('./olt-event-classifier');
const rxHistory = require('./olt-rxpower-history');

const OLT_EVENTS_FILE = path.join(__dirname, '..', 'database', 'olt-events.json');
const DATA_RETENTION_MS = 2 * 24 * 60 * 60 * 1000; // 2 hari, sama dengan scraper

const DEFAULT_PORT = 5514;
const DEFAULT_HOST = '0.0.0.0';

let server = null;
let isRunning = false;
let correlator = null;

// Telemetri ringan supaya admin bisa cek "apakah syslog masuk?"
const stats = {
    started_at: null,
    packets_received: 0,
    packets_parsed: 0,
    events_emitted: 0,
    last_packet_at: null,
    last_event_at: null,
    last_error: null,
};

/**
 * Parse RFC 3164 syslog packet.
 * Format: `<PRI>TIMESTAMP HOSTNAME TAG: MESSAGE`
 *   - PRI = facility * 8 + severity, dalam `<...>`
 *   - TIMESTAMP = MMM DD HH:MM:SS (no year)
 *   - HOSTNAME = single token
 *   - TAG = optional, format `program[pid]:` atau `program:`
 *   - MESSAGE = sisanya
 *
 * Hioso example yang sudah kita tahu dari scraper:
 *   `<14>Jan 18 14:53:57 OLT-HIOSO EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da dying-gasp`
 *
 * Return `{ priority, timestamp, hostname, tag, message }` atau null kalau invalid.
 */
function parseSyslogPacket(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const match = raw.match(/^<(\d+)>(\w+\s+\d+\s+[\d:]+)\s+(\S+)\s+(.*)$/);
    if (!match) {
        // Beberapa device tidak include PRI atau hostname — coba parse longgar.
        const looseMatch = raw.match(/^(\w+\s+\d+\s+[\d:]+)\s+(.*)$/);
        if (looseMatch) {
            return {
                priority: null,
                timestamp: looseMatch[1],
                hostname: null,
                tag: null,
                message: raw, // pass seluruh raw line ke classifier supaya regex match
            };
        }
        return null;
    }
    return {
        priority: parseInt(match[1], 10),
        timestamp: match[2],
        hostname: match[3],
        tag: null,
        message: raw, // Pass seluruh string supaya classifier regex (yang ekspektasi format scraper) match.
    };
}

function loadEvents() {
    try {
        if (fs.existsSync(OLT_EVENTS_FILE)) {
            return JSON.parse(fs.readFileSync(OLT_EVENTS_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('[OLT-Syslog] Error loading events file:', err.message);
    }
    return {};
}

function saveEvents(events) {
    try {
        fs.writeFileSync(OLT_EVENTS_FILE, JSON.stringify(events, null, 2), 'utf8');
    } catch (err) {
        console.error('[OLT-Syslog] Error saving events file:', err.message);
    }
}

function pruneOldEvents(events) {
    const now = Date.now();
    let removed = 0;
    for (const mac of Object.keys(events)) {
        const ts = new Date(events[mac].timestamp).getTime();
        if (now - ts > DATA_RETENTION_MS) {
            delete events[mac];
            removed += 1;
        }
    }
    if (removed > 0) {
        console.log(`[OLT-Syslog] Pruned ${removed} old events`);
    }
    return events;
}

/**
 * Tulis event ke olt-events.json. Strategi: upsert by MAC, source label `syslog`.
 *
 * Race condition note: scraper juga bisa nulis ke file yang sama. Kedua sumber
 * pakai pattern "load → mutate → save" yang TIDAK atomic. Untuk dampak rendah:
 *   - Event volume biasanya rendah (puluhan per hari), collision rare.
 *   - Worst case: satu source overwrite event source lain dengan timestamp yang
 *     hampir sama → loss informasi minor, bukan data corruption.
 *
 * Future improvement: queue write atau move ke SQLite. Untuk sekarang accept risk.
 */
function persistEvent(event) {
    const events = pruneOldEvents(loadEvents());
    const existing = events[event.mac];

    // Prioritas event terbaru. Discovery override Lost (recovery), tapi Lost
    // baru jangan override Discovery kecuali timestamp jelas lebih baru.
    if (!existing || new Date(event.timestamp).getTime() >= new Date(existing.timestamp).getTime()) {
        events[event.mac] = event;
        saveEvents(events);
    }
}

function handleMessage(msg, rinfo) {
    stats.packets_received += 1;
    stats.last_packet_at = new Date().toISOString();

    const raw = msg.toString('utf8').trim();
    const syslog = parseSyslogPacket(raw);
    if (!syslog) {
        if (process.env.DEBUG_OLT_SYSLOG === 'true') {
            console.log('[OLT-Syslog DEBUG] Unparseable packet from', rinfo.address, '→', raw.slice(0, 120));
        }
        return;
    }

    const parsed = parseHiosoLogMessage(syslog.message);
    if (!parsed) {
        // Bukan event Hioso EPON yang kita peduli (mungkin debug log routing dll). Diam saja.
        return;
    }

    stats.packets_parsed += 1;

    // Untuk syslog realtime, pakai server time sebagai event timestamp (lebih akurat
    // dari syslog header yang bisa drift). Seluruh keputusan timing pakai jam server.
    const eventServerTimeMs = Date.now();
    const event = correlator.ingest(parsed, eventServerTimeMs);
    if (!event) {
        // DG ingest — masih menunggu Lost. Belum emit.
        return;
    }

    // Enrich event dengan info source UDP.
    event.received_from = rinfo.address;
    event.raw_line = syslog.message;

    // Phase 2: perkuat klasifikasi dengan riwayat rxPower (sinyal optik).
    // Untuk offline event (dying-gasp/los), analisis tren rxPower sebelum event.
    // Discovery (recovery) tidak butuh — sudah pasti.
    if (event.event_type === 'dying-gasp' || event.event_type === 'los') {
        let extraSignals = [];
        try {
            const rxSignal = rxHistory.analyzeOfflineEvent(event.mac, eventServerTimeMs);
            if (rxSignal && rxSignal.available) {
                extraSignals = [rxSignal];
            }
        } catch (rxErr) {
            console.error('[OLT-Syslog] rxPower analysis error:', rxErr.message);
        }
        const { confidence, signals } = scoreEventConfidence(event.event_type, {
            correlatedWithDg: event.correlated_with_dg === true,
            extraSignals,
        });
        event.classification_confidence = Number(confidence.toFixed(2));
        event.signals = signals;
    }

    persistEvent(event);
    stats.events_emitted += 1;
    stats.last_event_at = new Date().toISOString();

    const confLabel = event.classification_confidence !== undefined
        ? ` conf=${event.classification_confidence}`
        : '';
    console.log(`[OLT-Syslog] ${event.event_type.toUpperCase()} ${event.mac} from ${rinfo.address} slot=${event.slot} onu=${event.onu}${confLabel}`);
}

function getSyslogConfig() {
    const cfg = global.config?.oltSyslog || {};
    return {
        enabled: cfg.enabled === true, // default OFF — admin harus eksplisit aktifkan
        port: Number.isInteger(cfg.port) ? cfg.port : DEFAULT_PORT,
        host: typeof cfg.host === 'string' && cfg.host ? cfg.host : DEFAULT_HOST,
        correlationWindowMs: Number.isInteger(cfg.correlationWindowMs) ? cfg.correlationWindowMs : undefined,
    };
}

function startSyslogReceiver() {
    if (isRunning) {
        console.log('[OLT-Syslog] Already running');
        return;
    }
    const config = getSyslogConfig();
    if (!config.enabled) {
        console.log('[OLT-Syslog] Disabled (set config.oltSyslog.enabled=true to enable)');
        return;
    }

    correlator = createEventCorrelator({
        source: 'syslog',
        correlationWindowMs: config.correlationWindowMs,
    });

    server = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    server.on('error', (err) => {
        console.error('[OLT-Syslog] Server error:', err.message);
        stats.last_error = { at: new Date().toISOString(), message: err.message };
        // EADDRINUSE atau permission denied → biarkan crash listener; jangan auto-restart loop.
        try { server.close(); } catch (_e) { /* noop */ }
        server = null;
        isRunning = false;
    });

    server.on('message', (msg, rinfo) => {
        try {
            handleMessage(msg, rinfo);
        } catch (handlerErr) {
            console.error('[OLT-Syslog] Handler error:', handlerErr.message);
            stats.last_error = { at: new Date().toISOString(), message: handlerErr.message };
        }
    });

    server.on('listening', () => {
        const addr = server.address();
        console.log(`[OLT-Syslog] Listening on ${addr.address}:${addr.port}`);
        stats.started_at = new Date().toISOString();
    });

    try {
        server.bind(config.port, config.host);
        isRunning = true;
    } catch (bindErr) {
        console.error('[OLT-Syslog] Bind failed:', bindErr.message);
        stats.last_error = { at: new Date().toISOString(), message: bindErr.message };
        server = null;
        isRunning = false;
    }
}

function stopSyslogReceiver() {
    if (server) {
        try { server.close(); } catch (_e) { /* noop */ }
        server = null;
    }
    isRunning = false;
    correlator = null;
    console.log('[OLT-Syslog] Stopped');
}

function restartSyslogReceiver() {
    stopSyslogReceiver();
    setTimeout(startSyslogReceiver, 500);
}

function getStatus() {
    return {
        running: isRunning,
        config: getSyslogConfig(),
        stats: { ...stats },
        correlator: correlator ? correlator._state() : null,
    };
}

module.exports = {
    startSyslogReceiver,
    stopSyslogReceiver,
    restartSyslogReceiver,
    getStatus,
    // Internal — diekspos untuk test.
    parseSyslogPacket,
    _handleMessageForTest: handleMessage,
    _setCorrelatorForTest: (c) => { correlator = c; },
};
