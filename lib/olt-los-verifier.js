/**
 * Header Doc
 * Purpose: Verifikasi OTORITATIF klasifikasi LOS via SCRAPE web log OLT sebelum broadcaster
 *          benar-benar mem-broadcast/membuat tiket. Syslog (UDP) bisa salah-vonis DG→LOS saat
 *          MATI LISTRIK SERENTAK (paket `dying-gasp` drop di transit) — web log OLT menyimpan
 *          `dying-gasp`+`Lost` permanen (kebal packet-loss), jadi jadi sumber kebenaran.
 *          PRINSIP AMAN: HANYA membuang LOS yang web-log SECARA EKSPLISIT membuktikan DG;
 *          selain itu (los / scrape gagal / tak ketemu) → biarkan lanjut (fallback ke syslog).
 * Caller: `lib/olt-los-broadcaster.js` (broadcastGroup → verifyLosBatch sebelum kirim/tiket).
 * Deps: `lib/olt-log-scraper` (fetchOltLog/processLog/normalizeMAC/isScraperBusy — reuse),
 *       `lib/olt-manager` (getOltDevices → host+kredensial web), `global.config.oltLosBroadcast.verifyViaScrape`.
 * MainFuncs: `verifyLosBatch(macList, opts)` — return Map<mac,'los'|'dying-gasp'|'unknown'>,
 *            plus properti `.areaDgClusterByMac` (Map<mac, jumlah ONU tetangga yg dying-gasp
 *            serentak di ±windowSeconds dari Lost target) → sinyal MATI-LISTRIK-AREA untuk gerbang
 *            broadcaster (LOS di tengah klaster DG = kolateral mati listrik, bukan fiber putus).
 * SideEffects: HTTP GET ke web OLT (sys_log_page.asp, Basic auth). NEVER-THROW & fire-safe —
 *              kegagalan verifikasi TAK boleh menjatuhkan deteksi/broadcast LOS (fallback aman).
 */
"use strict";

const DEFAULTS = {
    enabled: true,          // aktif; degrade otomatis kalau tak ada device web OLT terkonfigurasi
    maxPages: 20,           // baca dalam saat burst (mati listrik massal) — sesuai kebutuhan lapangan
    timeWindowMinutes: 15,  // cakup window konfirmasi (default 3m) + tepi burst
    // Deteksi mati-listrik-area: jendela korelasi klaster dying-gasp tetangga (satu lokasi config
    // dengan gerbang broadcaster: config.oltLosBroadcast.verifyViaScrape.areaOutage).
    areaOutage: { windowSeconds: 10 },
};

function getCfg() {
    const lb = (global.config && global.config.oltLosBroadcast) || {};
    return { ...DEFAULTS, ...(lb.verifyViaScrape || {}) };
}

function isEnabled() {
    return getCfg().enabled !== false;
}

/**
 * Verifikasi sekumpulan MAC (yang syslog vonis LOS) terhadap web log OLT.
 * Return Map<macAsel, 'los'|'dying-gasp'|'unknown'>:
 *   - 'dying-gasp' → web log BUKTIKAN ini mati listrik (DG) → pemanggil HARUS membuang.
 *   - 'los'        → web log konfirmasi fiber putus → lanjut.
 *   - 'unknown'    → tak bisa dipastikan (scrape gagal/busy/tak ketemu) → pemanggil lanjut (fallback).
 * NEVER-THROW. Jika fitur nonaktif / tak ada device → semua 'unknown' (tanpa efek).
 *
 * deps (opsional, untuk test): { getScraper, getOltManager, getConfig, logger }
 */
