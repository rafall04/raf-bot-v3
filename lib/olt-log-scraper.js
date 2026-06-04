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

// File untuk menyimpan event ONT
const OLT_EVENTS_FILE = path.join(__dirname, '..', 'database', 'olt-events.json');

// Interval scraping default (1 menit = 60000 ms)
const DEFAULT_SCRAPE_INTERVAL = 60000;

// Retensi data (2 hari dalam ms)
const DATA_RETENTION = 2 * 24 * 60 * 60 * 1000;

// Scraper state
let scraperInterval = null;
let isRunning = false;
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

/**
 * Normalize MAC address (uppercase, no separator)
 */
function normalizeMAC(mac) {
    if (!mac) return '';
    return mac.replace(/[:\-\s]/g, '').toUpperCase();
}

/**
 * Parse log line dari OLT
 * Format contoh:
 * - "Jan 18 14:53:57 EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da dying-gasp"
 * - "Jan 18 14:53:57 EPON: Slot 0/1/1:4 Onu c0:f6:ec:1e:ff:da[Na] Lost"
 * - "Jan 18 14:54:45 EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da [Na] Discovery"
 * 
 * PENTING: Format menggunakan titik dua (:) bukan titik (.) untuk separator slot/onu
 */
function parseLogLine(line) {
    // Pattern untuk dying-gasp
    // Format: "Jan 18 14:53:57 EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da dying-gasp"
    const dyingGaspMatch = line.match(/(\w+\s+\d+\s+[\d:]+)\s+EPON:\s+Onu\s+([\d\/\:]+)\s+([a-f0-9:]+)\s+dying-gasp/i);
    if (dyingGaspMatch) {
        const result = {
            type: 'dying-gasp',
            timestamp: dyingGaspMatch[1],
            slot_onu: dyingGaspMatch[2],
            mac: normalizeMAC(dyingGaspMatch[3])
        };
        if (process.env.DEBUG_OLT_SCRAPER === 'true') {
            console.log('[OLT-Scraper DEBUG] Parsed dying-gasp:', result);
        }
        return result;
    }
    
    // Pattern untuk Lost
    // Format: "Jan 18 14:53:57 EPON: Slot 0/1/1:4 Onu c0:f6:ec:1e:ff:da[Na] Lost"
    const lostMatch = line.match(/(\w+\s+\d+\s+[\d:]+)\s+EPON:\s+Slot\s+([\d\/\:]+)\s+Onu\s+([a-f0-9:]+)\[.*?\]\s+Lost/i);
    if (lostMatch) {
        const result = {
            type: 'lost',
            timestamp: lostMatch[1],
            slot_onu: lostMatch[2],
            mac: normalizeMAC(lostMatch[3])
        };
        if (process.env.DEBUG_OLT_SCRAPER === 'true') {
            console.log('[OLT-Scraper DEBUG] Parsed lost:', result);
        }
        return result;
    }
    
    // Pattern untuk Discovery (ONT online kembali)
    // Format: "Jan 18 14:54:45 EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da [Na] Discovery"
    const discoveryMatch = line.match(/(\w+\s+\d+\s+[\d:]+)\s+EPON:\s+Onu\s+([\d\/\:]+)\s+([a-f0-9:]+)\s+\[.*?\]\s+Discovery/i);
    if (discoveryMatch) {
        const result = {
            type: 'discovery',
            timestamp: discoveryMatch[1],
            slot_onu: discoveryMatch[2],
            mac: normalizeMAC(discoveryMatch[3])
        };
        if (process.env.DEBUG_OLT_SCRAPER === 'true') {
            console.log('[OLT-Scraper DEBUG] Parsed discovery:', result);
        }
        return result;
    }
    
    return null;
}

/**
 * Parse slot/onu dari format "0/1/1:4"
 * PENTING: Format menggunakan titik dua (:) bukan titik (.)
 */
function parseSlotOnu(slotOnuStr) {
    // Format: "0/1/1:4" -> slot=1, onu=4
    const match = slotOnuStr.match(/\d+\/\d+\/(\d+):(\d+)/);
    if (match) {
        return { slot: match[1], onu: match[2] };
    }
    return { slot: null, onu: null };
}

