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
 * Usage:
 *   const correlator = createEventCorrelator();
 *   // Tiap line yang berhasil diparse:
 *   const event = correlator.ingest(parsed, eventTimestampMs);
 *   if (event) writeToStorage(event); // event sudah ter-correlate (dg/los/discovery)
 *
 * Behaviour:
 *   - DG ingest → simpan ke `pendingDg`, RETURN null (belum bisa decide tanpa Lost)
 *   - Lost ingest → cek pendingDg untuk MAC sama dalam window → emit event
 *   - Discovery ingest → emit recovery event langsung
 *
 * Cleanup: tiap ingest, hapus entry pendingDg yang sudah > dgTtlMs.
 */
function createEventCorrelator(options = {}) {
    const correlationWindowMs = options.correlationWindowMs || DEFAULT_CORRELATION_WINDOW_MS;
    const dgTtlMs = options.dgTtlMs || DEFAULT_DG_TTL_MS;
    const source = options.source || 'unknown';

    const pendingDg = new Map(); // mac → timestampMs

    function pruneStaleDg(nowMs) {
        for (const [mac, ts] of pendingDg.entries()) {
            if (nowMs - ts > dgTtlMs) {
                pendingDg.delete(mac);
            }
        }
    }

    function ingest(parsed, eventTimestampMs) {
        if (!parsed || !parsed.mac) return null;
        const ts = Number.isFinite(eventTimestampMs) ? eventTimestampMs : Date.now();
        pruneStaleDg(ts);

        if (parsed.type === 'dying-gasp') {
            // Pending — tunggu Lost untuk correlate.
            pendingDg.set(parsed.mac, ts);
            return null;
        }

        if (parsed.type === 'lost') {
            const dgTs = pendingDg.get(parsed.mac);
            let classification = 'los';
            if (dgTs !== undefined && ts >= dgTs && (ts - dgTs) <= correlationWindowMs) {
                classification = 'dying-gasp';
                pendingDg.delete(parsed.mac);
            }
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
            };
        }

        if (parsed.type === 'discovery') {
            const { slot, onu } = parseSlotOnu(parsed.slot_onu);
            // Recovery — sekalian clear pending DG kalau ada.
            pendingDg.delete(parsed.mac);
            return {
                mac: parsed.mac,
                slot,
                onu,
                event_type: 'discovery',
                timestamp: new Date(ts).toISOString(),
                source,
                server_time: new Date().toISOString(),
            };
        }

        return null;
    }

    return {
        ingest,
        // Diekspos untuk debug + test.
        _state: () => ({
            pendingDgCount: pendingDg.size,
            pendingDgMacs: [...pendingDg.keys()],
        }),
    };
}

module.exports = {
    normalizeMAC,
    parseHiosoLogMessage,
    parseSlotOnu,
    parseTimestamp,
    createEventCorrelator,
    DEFAULT_CORRELATION_WINDOW_MS,
    DEFAULT_DG_TTL_MS,
};
