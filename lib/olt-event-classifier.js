/**
 * OLT Event Classifier
 *
 * Pure parsing + DG/LOS correlation logic untuk OLT Hioso events.
 * Shared antara `lib/olt-log-scraper.js` (HTTP scrape) dan
 * `lib/olt-syslog-receiver.js` (UDP push). Tujuannya: satu sumber kebenaran
 * untuk regex parsing + algoritma korelasi, supaya output event consistent
 * apapun source-nya.
 *
 * Hioso firmware tidak expose OID yang membedakan Dying Gasp vs LOS — keduanya
 * jadi `lastDownCause = 1`. Workaround: korelasi dari log message text.
 *
 *   Skenario DG (adaptor mati / PLN outage):
 *     1. ONU kirim "dying-gasp" event sebelum mati  →  log line: "... dying-gasp"
 *     2. OLT kehilangan sinyal dalam beberapa detik  →  log line: "... Lost"
 *     → Classification: 'dying-gasp'
 *
 *   Skenario LOS (fiber putus / ONU hardware fail):
 *     1. ONU mati mendadak, tidak sempat kirim DG
 *     2. OLT langsung kehilangan sinyal  →  log line: "... Lost" (tanpa DG sebelumnya)
 *     → Classification: 'los'
 *
 *   Recovery: "... Discovery"
 *     → Classification: 'discovery'
 *
 * Pure: tidak ada I/O, tidak baca config, tidak tulis file. Caller yang
 * handle persistence + integrasi.
 */

const DEFAULT_CORRELATION_WINDOW_MS = 60_000; // DG harus dalam 60s sebelum Lost
const DEFAULT_DG_TTL_MS = 5 * 60_000;          // Hapus DG entry yang udah 5 menit (cleanup)

/**
 * Normalisasi MAC ke format tanpa separator, uppercase.
 * `aa:bb:cc:dd:ee:ff` → `AABBCCDDEEFF`
 */
function normalizeMAC(mac) {
    if (!mac || typeof mac !== 'string') return '';
    return mac.replace(/[:\-\s]/g, '').toUpperCase();
}

/**
 * Parse satu line log Hioso EPON. Return null kalau bukan event yang dikenal.
 * Format yang didukung:
 *   - "Jan 18 14:53:57 EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da dying-gasp"
 *   - "Jan 18 14:53:57 EPON: Slot 0/1/1:4 Onu c0:f6:ec:1e:ff:da[Na] Lost"
 *   - "Jan 18 14:54:45 EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da [Na] Discovery"
 *
 * Catatan: separator slot/onu pakai titik dua (`:`), bukan titik (`.`).
 */
// `(?:\s+\S+)?` di antara timestamp dan `EPON:` accommodates dua format input:
//   - Scraper (web UI log dump):  `Jan 18 14:53:57 EPON: ...`
//   - Syslog (UDP push):          `Jan 18 14:53:57 OLT-HOSTNAME EPON: ...`
// Hostname optional supaya satu regex meng-cover keduanya.
function parseHiosoLogMessage(line) {
    if (!line || typeof line !== 'string') return null;

    const dyingGaspMatch = line.match(/(\w+\s+\d+\s+[\d:]+)(?:\s+\S+)?\s+EPON:\s+Onu\s+([\d\/\:]+)\s+([a-f0-9:]+)\s+dying-gasp/i);
    if (dyingGaspMatch) {
        return {
            type: 'dying-gasp',
            timestamp: dyingGaspMatch[1],
            slot_onu: dyingGaspMatch[2],
            mac: normalizeMAC(dyingGaspMatch[3]),
        };
    }

    const lostMatch = line.match(/(\w+\s+\d+\s+[\d:]+)(?:\s+\S+)?\s+EPON:\s+Slot\s+([\d\/\:]+)\s+Onu\s+([a-f0-9:]+)\[.*?\]\s+Lost/i);
    if (lostMatch) {
        return {
            type: 'lost',
            timestamp: lostMatch[1],
            slot_onu: lostMatch[2],
            mac: normalizeMAC(lostMatch[3]),
        };
    }

    const discoveryMatch = line.match(/(\w+\s+\d+\s+[\d:]+)(?:\s+\S+)?\s+EPON:\s+Onu\s+([\d\/\:]+)\s+([a-f0-9:]+)\s+\[.*?\]\s+Discovery/i);
    if (discoveryMatch) {
        return {
            type: 'discovery',
            timestamp: discoveryMatch[1],
            slot_onu: discoveryMatch[2],
            mac: normalizeMAC(discoveryMatch[3]),
        };
    }

    return null;
}