async function verifyLosBatch(macList, deps = {}) {
    const macs = Array.isArray(macList) ? macList.map((m) => String(m)).filter(Boolean) : [];
    const result = new Map();
    // Sinyal mati-listrik-area: MAC-asli → jumlah ONU tetangga yang dying-gasp serentak di sekitar
    // Lost target. Ditempel di result (properti, tak ganggu .get/.entries) supaya broadcaster bisa
    // menyaring LOS yang sebenarnya kolateral mati listrik. Selalu ADA (default kosong = fail-open).
    const areaDgClusterByMac = new Map();
    result.areaDgClusterByMac = areaDgClusterByMac;
    for (const m of macs) result.set(m, "unknown");
    if (!macs.length) return result;

    const logger = deps.logger || console;
    try {
        const cfg = (deps.getConfig || getCfg)();
        if (cfg.enabled === false) return result; // fitur off → semua unknown (fallback, tanpa scrape)

        const scraper = deps.getScraper ? deps.getScraper() : require("./olt-log-scraper");
        const oltManager = deps.getOltManager ? deps.getOltManager() : require("./olt-manager");
        const classifier = deps.getClassifier ? deps.getClassifier() : require("./olt-event-classifier");
        const normalizeMAC = scraper.normalizeMAC || ((x) => String(x || "").replace(/[^0-9a-f]/gi, "").toUpperCase());
        const areaDgWindowMs = (Number(cfg.areaOutage && cfg.areaOutage.windowSeconds) || DEFAULTS.areaOutage.windowSeconds) * 1000;

        // Guard anti-tabrakan: kalau siklus scraper periodik sedang jalan, jangan ikut nge-fetch
        // OLT yang sama (httpd single-client) → pilih fallback (unknown) daripada bikin ECONNREFUSED.
        if (typeof scraper.isScraperBusy === "function" && scraper.isScraperBusy()) {
            logger.log && logger.log("[LOS-VERIFY] Scraper periodik sedang jalan — lewati verify (fallback).");
            return result;
        }

        const devices = (oltManager.getOltDevices && oltManager.getOltDevices()) || [];
        if (!devices.length) return result; // tak ada device web OLT → fallback (mis. bot tanpa config.olt.devices)

        const maxPages = Number(cfg.maxPages) || DEFAULTS.maxPages;
        const timeWindowMinutes = Number(cfg.timeWindowMinutes) || DEFAULTS.timeWindowMinutes;

        // Peta MAC-ternormalisasi → MAC-asli (incident) supaya hasil bisa dipetakan balik.
        const wantByNorm = new Map();
        for (const m of macs) wantByNorm.set(normalizeMAC(m), m);

        // Scrape tiap OLT, korelasi (processLog = sortir kronologis + DG↔Lost), cek target.
        // Berhenti dini begitu semua target sudah ditemukan.
        let anyScraped = false;
        for (const dev of devices) {
            if (result.size && [...result.values()].every((v) => v !== "unknown")) break;
            const host = dev.host || dev.ip;
            const user = dev.webUsername || dev.username || cfg.username;
            const pass = dev.webPassword || dev.password || cfg.password;
            if (!host || !user) continue;

            const webPort = dev.webPort || dev.port || cfg.webPort; // OLT web bisa di port non-standar (:81/:82)
            let lines = null;
            try {
                lines = await scraper.fetchOltLog(host, user, pass, maxPages, timeWindowMinutes, null, webPort);
            } catch (e) {
                logger.warn && logger.warn(`[LOS-VERIFY] fetch web log ${host} gagal: ${e && e.message} — coba OLT lain.`);
                continue;
            }
            anyScraped = true;
            const events = {};
            try {
                scraper.processLog(lines, events, timeWindowMinutes, {});
            } catch (e) {
                logger.warn && logger.warn(`[LOS-VERIFY] processLog ${host} gagal: ${e && e.message}`);
                continue;
            }

            // KLASTER dying-gasp di sekitar Lost tiap target = sinyal MATI-LISTRIK-AREA. Dihitung
            // dari baris mentah (intra-log, jam OLT sama → kebal drift). Simpan MAX lintas OLT.
            try {
                const parsedLines = [];
                for (const ln of lines) {
                    const p = classifier.parseHiosoLogMessage(ln);
                    if (!p) continue;
                    const ms = classifier.parseTimestamp(p.timestamp);
                    if (!Number.isFinite(ms)) continue;
                    parsedLines.push({ type: p.type, mac: p.mac, ms });
                }
                const dgEvents = parsedLines.filter((p) => p.type === "dying-gasp");
                if (dgEvents.length) {
                    for (const [norm, origMac] of wantByNorm) {
                        const losts = parsedLines.filter((p) => p.mac === norm && p.type === "lost").map((p) => p.ms);
                        if (!losts.length) continue;
                        const anchor = Math.max(...losts); // Lost paling baru target (momen tumbang)
                        const neighbors = new Set();
                        for (const d of dgEvents) {
                            if (d.mac !== norm && Math.abs(d.ms - anchor) <= areaDgWindowMs) neighbors.add(d.mac);
                        }
                        const prev = areaDgClusterByMac.get(origMac) || 0;
                        if (neighbors.size > prev) areaDgClusterByMac.set(origMac, neighbors.size);
                    }
                }
            } catch (e) {
                logger.warn && logger.warn(`[LOS-VERIFY] hitung klaster DG ${host} gagal: ${e && e.message}`);
            }

            for (const [norm, origMac] of wantByNorm) {
                if (result.get(origMac) !== "unknown") continue; // sudah dipastikan dari OLT lain
                const ev = events[norm];
                if (ev && (ev.event_type === "dying-gasp" || ev.event_type === "los")) {
                    result.set(origMac, ev.event_type);
                }
                // ev absen di OLT ini → biarkan 'unknown' (mungkin di OLT lain / sudah Discovery).
            }
        }

        if (!anyScraped) {
            logger.warn && logger.warn("[LOS-VERIFY] Tak satupun OLT bisa di-scrape — fallback (semua unknown).");
        }
    } catch (err) {
        (deps.logger || console).error &&
            (deps.logger || console).error("[LOS-VERIFY] verifyLosBatch error:", err && err.message);
        // biarkan sisa 'unknown' — fallback aman
    }
    return result;
}

module.exports = { verifyLosBatch, isEnabled, DEFAULTS };
