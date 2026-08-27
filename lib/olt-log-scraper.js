/**
 * OLT Log Scraper
 * Scrape log dari web interface OLT HIOSO untuk deteksi LOS vs Dying Gasp
 * 
 * Logika:
 * - Dying Gasp: Ada log "dying-gasp" sebelum "Lost"
 * - LOS: Hanya ada log "Lost" tanpa "dying-gasp"
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const oltManager = require('./olt-manager');
const {
    parseHiosoLogMessage: classifierParseLog,
    parseSlotOnu: classifierParseSlotOnu,
    parseTimestamp: _classifierParseTimestamp,
    normalizeMAC: classifierNormalizeMAC,
} = require('./olt-event-classifier');
const losBroadcaster = require('./olt-los-broadcaster');
const oltEventLog = require('./olt-event-logger');

// File untuk menyimpan event ONT
const OLT_EVENTS_FILE = path.join(__dirname, '..', 'database', 'olt-events.json');

// Interval scraping default (1 menit = 60000 ms)
const DEFAULT_SCRAPE_INTERVAL = 60000;

// Retensi data (2 hari dalam ms)
const DATA_RETENTION = 2 * 24 * 60 * 60 * 1000;

// Kedalaman halaman scraping. Penentu UTAMA adalah stop ADAPTIF (jendela waktu) di
// fetchOltLog; konstanta ini hanya batas. MIN mencegah cap stale (mis. config lama=3)
// melumpuhkan pembacaan saat mass-outage (dying-gasp terdorong ke halaman lebih lama).
// MAX = backstop keras supaya burst ekstrem tak baca tanpa henti.
// TERUKUR (Tanjungharjo 2026-08-27): satu halaman penuh = 20 baris, dan scrape pertama
// MENGHABISKAN cap 15 halaman (263 baris) dengan halaman terakhir masih penuh — artinya
// terpotong, bukan selesai. Hitungan kasus terburuk: mati listrik seluruh area (99 ONU)
// menghasilkan 99 dying-gasp + 99 Lost = 198 baris, plus discovery saat pulih ~297 baris.
//
// !! Yang tergulung DULUAN justru baris DYING-GASP-nya — ia lebih tua dari baris "Lost"
// milik ONU yang sama. Begitu DG-nya tak terbaca, vonisnya jatuh ke LOS: "fiber putus"
// untuk kejadian yang sebenarnya mati listrik, dan teknisi dikirim sia-sia.
const DEFAULT_LOG_PAGES = 30;
const MIN_LOG_PAGES = 25;      // 25 x 20 = 500 baris — di atas kasus terburuk 297
const MAX_LOG_PAGES_HARD = 60; // backstop; 1.200 baris

// High-water-mark (HWM) reconciliation: simpan timestamp event TERBARU yang sudah
// diproses per-OLT (dalam JAM OLT, ms). Scrape berikutnya hanya memproses event yang
// LEBIH BARU dari HWM — apa pun umurnya. Inilah yang memulihkan event yang sempat HILANG
// dari syslog saat link down (mis. radio TNJ naik-turun), tanpa terbentur filter jendela-
// waktu (10 mnt) yang dulu membuang event lama. Patokan = per-event, bukan per-waktu.
// Karena HWM & log sama-sama jam OLT, perbandingan kebal drift jam server/OLT.
const OLT_HWM_FILE = path.join(__dirname, '..', 'database', 'olt-scrape-hwm.json');
// Bila event TERBARU jauh lebih tua dari HWM (mis. jam OLT reset mundur usai reboot),
// jangan terjebak skip-semua: anggap reset jam → fallback ke jendela-waktu untuk siklus ini.
const CLOCK_RESET_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// Scraper state
let scraperInterval = null;
let isRunning = false;
let isScraping = false; // guard anti-overlap: cegah 2 siklus jalan barengan (lihat scrapeOltLog)
let lastScrapeTime = null;
let lastError = null;
let currentInterval = DEFAULT_SCRAPE_INTERVAL;
let lastSuccessAt = null;
const deviceHealthState = new Map();

const FAILURE_THRESHOLD_UNREACHABLE = 3;
const BACKOFF_STEPS_MS = [0, 120000, 300000, 600000];

function getBackoffDelay(failureCount) {
    const index = Math.min(Math.max(failureCount - 1, 0), BACKOFF_STEPS_MS.length - 1);
    return BACKOFF_STEPS_MS[index];
}

function getDefaultDeviceState(olt) {
    return {
        olt_id: olt.id,
        olt_name: olt.name,
        olt_host: olt.host,
        status: 'healthy',
        failure_count: 0,
        last_error: null,
        last_scrape_at: null,
        last_success_at: null,
        next_retry_at: null
    };
}

function getDeviceState(olt) {
    if (!deviceHealthState.has(olt.id)) {
        deviceHealthState.set(olt.id, getDefaultDeviceState(olt));
    }
    return deviceHealthState.get(olt.id);
}

function markDeviceHealthy(olt) {
    const previous = getDeviceState(olt);
    const next = {
        ...previous,
        status: 'healthy',
        failure_count: 0,
        last_error: null,
        last_scrape_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        next_retry_at: null
    };
    deviceHealthState.set(olt.id, next);
    return previous.status !== next.status;
}

function markDeviceFailure(olt, errorMessage) {
    const previous = getDeviceState(olt);
    const failureCount = previous.failure_count + 1;
    const status = failureCount >= FAILURE_THRESHOLD_UNREACHABLE ? 'unreachable' : 'degraded';
    const nextRetryAt = new Date(Date.now() + getBackoffDelay(failureCount)).toISOString();
    const next = {
        ...previous,
        status,
        failure_count: failureCount,
        last_error: errorMessage,
        last_scrape_at: new Date().toISOString(),
        next_retry_at: nextRetryAt
    };
    deviceHealthState.set(olt.id, next);
    return previous.status !== next.status || previous.last_error !== errorMessage;
}

function shouldSkipDeviceScrape(olt) {
    const state = getDeviceState(olt);
    if (!state.next_retry_at) {
        return false;
    }

    return new Date(state.next_retry_at).getTime() > Date.now();
}

// Host belum dikonfigurasi (kosong atau masih placeholder template "ISI_...").
// Hindari spam error getaddrinfo EAI_AGAIN tiap interval saat config belum diisi.
function hasUnconfiguredHost(olt) {
    const host = String((olt && olt.host) || '').trim();
    return host === '' || host.startsWith('ISI_');
}

// Apakah device ini butuh web-scrape (HIOSO EPON) atau tidak (mis. ZTE GPON yang
// lapor status via SNMP)? Capability dari driver. Default true demi backward-compat
// (bila registry/resolusi gagal, perlakukan seperti HIOSO lama).
function deviceNeedsWebScrape(olt) {
    try {
        const drv = require('./olt-drivers').resolveDriver(olt);
        return !drv || !drv.capabilities || drv.capabilities.needsWebScrape !== false;
    } catch (__e) {
        return true;
    }
}

function getDeviceStatuses() {
    return Array.from(deviceHealthState.values()).map(state => ({ ...state }));
}

function resetDeviceStatuses() {
    deviceHealthState.clear();
}

/**
 * Load events dari file
 */