/**
 * Fetch log dari web OLT
 * PENTING: Log sebenarnya ada di sys_log_page.asp, bukan sys_log.asp
 * Support multiple pages untuk handle log yang banyak (misal saat mati listrik massal)
 */
async function fetchOltLog(host, username, password, maxPages = 3) {
    const allLines = [];
    
    for (let page = 0; page < maxPages; page++) {
        try {
            const html = await fetchOltLogPage(host, username, password, page);
            const lines = extractLogLines(html);
            
            if (lines.length === 0) {
                // Tidak ada log lagi di page ini, stop
                console.log(`[OLT-Scraper] No more logs at page ${page}, stopping`);
                break;
            }
            
            allLines.push(...lines);
            console.log(`[OLT-Scraper] Page ${page}: ${lines.length} log lines`);
            
            // Jika page pertama sudah dapat banyak log, cukup
            // Ini untuk optimasi agar tidak scrape terlalu banyak page
            if (page === 0 && lines.length < 10) {
                // Log sedikit, mungkin perlu cek page berikutnya
                continue;
            } else if (page > 0 && lines.length < 5) {
                // Page berikutnya log semakin sedikit, stop
                break;
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
    
    console.log(`[OLT-Scraper] Total fetched: ${allLines.length} log lines from ${Math.min(maxPages, allLines.length > 0 ? 1 : 0)} pages`);
    return allLines;
}

/**
 * Fetch single page log dari web OLT
 */
function fetchOltLogPage(host, username, password, page = 0) {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        
        // Log ada di iframe: sys_log_page.asp?page=X
        const options = {
            hostname: host,
            port: 80,
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
                    resolve(data);
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
function processLog(logLines, events, timeWindowMinutes = 10) {
    const now = new Date();
    const currentYear = now.getFullYear();
    
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
    
    // Hitung offset waktu (OLT time - Server time)
    let timeOffset = 0;
    if (latestLogTime) {
        timeOffset = latestLogTime.getTime() - now.getTime();
        const offsetMinutes = Math.round(timeOffset / 60000);
        console.log(`[OLT-Scraper] Time offset: ${offsetMinutes} minutes (OLT ${offsetMinutes > 0 ? 'ahead' : 'behind'} server)`);
        console.log(`[OLT-Scraper] Time window: ${timeWindowMinutes} minutes`);
    }
    
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
        
        // Adjust log time dengan offset untuk compare dengan server time
        const adjustedLogTime = logTime - timeOffset;
        const timeSinceLog = now.getTime() - adjustedLogTime;
        
        // Skip log yang terlalu lama (di luar time window)
        if (timeSinceLog > TIME_WINDOW_MS) {
            skippedOldCount++;
            if (process.env.DEBUG_OLT_SCRAPER === 'true') {
                console.log(`[OLT-Scraper DEBUG] Skipped old log (${Math.round(timeSinceLog/60000)} min ago):`, line.substring(0, 50));
            }
            return;
        }
        
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
    
    console.log(`[OLT-Scraper] Parsed: ${dyingGaspCount} dying-gasp, ${lostCount} lost, ${discoveryCount} discovery, ${unparsedCount} unparsed, ${skippedOldCount} skipped (old)`);
    
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
                // Fetch log (support multiple pages)
                const logLines = await fetchOltLog(olt.host, olt.webUsername, olt.webPassword, globalConfig.maxLogPages);
                
                if (logLines.length === 0) {
                    markDeviceHealthy(olt);
                    return { oltId: olt.id, oltName: olt.name, events: {}, logLines: 0, status: 'healthy' };
                }
                
                // Process log for this OLT
                const oltEvents = {};
                processLog(logLines, oltEvents, globalConfig.timeWindow);
                
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

                return { oltId: olt.id, oltName: olt.name, events: oltEvents, logLines: logLines.length, status: 'healthy' };
                
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
        
        // Cleanup old events
        allEvents = cleanupOldEvents(allEvents);
        
        // Save merged events
        saveEvents(allEvents);
        
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
async function testWebConnection(host, username, password) {
    try {
        const html = await fetchOltLog(host, username, password);
        const logLines = extractLogLines(html);
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
    getDeviceStatuses,
    getBackoffDelay,
    __testHooks: {
        getDeviceState,
        markDeviceHealthy,
        markDeviceFailure,
        shouldSkipDeviceScrape,
        resetDeviceStatuses
    }
};