/**
 * Parse `0/1/1:4` jadi `{ slot, onu }`.
 */
function parseSlotOnu(slotOnuStr) {
    if (!slotOnuStr) return { slot: null, onu: null };
    const match = String(slotOnuStr).match(/\d+\/\d+\/(\d+):(\d+)/);
    return match ? { slot: match[1], onu: match[2] } : { slot: null, onu: null };
}

/**
 * Parse Hioso syslog-style timestamp (`Jan 18 14:53:57`) jadi ms epoch.
 * RFC 3164 syslog tidak include year — assume `currentYear` kalau bulan ≤ now,
 * else `currentYear - 1` (handle wrap di Januari).
 */
function parseTimestamp(timestamp, currentYear = new Date().getFullYear()) {
    if (!timestamp || typeof timestamp !== 'string') return Date.now();
    // Pre-check format: `MMM DD HH:MM:SS` — Date.parse() terlalu permissive,
    // string acak bisa di-coerce ke past-date dan lolos check NaN.
    if (!/^\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}$/.test(timestamp.trim())) {
        return Date.now();
    }
    const parsed = Date.parse(`${timestamp} ${currentYear}`);
    if (Number.isNaN(parsed) || parsed <= 0) return Date.now();

    // Handle year wrap: kalau parsed > now + 1 hari, assume prev year (mis. Des log diparse Jan)
    const now = Date.now();
    if (parsed > now + 86_400_000) {
        const prevYear = Date.parse(`${timestamp} ${currentYear - 1}`);
        return Number.isNaN(prevYear) ? parsed : prevYear;
    }
    return parsed;
}

/**
 * Factory: bikin event correlator dengan state internal.
 *
 * GROUND TRUTH (tervalidasi via tes fisik di OLT Hioso EPON, Jun 2026):
 *   - DG (power cabut): ONU kirim "dying-gasp" lalu OLT log "Lost" di DETIK YANG SAMA.
 *   - LOS (fiber cabut): ONU masih hidup (punya listrik), tidak kirim gasp, cuma diam.
 *     OLT log "Lost" SAJA tanpa dying-gasp.
 *   - SNMP lastDownCause (.41) TIDAK membedakan keduanya di firmware ini — log
 *     satu-satunya sumber kebenaran.
 *
 * Karena DG & Lost simultan (delta 0-1 detik), di jalur realtime (syslog UDP) urutan
 * paket tidak dijamin. Kalau "Lost" diproses sebelum "dying-gasp", tanpa penanganan
 * kita salah vonis LOS padahal DG. Solusi: GRACE WINDOW.
 *
 * Dua mode:
 *   1. Sinkron (lostGraceMs = 0, default) — dipakai untuk SUMBER BATCH (scraper baca
 *      seluruh log sekaligus, dying-gasp & Lost pasti dua-duanya terlihat). ingest()
 *      return event langsung.
 *   2. Deferred (lostGraceMs > 0 + onEvent) — dipakai untuk SYSLOG realtime. Saat
 *      "Lost" tiba TANPA DG pending, tahan keputusan selama lostGraceMs; kalau DG
 *      menyusul → emit DG; kalau lewat grace tetap tak ada DG → emit LOS. Prinsip
 *      "tidak pernah emit klasifikasi yang salah". Event dikirim via callback onEvent.
 *      Catatan: kasus normal (DG dulu baru Lost) TIDAK kena delay — langsung DG.
 *      Hanya kasus Lost-tanpa-DG (true LOS atau reorder) yang ditahan ~grace.
 *
 * Cleanup: tiap ingest, hapus entry pendingDg yang sudah > dgTtlMs.
 */