function loadEvents() {
    try {
        if (fs.existsSync(OLT_EVENTS_FILE)) {
            return JSON.parse(fs.readFileSync(OLT_EVENTS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[OLT-Scraper] Error loading events:', e.message);
    }
    return {};
}

/**
 * Save events ke file
 */
function saveEvents(events) {
    try {
        fs.writeFileSync(OLT_EVENTS_FILE, JSON.stringify(events, null, 2), 'utf8');
    } catch (e) {
        console.error('[OLT-Scraper] Error saving events:', e.message);
    }
}

/**
 * Load HWM (high-water-mark) per-OLT dari file.
 * Shape: { [oltId]: { tsMs, iso, updatedAt } }
 */
function loadHwm() {
    try {
        if (fs.existsSync(OLT_HWM_FILE)) {
            return JSON.parse(fs.readFileSync(OLT_HWM_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[OLT-Scraper] Error loading HWM:', e.message);
    }
    return {};
}

/**
 * Save HWM per-OLT ke file.
 */
function saveHwm(hwm) {
    try {
        fs.writeFileSync(OLT_HWM_FILE, JSON.stringify(hwm, null, 2), 'utf8');
    } catch (e) {
        console.error('[OLT-Scraper] Error saving HWM:', e.message);
    }
}

/**
 * Edge-trigger LOS broadcaster dari hasil scrape.
 *
 * Scraper bersifat poll (re-derive seluruh state tiap cycle), jadi LOS yang sama
 * muncul berulang. Untuk meniru semantik push syslog (1 broadcast / insiden), kita
 * hanya kirim event saat ada TRANSISI:
 *   - MAC menjadi 'los' (sebelumnya tidak ada / bukan los) → handleOltEvent(los)
 *   - MAC 'los'/'dying-gasp' menghilang (pulih / dihapus discovery) → handleOltEvent(discovery)
 * Broadcaster sendiri yang menerapkan confirmation window, dedup, cooldown, cluster.
 */
function dispatchLosTransitions(prevEventTypes, currentEvents) {
    // LOS baru muncul.
    for (const mac of Object.keys(currentEvents)) {
        const ev = currentEvents[mac];
        if (!ev || ev.event_type !== 'los') continue;
        if (prevEventTypes[mac] === 'los') continue; // sudah dilaporkan cycle lalu
        losBroadcaster.handleOltEvent({
            mac: ev.mac,
            event_type: 'los',
            slot: ev.slot,
            onu: ev.onu,
            olt_id: ev.olt_id || null,
            // classification_confidence sengaja kosong → broadcaster pakai default lolos,
            // karena scraper sudah secara eksplisit mengklasifikasikan 'los' (bukan dying-gasp).
        });
        // Log durable (backstop scraper) — dedup berbasis-state cegah ganda dgn syslog.
        oltEventLog.recordOltEventSafe({ mac: ev.mac, event_type: 'los', slot: ev.slot, onu: ev.onu, olt_id: ev.olt_id || null, source: 'scrape' });
    }
    // Recovery: MAC offline sebelumnya kini hilang → batalkan pending broadcast.
    for (const mac of Object.keys(prevEventTypes)) {
        const wasOffline = prevEventTypes[mac] === 'los' || prevEventTypes[mac] === 'dying-gasp';
        if (wasOffline && !currentEvents[mac]) {
            losBroadcaster.handleOltEvent({ mac, event_type: 'discovery' });
            oltEventLog.recordOltEventSafe({ mac, event_type: 'discovery', source: 'scrape' });
        }
    }
}

/**
 * Cleanup old events (lebih dari 2 hari)
 */
function cleanupOldEvents(events) {
    const now = Date.now();
    let cleaned = 0;
    
    Object.keys(events).forEach(mac => {
        const event = events[mac];
        const eventTime = new Date(event.timestamp).getTime();
        if (now - eventTime > DATA_RETENTION) {
            delete events[mac];
            cleaned++;
        }
    });
    
    if (cleaned > 0) {
        console.log(`[OLT-Scraper] Cleaned ${cleaned} old events`);
    }
    
    return events;
}

// Delegasi ke lib/olt-event-classifier.js — single source of truth untuk parsing
// dipakai bersama oleh syslog receiver. Kalau format Hioso firmware berubah,
// fix di classifier.
function normalizeMAC(mac) {
    return classifierNormalizeMAC(mac);
}

function parseLogLine(line) {
    const parsed = classifierParseLog(line);
    if (parsed && process.env.DEBUG_OLT_SCRAPER === 'true') {
        console.log(`[OLT-Scraper DEBUG] Parsed ${parsed.type}:`, parsed);
    }
    return parsed;
}

function parseSlotOnu(slotOnuStr) {
    return classifierParseSlotOnu(slotOnuStr);
}

// Ekstrak timestamp pertama sebuah baris log → ms epoch (untuk stop adaptif & sortir).
function lineTimestampMs(line, year = new Date().getFullYear()) {
    const m = String(line).match(/(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})/);
    if (!m) return null;
    const ms = new Date(parseTimestamp(m[1], year)).getTime();
    return Number.isNaN(ms) ? null : ms;
}

// Urutkan baris log KRONOLOGIS (ascending). Web log Hioso dipaginasi newest-page-first,
// jadi tanpa sortir baris "Lost" (lebih baru) bisa diproses SEBELUM "dying-gasp"
// pasangannya yang ada di halaman lebih lama → salah vonis LOS saat mass outage.
// Tie-break dying-gasp(0) < lost(1) < discovery(2) agar pasangan DG→Lost di DETIK
// YANG SAMA (ground-truth Hioso) tetap urut benar.
const LOG_TYPE_RANK = { 'dying-gasp': 0, 'lost': 1, 'discovery': 2 };
function sortLogLinesChronologically(lines) {
    const year = new Date().getFullYear();
    return [...(lines || [])]
        .map((line) => {
            const parsed = parseLogLine(line);
            const tsMs = lineTimestampMs(line, year);
            return { line, tsMs: tsMs === null ? 0 : tsMs, rank: parsed ? (LOG_TYPE_RANK[parsed.type] ?? 9) : 9 };
        })
        .sort((a, b) => (a.tsMs - b.tsMs) || (a.rank - b.rank))
        .map((x) => x.line);
}

/**
 * Fetch log dari web OLT dengan KEDALAMAN ADAPTIF.
 * PENTING: Log ada di sys_log_page.asp?page=N (page 0 = TERBARU, page naik = makin lama).
 *
 * Saat mass outage (mati total), ratusan ONU memuntahkan dying-gasp+Lost serempak; baris
 * "Lost" (lebih baru) menempati halaman awal, "dying-gasp" pasangannya terdorong ke halaman
 * lebih lama. Cap tetap (dulu 3) → DG terkubur di luar jendela baca → salah vonis LOS.
 * Solusi: baca terus selama masih ada event dalam jendela korelasi (timeWindow), berhenti
 * begitu halaman seluruhnya lebih tua dari window. Dibatasi cap keras demi keamanan.
 */
async function fetchOltLog(host, username, password, maxPages = 3, timeWindowMinutes = 10, hwmMs = null, port = 80) {
    // Floor cap: nilai stale (mis. 3) jangan melumpuhkan baca saat burst — stop ADAPTIF
    // (HWM jika ada, jika tidak jendela waktu, di akhir loop) yang jadi penentu utama kedalaman.
    const cap = Math.min(MAX_LOG_PAGES_HARD, Math.max(MIN_LOG_PAGES, Number(maxPages) || DEFAULT_LOG_PAGES));
    const useHwm = Number.isFinite(hwmMs);
    const windowMs = Math.max(1, Number(timeWindowMinutes) || 10) * 60_000;
    const slackMs = 60_000; // toleransi clock-skew & tepi burst
    const year = new Date().getFullYear();
    const allLines = [];
    let mostRecentMs = null;
    
    let halamanTerbaca = 0;
    let alasanBerhenti = "cap";      // "buffer-habis" | "hwm" | "jendela" | "cap" | "error"
    let tertuaTerbacaMs = null;      // stempel (JAM OLT) baris tertua yang sempat kita baca
    for (let page = 0; page < cap; page++) {
        try {
            const { body: html } = await fetchOltLogPage(host, username, password, page, port);
            const lines = extractLogLines(html);
            
            if (lines.length === 0) {
                // Buffer log OLT-nya yang habis — bukan kita yang berhenti.
                alasanBerhenti = "buffer-habis";
                console.log(`[OLT-Scraper] No more logs at page ${page}, stopping`);
                break;
            }
            
            allLines.push(...lines);
            halamanTerbaca = page + 1;
            console.log(`[OLT-Scraper] Page ${page}: ${lines.length} log lines`);
            
            // Stop ADAPTIF: kalau seluruh halaman ini sudah lebih tua dari (event TERBARU
            // − window − slack), halaman berikutnya pasti lebih tua lagi → cukup. Efeknya:
            // saat burst (semua event sedetik) baca DALAM hingga seluruh window tertangkap;
            // saat normal (event jarang) berhenti cepat (1-2 halaman). Buffer tahan berhari-
            // hari jadi membaca lebih dalam saat insiden aman (event tak ke-rotasi keluar).
            const tsList = lines.map((l) => lineTimestampMs(l, year)).filter((v) => v !== null);
            if (tsList.length > 0) {
                const pageNewest = Math.max(...tsList);
                const pageOldest = Math.min(...tsList);
                if (mostRecentMs === null) mostRecentMs = pageNewest;
                if (tertuaTerbacaMs === null || pageOldest < tertuaTerbacaMs) tertuaTerbacaMs = pageOldest;
                if (useHwm) {
                    // Mode HWM: berhenti begitu halaman ini sudah menjangkau event yang
                    // PERNAH diproses (pageOldest <= HWM) → halaman berikutnya pasti
                    // seluruhnya sudah dilihat. Efeknya kedalaman baca = sebesar GAP sejak
                    // scrape terakhir (pulihkan celah radio), dibatasi cap keras.
                    if (pageOldest <= hwmMs) { alasanBerhenti = "hwm"; break; }
                } else if (pageOldest < mostRecentMs - windowMs - slackMs) {
                    alasanBerhenti = "jendela";
                    // Mode jendela-waktu (bootstrap/no-HWM): stop adaptif lama.
                    break;
                }
            }
            
        } catch (error) {
            console.error(`[OLT-Scraper] Error fetching page ${page}:`, error.message);
            if (page === 0) {
                // Jika page pertama error, throw error
                throw error;
            }
            // Jika page berikutnya error, stop tapi return yang sudah didapat
            break;
        }
    }
    
    // !! CELAH DATA: kalau kita sudah membaca sampai buffer OLT HABIS tapi baris tertua yang
    // sempat terbaca MASIH lebih baru dari HWM, berarti ada kejadian di antara keduanya yang
    // sudah DITIMPA di OLT — hilang untuk selamanya, bukan sekadar belum dibaca.
    //
    // TERUKUR (Tanjungharjo 2026-08-27): buffer OLT hanya sedalam 27 halaman ≈ 540 baris.
    // Padam total 99 ONU = 198 baris (aman). Tapi pada 2 slot penuh 256 ONU: padam total =
    // 512 baris (95% buffer), dan padam+pulih = 768 baris — MELUBER. Membaca lebih dalam tak
    // menolong; batasnya ada di buffer OLT. Yang menolong: scrape lebih sering, dan syslog
    // sebagai sumber kedua (syslog didorong real-time, tak punya batas buffer sama sekali).
    if (alasanBerhenti === "buffer-habis" && useHwm
        && Number.isFinite(tertuaTerbacaMs) && tertuaTerbacaMs > hwmMs) {
        console.warn(`[OLT-Scraper] !! CELAH DATA: buffer log OLT habis di ${halamanTerbaca} halaman, `
            + `tapi baris tertua yang terbaca masih lebih baru dari titik terakhir yang diproses. `
            + `Kejadian di antaranya sudah DITIMPA di OLT dan tak bisa diambil lagi — `
            + `saat padam massal, baris dying-gasp bisa termasuk yang hilang sehingga kejadiannya `
            + `tervonis LOS. Perpendek olt.scrapeInterval; syslog tetap jadi sumber kedua.`);
    }

    if (halamanTerbaca >= cap) {
        // "No silent caps": kalau berhenti karena CAP (bukan karena datanya habis), bilang.
        // Terpotong = ada baris lebih tua yang tak terbaca — dan justru di situ dying-gasp
        // berada saat mati listrik massal.
        console.warn(`[OLT-Scraper] !! Pembacaan TERPOTONG di cap ${cap} halaman (${allLines.length} baris). `
            + `Masih ada log lebih tua yang tidak terbaca — saat mati listrik massal, baris dying-gasp `
            + `bisa berada di sana dan kejadiannya salah tervonis LOS. Naikkan olt.maxLogPages.`);
    }
    console.log(`[OLT-Scraper] Fetched ${allLines.length} log lines (adaptif, cap ${cap} halaman, terbaca ${halamanTerbaca}, berhenti: ${alasanBerhenti})`);
    return allLines;
}

/**
 * Fetch single page log dari web OLT
 */
function fetchOltLogPage(host, username, password, page = 0, port = 80) {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${username}:${password}`).toString('base64');

        // Log ada di iframe: sys_log_page.asp?page=X
        const options = {
            hostname: host,
            port: Number(port) || 80, // OLT web bisa di port non-standar (mis. port-forward :81/:82)
            path: `/sys_log_page.asp?page=${page}`,
            method: 'GET',
            timeout: 10000,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Connection': 'close'
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', chunk => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    // Header `Date` = JAM OLT saat ini (GoAhead set dari system clock). Dipakai
                    // mengoreksi drift jam OLT yang tidak sinkron (lihat deriveOnuStatusFromLog).
                    resolve({ body: data, dateHeader: res.headers && res.headers.date });
                } else if (res.statusCode === 401) {
                    reject(new Error('Authentication failed - cek username/password'));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        });
        
        req.on('error', (e) => {
            reject(new Error(`Connection error: ${e.message}`));
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

/**
 * Parse header HTTP `Date` OLT (GoAhead, format non-standar "Sun Jun 28 16:24:30 2026",
 * tanpa timezone) → ms. Di-parse sebagai JAM LOKAL — konsisten dengan parseTimestamp log,
 * sehingga offset membatalkan drift jam OLT berapa pun besarnya.
 */
function parseOltDateHeader(dateHeader) {
    if (!dateHeader) return null;
    const ms = new Date(dateHeader).getTime();
    return Number.isNaN(ms) ? null : ms;
}

/**
 * Fetch log untuk KLASIFIKASI STATUS terkini (bukan stream transisi HWM). Ambil N halaman
 * sekuensial + header `Date` halaman 0 (= jam OLT now) untuk hitung offset jam OLT vs server.
 *   offsetMs = jamOLTnow − serverNow (>0 = OLT lebih cepat). real = jamLog − offsetMs.
 * @returns {Promise<{lines:string[], offsetMs:number, year:number}>}
 */
async function fetchLogForStatus(host, username, password, maxPages = 12, port = 80) {
    const cap = Math.min(MAX_LOG_PAGES_HARD, Math.max(1, Number(maxPages) || 12));
    const allLines = [];
    let offsetMs = 0;
    let year = new Date().getFullYear();
    let gotClock = false;
    for (let page = 0; page < cap; page++) {
        let res;
        try {
            res = await fetchOltLogPage(host, username, password, page, port);
        } catch (e) {
            if (page === 0) throw e;
            break; // halaman berikut gagal → pakai yang sudah didapat
        }
        if (!gotClock) {
            const oltNow = parseOltDateHeader(res.dateHeader);
            if (oltNow !== null) {
                offsetMs = oltNow - Date.now();
                year = new Date(oltNow).getFullYear();
                gotClock = true;
            }
        }
        const lines = extractLogLines(res.body);
        if (lines.length === 0) break;
        allLines.push(...lines);
    }
    return { lines: allLines, offsetMs, year };
}

const STATUS_CORRELATION_MS = 60_000; // DG harus dalam 60s sebelum Lost (sama dgn classifier)

/**
 * Derive STATUS TERKINI tiap ONU dari kumpulan baris log (urut kronologis). Verdict DG vs
 * LOS dari TANDA TANGAN (dying-gasp+Lost detik sama = DG; Lost saja = LOS) — kebal drift jam
 * karena berbasis sinyal & urutan, bukan jam absolut. offsetMs hanya untuk stempel WAKTU REAL.
 *
 * @returns {Map<string,{event_type,slot,onu,oltTs,realTs,raw}>} HANYA MAC yang SEDANG down
 *   (Lost tanpa Discovery sesudahnya). event_type: 'dying-gasp' | 'los'.
 */
function deriveOnuStatusFromLog(logLines, options = {}) {
    const offsetMs = Number.isFinite(options.offsetMs) ? options.offsetMs : 0;
    const year = Number.isInteger(options.year) ? options.year : new Date().getFullYear();
    const sorted = sortLogLinesChronologically(logLines); // tua → muda
    const status = new Map();    // normMac → entry (current down-state)
    const pendingDg = new Map(); // normMac → oltTs (DG menunggu Lost)
    for (const line of sorted) {
        const parsed = parseLogLine(line);
        if (!parsed) continue;
        const oltTs = new Date(parseTimestamp(parsed.timestamp, year)).getTime();
        if (parsed.type === 'dying-gasp') {
            pendingDg.set(parsed.mac, oltTs);
        } else if (parsed.type === 'lost') {
            const { slot, onu } = parseSlotOnu(parsed.slot_onu);
            const dgTs = pendingDg.get(parsed.mac);
            const isDg = dgTs !== undefined && oltTs >= dgTs && (oltTs - dgTs) <= STATUS_CORRELATION_MS;
            status.set(parsed.mac, {
                event_type: isDg ? 'dying-gasp' : 'los',
                slot, onu, oltTs,
                realTs: oltTs - offsetMs,
                raw: line,
            });
            pendingDg.delete(parsed.mac);
        } else if (parsed.type === 'discovery') {
            status.delete(parsed.mac); // pulih → online
            pendingDg.delete(parsed.mac);
        }
    }
    return status;
}

// Cache status per-OLT supaya tak fetch log tiap render monitor.
const onuStatusCache = new Map(); // oltId → { at, map, offsetMs, lineCount }
const ONU_STATUS_TTL_MS = 60_000;

/**
 * Peta status ONU (DG/LOS) dari log OLT, cached per-OLT (TTL 60s). Dipakai endpoint monitor
 * untuk mengoreksi status SNMP Hioso yang tak bisa membedakan LOS vs DG.
 * @returns {Promise<{at,map:Map,offsetMs,lineCount}>}
 */
async function getOnuStatusMap(oltDevice, opts = {}) {
    const ttl = Number.isFinite(opts.ttlMs) ? opts.ttlMs : ONU_STATUS_TTL_MS;
    const maxPages = Number.isInteger(opts.maxPages) ? opts.maxPages : 12;
    const id = oltDevice.id || oltDevice.host;
    const cached = onuStatusCache.get(id);
    if (!opts.force && cached && (Date.now() - cached.at) < ttl) return cached;
    const { lines, offsetMs, year } = await fetchLogForStatus(oltDevice.host, oltDevice.webUsername, oltDevice.webPassword, maxPages, oltDevice.webPort);
    const map = deriveOnuStatusFromLog(lines, { offsetMs, year });
    const entry = { at: Date.now(), map, offsetMs, lineCount: lines.length };
    onuStatusCache.set(id, entry);
    return entry;
}

/**
 * Parse HTML log page dan extract log lines
 */
function extractLogLines(html) {
    const lines = [];
    
    // Debug: Save HTML to file for inspection
    if (process.env.DEBUG_OLT_SCRAPER === 'true') {
        const debugPath = path.join(__dirname, '..', 'temp', 'olt-log-debug.html');
        try {
            fs.writeFileSync(debugPath, html, 'utf8');
            console.log(`[OLT-Scraper DEBUG] HTML saved to ${debugPath}`);
        } catch (e) {
            console.error('[OLT-Scraper DEBUG] Failed to save HTML:', e.message);
        }
    }
    
    // Log format dari user: "Jan 18 14:53:57 EPON: ..."
    // Bisa berurutan tanpa newline: "Jan 18 14:53:57 ...Jan 18 14:54:00 ..."
    
    // Strategy 1: Split by timestamp pattern
    // Cari semua kemunculan pattern timestamp dan split
    const timestampPattern = /(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})/g;
    const timestamps = [];
    let match;
    
    while ((match = timestampPattern.exec(html)) !== null) {
        timestamps.push({
            timestamp: match[1],
            index: match.index
        });
    }
    
    console.log(`[OLT-Scraper] Found ${timestamps.length} timestamps in HTML`);
    
    // Extract text between timestamps
    for (let i = 0; i < timestamps.length; i++) {
        const start = timestamps[i].index;
        const end = i < timestamps.length - 1 ? timestamps[i + 1].index : html.length;
        const logText = html.substring(start, end).trim();
        
        // Only keep lines with EPON
        if (logText.includes('EPON:')) {
            lines.push(logText);
        }
    }
    
    // Debug: Log extracted lines
    if (lines.length > 0) {
        console.log(`[OLT-Scraper] Extracted ${lines.length} log lines`);
        if (process.env.DEBUG_OLT_SCRAPER === 'true') {
            console.log('[OLT-Scraper DEBUG] All extracted lines:');
            lines.forEach((line, idx) => console.log(`  [${idx}]`, line));
        }
    } else {
        console.log('[OLT-Scraper] No log lines extracted - HTML format might be different');
        // Try to find any EPON-related text
        const eponMatches = html.match(/EPON/gi);
        if (eponMatches) {
            console.log(`[OLT-Scraper] Found ${eponMatches.length} "EPON" occurrences in HTML`);
            // Show sample of HTML around EPON
            const eponIndex = html.indexOf('EPON');
            if (eponIndex !== -1) {
                const sample = html.substring(Math.max(0, eponIndex - 50), Math.min(html.length, eponIndex + 100));
                console.log(`[OLT-Scraper] Sample HTML around EPON:`, sample);
            }
        }
    }
    
    return lines;
}

/**
 * Process log dan update events
 * Menggunakan relative time window untuk handle OLT yang waktu nya tidak sinkron
 */
function processLog(logLines, events, timeWindowMinutes = 10, options = {}) {
    // FIX korelasi DG↔Lost: sortir kronologis dulu. Web log dipaginasi newest-page-first;
    // tanpa ini "Lost" bisa diproses sebelum "dying-gasp" pasangannya (lintas halaman) →
    // salah vonis LOS saat mass outage (justru momen paling kritis).
    logLines = sortLogLinesChronologically(logLines);
    const now = new Date();
    const currentYear = now.getFullYear();

    // HWM mode (opsional): proses HANYA event > HWM, apa pun umurnya (pulihkan celah radio).
    // options.report.newHwmMs diisi ts event terbaru yang diproses (untuk persist by caller).
    const hwmMs = Number.isFinite(options.hwmMs) ? options.hwmMs : null;
    const report = options.report || null;
    
    // Time window: hanya proses log dalam X menit terakhir (configurable)
    // Ini untuk handle OLT yang waktu nya tidak sinkron
    const TIME_WINDOW_MS = timeWindowMinutes * 60 * 1000;
    
    // Temporary storage untuk dying-gasp events (untuk matching dengan Lost)
    const recentDyingGasps = new Map(); // mac -> timestamp
    
    let dyingGaspCount = 0;
    let lostCount = 0;
    let discoveryCount = 0;
    let unparsedCount = 0;
    let skippedOldCount = 0;
    
    // Cari log terbaru untuk estimasi offset waktu OLT
    let latestLogTime = null;
    logLines.forEach(line => {
        const parsed = parseLogLine(line);
        if (parsed) {
            const logTime = parseTimestamp(parsed.timestamp, currentYear);
            const logDate = new Date(logTime);
            if (!latestLogTime || logDate > latestLogTime) {
                latestLogTime = logDate;
            }
        }
    });
    
    // Hitung offset waktu (OLT time - Server time) — dipakai hanya di mode jendela-waktu.
    let timeOffset = 0;
    if (latestLogTime) {
        timeOffset = latestLogTime.getTime() - now.getTime();
        const offsetMinutes = Math.round(timeOffset / 60000);
        console.log(`[OLT-Scraper] Time offset: ${offsetMinutes} minutes (OLT ${offsetMinutes > 0 ? 'ahead' : 'behind'} server)`);
        console.log(`[OLT-Scraper] Time window: ${timeWindowMinutes} minutes`);
    }

    // Tentukan mode efektif. Guard reset-jam: bila event TERBARU jauh lebih tua dari HWM
    // (mis. jam OLT reset mundur usai reboot), jangan skip-semua → fallback jendela-waktu.
    let effectiveHwm = hwmMs;
    if (effectiveHwm !== null && latestLogTime &&
        latestLogTime.getTime() < effectiveHwm - CLOCK_RESET_THRESHOLD_MS) {
        console.warn('[OLT-Scraper] Jam OLT tampak reset mundur — abaikan HWM siklus ini, pakai jendela-waktu');
        effectiveHwm = null;
    }
    // Lacak ts terbaru yang diproses → HWM baru. Mulai dari HWM lama agar tidak mundur.
    let maxProcessedTs = effectiveHwm !== null ? effectiveHwm : 0;
    
    // Process setiap line
    logLines.forEach(line => {
        const parsed = parseLogLine(line);
        if (!parsed) {
            unparsedCount++;
            if (process.env.DEBUG_OLT_SCRAPER === 'true') {
                console.log('[OLT-Scraper DEBUG] Unparsed line:', line);
            }
            return;
        }
        
        // Convert timestamp ke full date
        const fullTimestamp = parseTimestamp(parsed.timestamp, currentYear);
        const logTime = new Date(fullTimestamp).getTime();
        
        if (effectiveHwm !== null) {
            // Mode HWM: lewati event yang sudah pernah diproses (<= HWM); proses yang lebih
            // baru TANPA peduli umurnya. Inilah pemulih celah saat link sempat down.
            if (logTime <= effectiveHwm) {
                skippedOldCount++;
                return;
            }
        } else {
            // Mode jendela-waktu (bootstrap/no-HWM/clock-reset): perilaku lama, relatif ke
            // log terbaru untuk menoleransi jam OLT yang tidak sinkron.
            const adjustedLogTime = logTime - timeOffset;
            const timeSinceLog = now.getTime() - adjustedLogTime;
            if (timeSinceLog > TIME_WINDOW_MS) {
                skippedOldCount++;
                if (process.env.DEBUG_OLT_SCRAPER === 'true') {
                    console.log(`[OLT-Scraper DEBUG] Skipped old log (${Math.round(timeSinceLog/60000)} min ago):`, line.substring(0, 50));
                }
                return;
            }
        }
        // Event ini lolos filter → majukan kandidat HWM ke ts terbaru yang diproses.
        if (logTime > maxProcessedTs) maxProcessedTs = logTime;

        if (parsed.type === 'dying-gasp') {
            dyingGaspCount++;
            // Simpan dying-gasp untuk matching dengan Lost
            recentDyingGasps.set(parsed.mac, fullTimestamp);
            console.log(`[OLT-Scraper] Found dying-gasp: ${parsed.mac} at ${fullTimestamp}`);
            
        } else if (parsed.type === 'lost') {
            lostCount++;
            const { slot, onu } = parseSlotOnu(parsed.slot_onu);
            
            // Cek apakah ada dying-gasp untuk MAC ini dalam 60 detik terakhir
            const dyingGaspTime = recentDyingGasps.get(parsed.mac);
            let eventType = 'los'; // Default: LOS
            
            if (dyingGaspTime) {
                const dgTime = new Date(dyingGaspTime).getTime();
                const lostTime = new Date(fullTimestamp).getTime();
                
                // Jika dying-gasp terjadi dalam 60 detik sebelum Lost
                if (lostTime - dgTime <= 60000 && lostTime >= dgTime) {
                    eventType = 'dying-gasp';
                }
            }
            
            // Update atau create event
            events[parsed.mac] = {
                mac: parsed.mac,
                slot: slot,
                onu: onu,
                event_type: eventType,
                timestamp: fullTimestamp,
                raw_log: line,
                server_time: now.toISOString() // Waktu server saat event terdeteksi
            };
            
            console.log(`[OLT-Scraper] ${parsed.mac}: ${eventType.toUpperCase()} at ${fullTimestamp}`);
            
        } else if (parsed.type === 'discovery') {
            discoveryCount++;
            // ONT online kembali - hapus event offline
            if (events[parsed.mac]) {
                console.log(`[OLT-Scraper] ${parsed.mac}: Online (Discovery)`);
                delete events[parsed.mac];
            }
        }
    });
    
    console.log(`[OLT-Scraper] Parsed: ${dyingGaspCount} dying-gasp, ${lostCount} lost, ${discoveryCount} discovery, ${unparsedCount} unparsed, ${skippedOldCount} skipped (old/seen)`);

    // Laporkan HWM baru untuk dipersist caller. Pakai max(yang diproses, event TERBARU di
    // buffer): pada bootstrap (semua event di luar jendela → tak ada yang diproses), HWM
    // tetap MAJU ke event terbaru supaya siklus berikut tidak membaca ulang seluruh buffer
    // (mencegah HWM nyangkut di 0 → deep-read tak perlu).
    if (report) {
        const latestMs = latestLogTime ? latestLogTime.getTime() : 0;
        report.newHwmMs = Math.max(maxProcessedTs, latestMs);
    }

    return events;
}

/**
 * Parse timestamp dari log ke ISO format
 */
function parseTimestamp(logTimestamp, year) {
    // Format: "Jan 16 18:55:39"
    const months = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };
    
    const match = logTimestamp.match(/(\w{3})\s+(\d+)\s+(\d{2}:\d{2}:\d{2})/);
    if (match) {
        const month = months[match[1]] || '01';
        const day = match[2].padStart(2, '0');
        const time = match[3];
        return `${year}-${month}-${day}T${time}`;
    }
    
    return new Date().toISOString();
}

/**
 * Main scrape function - Support multiple OLT
 */
async function scrapeOltLog() {
    // Guard anti-overlap: kalau siklus sebelumnya belum selesai (mis. satu OLT sangat
    // lambat), JANGAN mulai siklus baru — kalau tidak, 2 fetch barengan ke OLT yang SAMA
    // (httpd single-client) bisa ECONNREFUSED. Mirror pola isPolling di olt-rxpower-poller.
    if (isScraping) {
        console.log('[OLT-Scraper] Siklus sebelumnya belum selesai — skip tick ini (anti-overlap)');
        return;
    }
    isScraping = true;
    try {
        // Get all OLT devices
        const oltDevices = oltManager.getOltDevices();
        const globalConfig = oltManager.getOltGlobalConfig();
        
        if (!globalConfig.enabled || !globalConfig.webEnabled) {
            console.log('[OLT-Scraper] Web scraping disabled in config');
            return;
        }
        
        if (oltDevices.length === 0) {
            console.log('[OLT-Scraper] No OLT devices configured');
            return;
        }
        
        console.log(`[OLT-Scraper] Scraping ${oltDevices.length} OLT device(s)...`);
        
        // Load existing events
        let allEvents = loadEvents();

        // Load HWM per-OLT sekali (parallel map di bawah hanya BACA; tulis dilakukan
        // sekali setelah Promise.all untuk hindari race tulis file).
        const hwmStore = loadHwm();

        // Snapshot tipe event per-MAC SEBELUM merge (untuk deteksi transisi
        // edge-triggered → feed LOS broadcaster sekali per insiden, bukan tiap cycle).
        const prevEventTypes = {};
        for (const mac of Object.keys(allEvents)) {
            prevEventTypes[mac] = allEvents[mac] && allEvents[mac].event_type;
        }

        // Scrape all OLT devices in parallel
        const scrapePromises = oltDevices.map(async (olt) => {
            if (hasUnconfiguredHost(olt)) {
                return {
                    oltId: olt.id,
                    oltName: olt.name,
                    events: {},
                    skipped: true,
                    status: 'unconfigured'
                };
            }

            // Brand yang tidak butuh web scrape (mis. ZTE GPON — status & LOS via SNMP
            // native, ditangani olt-snmp-los-poller). Lewati supaya tidak spam HTTP
            // ECONNREFUSED & salah menandai OLT "degraded".
            if (!deviceNeedsWebScrape(olt)) {
                return {
                    oltId: olt.id,
                    oltName: olt.name,
                    events: {},
                    skipped: true,
                    status: 'not_applicable'
                };
            }

            if (shouldSkipDeviceScrape(olt)) {
                const state = getDeviceState(olt);
                return {
                    oltId: olt.id,
                    oltName: olt.name,
                    events: {},
                    skipped: true,
                    status: state.status,
                    nextRetryAt: state.next_retry_at
                };
            }

            try {
                // HWM per-OLT (jam OLT, ms). null = belum ada → bootstrap (jendela-waktu).
                const deviceHwm = hwmStore[olt.id] && Number.isFinite(hwmStore[olt.id].tsMs)
                    ? hwmStore[olt.id].tsMs
                    : null;

                // Fetch log: di mode HWM, kedalaman baca = sebesar gap sejak scrape terakhir
                // (pulihkan event yang sempat hilang dari syslog saat link down), dibatasi cap.
                const logLines = await fetchOltLog(olt.host, olt.webUsername, olt.webPassword, globalConfig.maxLogPages, globalConfig.timeWindow, deviceHwm, olt.webPort);

                if (logLines.length === 0) {
                    markDeviceHealthy(olt);
                    return { oltId: olt.id, oltName: olt.name, events: {}, logLines: 0, status: 'healthy' };
                }

                // Process log for this OLT (HWM mode: proses hanya event > HWM, apa pun umurnya)
                const oltEvents = {};
                const report = {};
                processLog(logLines, oltEvents, globalConfig.timeWindow, { hwmMs: deviceHwm, report });

                // Add OLT info to each event
                Object.values(oltEvents).forEach(event => {
                    event.olt_id = olt.id;
                    event.olt_name = olt.name;
                    event.olt_host = olt.host;
                    
                    // Update MAC cache
                    oltManager.updateMacCache(event.mac, olt.id, olt.name, olt.host);
                });
                
                const stateChanged = markDeviceHealthy(olt);
                if (stateChanged) {
                    console.log(`[OLT-Scraper] [${olt.name}] recovered and is healthy again`);
                }

                return { oltId: olt.id, oltName: olt.name, events: oltEvents, logLines: logLines.length, status: 'healthy', newHwmMs: report.newHwmMs };

            } catch (error) {
                const stateChanged = markDeviceFailure(olt, error.message);
                const state = getDeviceState(olt);
                if (stateChanged) {
                    console.warn(`[OLT-Scraper] [${olt.name}] ${state.status}: ${error.message}`);
                }
                return {
                    oltId: olt.id,
                    oltName: olt.name,
                    events: {},
                    error: error.message,
                    status: state.status,
                    failureCount: state.failure_count,
                    nextRetryAt: state.next_retry_at
                };
            }
        });
        
        // Wait for all scrapes to complete
        const results = await Promise.all(scrapePromises);
        
        // Merge events from all OLTs
        let successCount = 0;
        let degradedCount = 0;
        let unreachableCount = 0;
        let skippedCount = 0;

        results.forEach(result => {
            if (result.events && Object.keys(result.events).length > 0) {
                Object.assign(allEvents, result.events);
            }

            if (result.skipped) {
                skippedCount++;
                return;
            }

            if (result.status === 'healthy') {
                successCount++;
            } else if (result.status === 'degraded') {
                degradedCount++;
            } else if (result.status === 'unreachable') {
                unreachableCount++;
            }
        });

        // Persist HWM baru per-OLT (sekali, hindari race). Hanya majukan, jangan mundur.
        let hwmChanged = false;
        results.forEach(result => {
            // newHwmMs <= 0 = tidak ada event ter-parse (mis. halaman cuma noise "start http").
            // Jangan persist 0 → kalau tidak, siklus berikut menganggap HWM=epoch & deep-read.
            if (!result || !Number.isFinite(result.newHwmMs) || result.newHwmMs <= 0) return;
            const prev = hwmStore[result.oltId] && hwmStore[result.oltId].tsMs;
            if (!Number.isFinite(prev) || result.newHwmMs > prev) {
                hwmStore[result.oltId] = {
                    tsMs: result.newHwmMs,
                    iso: new Date(result.newHwmMs).toISOString(),
                    updatedAt: new Date().toISOString()
                };
                hwmChanged = true;
            }
        });
        if (hwmChanged) saveHwm(hwmStore);

        // Cleanup old events
        allEvents = cleanupOldEvents(allEvents);
        
        // Save merged events
        saveEvents(allEvents);

        // Feed LOS broadcaster secara edge-triggered (cocokkan semantik push syslog:
        // 1 broadcast per insiden). Non-fatal — bungkus try agar tak ganggu scrape.
        try {
            dispatchLosTransitions(prevEventTypes, allEvents);
        } catch (broadcastErr) {
            console.error('[OLT-Scraper] LOS broadcaster dispatch error:', broadcastErr.message);
        }

        // Save MAC cache
        oltManager.saveMacCache();
        
        lastScrapeTime = new Date();
        lastError = null;
        lastSuccessAt = new Date();
        
        const totalEvents = Object.keys(allEvents).length;
        console.log(`[OLT-Scraper] ✓ Completed scraping ${oltDevices.length} OLT(s), ${totalEvents} active events | healthy=${successCount} degraded=${degradedCount} unreachable=${unreachableCount} skipped=${skippedCount}`);
        
    } catch (error) {
        lastError = error.message;
        console.error('[OLT-Scraper] ✗ Error:', error.message);
    } finally {
        isScraping = false;
    }
}

/**
 * Start scraper
 */
function startScraper() {
    if (isRunning) {
        console.log('[OLT-Scraper] Already running');
        return;
    }
    
    // Load config untuk cek apakah enabled
    try {
        const globalConfig = oltManager.getOltGlobalConfig();
        
        if (!globalConfig.enabled || !globalConfig.webEnabled) {
            console.log('[OLT-Scraper] Web scraping disabled');
            return;
        }
        
        // Get interval from config (default 1 menit)
        const intervalMinutes = globalConfig.scrapeInterval || 1;
        currentInterval = intervalMinutes * 60 * 1000;
        
        console.log(`[OLT-Scraper] Starting scraper (interval: ${intervalMinutes} minute${intervalMinutes > 1 ? 's' : ''})`);
        
        // Run immediately
        scrapeOltLog();
        
        // Then run every X minutes
        scraperInterval = setInterval(scrapeOltLog, currentInterval);
        isRunning = true;
        
    } catch (e) {
        console.error('[OLT-Scraper] Error starting:', e.message);
    }
}

/**
 * Stop scraper
 */
function stopScraper() {
    if (scraperInterval) {
        clearInterval(scraperInterval);
        scraperInterval = null;
    }
    isRunning = false;
    console.log('[OLT-Scraper] Stopped');
}

/**
 * Restart scraper (dipanggil saat config berubah)
 */
function restartLogScraper() {
    stopScraper();
    setTimeout(startScraper, 1000);
}

/**
 * Get event untuk MAC tertentu
 */
function getEventByMAC(mac) {
    const events = loadEvents();
    const normalizedMac = normalizeMAC(mac);
    return events[normalizedMac] || null;
}

/**
 * Get all events
 */
function getAllEvents() {
    return loadEvents();
}

/**
 * Get scraper status
 */
function getScraperStatus() {
    return {
        running: isRunning,
        lastScrapeTime: lastScrapeTime,
        lastSuccessAt: lastSuccessAt,
        lastError: lastError,
        eventCount: Object.keys(loadEvents()).length,
        intervalMs: currentInterval,
        intervalMinutes: Math.round(currentInterval / 60000),
        deviceStatuses: getDeviceStatuses()
    };
}

/**
 * Test connection ke web OLT
 */
async function testWebConnection(host, username, password, port = 80) {
    try {
        // fetchOltLog mengembalikan ARRAY baris (bukan HTML) — pakai langsung.
        const logLines = await fetchOltLog(host, username, password, 3, 10, null, port);
        return {
            success: true,
            message: `Berhasil! Ditemukan ${logLines.length} baris log`
        };
    } catch (error) {
        return {
            success: false,
            message: error.message
        };
    }
}

// True bila siklus scraper periodik sedang berjalan. Dipakai olt-los-verifier untuk
// menghindari 2 fetch barengan ke httpd OLT (single-client → ECONNREFUSED); saat busy,
// verifier memilih fallback (skip verify) alih-alih menabrak siklus periodik.
function isScraperBusy() {
    return isScraping === true;
}

module.exports = {
    startScraper,
    stopScraper,
    restartLogScraper,
    scrapeOltLog,
    getEventByMAC,
    getAllEvents,
    getScraperStatus,
    testWebConnection,
    normalizeMAC,
    // Diekspos untuk reuse oleh lib/olt-los-verifier.js (verifikasi otoritatif LOS↔DG).
    fetchOltLog,
    processLog,
    isScraperBusy,
    getDeviceStatuses,
    getBackoffDelay,
    getOnuStatusMap,
    __testHooks: {
        getDeviceState,
        markDeviceHealthy,
        markDeviceFailure,
        shouldSkipDeviceScrape,
        resetDeviceStatuses,
        processLog,
        sortLogLinesChronologically,
        fetchOltLog,
        loadHwm,
        saveHwm,
        OLT_HWM_FILE,
        deriveOnuStatusFromLog,
        parseOltDateHeader,
        fetchLogForStatus
    }
};