function createEventCorrelator(options = {}) {
    const correlationWindowMs = options.correlationWindowMs || DEFAULT_CORRELATION_WINDOW_MS;
    const dgTtlMs = options.dgTtlMs || DEFAULT_DG_TTL_MS;
    const source = options.source || 'unknown';
    const lostGraceMs = Number.isFinite(options.lostGraceMs) ? options.lostGraceMs : 0;
    const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
    // Timer injectable untuk test (default global).
    const setTimer = options.setTimeoutFn || setTimeout;
    const clearTimer = options.clearTimeoutFn || clearTimeout;
    const deferEnabled = lostGraceMs > 0 && !!onEvent;

    const pendingDg = new Map();   // mac → timestampMs DG menunggu Lost
    const pendingLost = new Map(); // mac → { timer, ts, parsed, meta } Lost menunggu konfirmasi (grace)

    function pruneStaleDg(nowMs) {
        for (const [mac, ts] of pendingDg.entries()) {
            if (nowMs - ts > dgTtlMs) {
                pendingDg.delete(mac);
            }
        }
    }

    function buildOfflineEvent(parsed, ts, classification, meta) {
        const { slot, onu } = parseSlotOnu(parsed.slot_onu);
        return {
            mac: parsed.mac,
            slot,
            onu,
            event_type: classification,
            timestamp: new Date(ts).toISOString(),
            source,
            correlated_with_dg: classification === 'dying-gasp',
            server_time: new Date().toISOString(),
            ...(meta || {}),
        };
    }

    function ingest(parsed, eventTimestampMs, meta) {
        if (!parsed || !parsed.mac) return null;
        const ts = Number.isFinite(eventTimestampMs) ? eventTimestampMs : Date.now();
        pruneStaleDg(ts);

        if (parsed.type === 'dying-gasp') {
            // Kalau ada Lost yang sedang ditahan (grace) untuk MAC ini → reorder:
            // Lost datang duluan, sekarang DG menyusul. Batalkan timer LOS, emit DG.
            const waiting = pendingLost.get(parsed.mac);
            if (waiting) {
                clearTimer(waiting.timer);
                pendingLost.delete(parsed.mac);
                const event = buildOfflineEvent(waiting.parsed, waiting.ts, 'dying-gasp', waiting.meta);
                if (onEvent) onEvent(event);
                return null;
            }
            // Normal: simpan, tunggu Lost.
            pendingDg.set(parsed.mac, ts);
            return null;
        }

        if (parsed.type === 'lost') {
            const dgTs = pendingDg.get(parsed.mac);
            if (dgTs !== undefined && ts >= dgTs && (ts - dgTs) <= correlationWindowMs) {
                // Kasus normal: DG sudah ada → DG. Sinkron, tanpa delay.
                pendingDg.delete(parsed.mac);
                return buildOfflineEvent(parsed, ts, 'dying-gasp', meta);
            }

            // Lost tanpa DG pending.
            if (deferEnabled) {
                // Tahan keputusan — beri kesempatan DG menyusul (reorder/simultan).
                const existing = pendingLost.get(parsed.mac);
                if (existing) clearTimer(existing.timer);
                const timer = setTimer(() => {
                    pendingLost.delete(parsed.mac);
                    onEvent(buildOfflineEvent(parsed, ts, 'los', meta));
                }, lostGraceMs);
                if (timer && typeof timer.unref === 'function') timer.unref();
                pendingLost.set(parsed.mac, { timer, ts, parsed, meta });
                return null;
            }

            // Mode sinkron (scraper/batch): langsung LOS.
            return buildOfflineEvent(parsed, ts, 'los', meta);
        }

        if (parsed.type === 'discovery') {
            // Recovery — bersihkan pending DG & Lost (batalkan timer grace).
            pendingDg.delete(parsed.mac);
            const waiting = pendingLost.get(parsed.mac);
            if (waiting) { clearTimer(waiting.timer); pendingLost.delete(parsed.mac); }
            return buildOfflineEvent(parsed, ts, 'discovery', meta);
        }

        return null;
    }

    return {
        ingest,
        // Diekspos untuk debug + test.
        _state: () => ({
            pendingDgCount: pendingDg.size,
            pendingDgMacs: [...pendingDg.keys()],
            pendingLostCount: pendingLost.size,
            pendingLostMacs: [...pendingLost.keys()],
        }),
    };
}

// Base confidence per event_type. event_type sendiri ditentukan oleh korelasi
// syslog (authoritative untuk LABEL) — confidence ini soal SEBERAPA YAKIN label
// itu benar, bukan menentukan label.
const BASE_CONFIDENCE = {
    'dying-gasp': 0.85, // kita literally lihat pesan "dying-gasp" sebelum Lost
    'los': 0.6,         // Lost tanpa DG — bisa jadi packet DG hilang di UDP transit
    'discovery': 1.0,   // recovery tidak ambigu
};

const OPPOSITE_TYPE = { 'dying-gasp': 'los', 'los': 'dying-gasp' };

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Bangun sinyal primer dari hasil korelasi syslog. Ini sinyal "utama" yang
 * sudah menentukan event_type; bobotnya implisit di BASE_CONFIDENCE.
 */
function buildSyslogSignal(eventType, correlatedWithDg) {
    if (eventType === 'dying-gasp') {
        return {
            source: 'syslog',
            indicator: 'dying-gasp-then-lost',
            hint: 'dying-gasp',
            weight: 0,
            reason: 'Pesan dying-gasp terlihat sebelum Lost dalam window korelasi.',
        };
    }
    if (eventType === 'los') {
        return {
            source: 'syslog',
            indicator: correlatedWithDg ? 'lost-after-dg' : 'lost-without-dying-gasp',
            hint: 'los',
            weight: 0,
            reason: 'Lost tanpa pesan dying-gasp mendahului — indikasi kehilangan sinyal langsung.',
        };
    }
    return {
        source: 'syslog',
        indicator: 'discovery',
        hint: 'neutral',
        weight: 0,
        reason: 'ONU kembali online (Discovery).',
    };
}

/**
 * Hitung confidence akhir untuk sebuah event berdasarkan event_type (dari
 * korelasi syslog) + sinyal pendukung (mis. rxPower).
 *
 * Sinyal yang SETUJU dengan event_type menaikkan confidence sebesar weight-nya.
 * Sinyal yang BERTENTANGAN menurunkan setengah weight-nya (flag ambiguitas,
 * tidak meng-override label). Clamp [0.3, 0.99].
 *
 * @param {string} eventType - 'dying-gasp' | 'los' | 'discovery'
 * @param {object} options
 * @param {boolean} options.correlatedWithDg
 * @param {Array} options.extraSignals - mis. [rxPowerSignal]
 * @returns {{ confidence:number, signals:Array }}
 */
function scoreEventConfidence(eventType, options = {}) {
    const correlatedWithDg = options.correlatedWithDg === true;
    const extraSignals = Array.isArray(options.extraSignals) ? options.extraSignals : [];

    const base = BASE_CONFIDENCE[eventType] ?? 0.5;
    const syslogSignal = buildSyslogSignal(eventType, correlatedWithDg);
    const signals = [syslogSignal, ...extraSignals];

    if (eventType === 'discovery') {
        return { confidence: base, signals };
    }

    let confidence = base;
    const opposite = OPPOSITE_TYPE[eventType];
    for (const sig of extraSignals) {
        if (!sig || typeof sig.weight !== 'number') continue;
        if (sig.hint === eventType) {
            confidence += sig.weight;
        } else if (sig.hint === opposite) {
            confidence -= sig.weight * 0.5;
        }
        // hint 'neutral' → tidak berpengaruh
    }

    return { confidence: clamp(confidence, 0.3, 0.99), signals };
}

module.exports = {
    normalizeMAC,
    parseHiosoLogMessage,
    parseSlotOnu,
    parseTimestamp,
    createEventCorrelator,
    scoreEventConfidence,
    buildSyslogSignal,
    DEFAULT_CORRELATION_WINDOW_MS,
    DEFAULT_DG_TTL_MS,
};
