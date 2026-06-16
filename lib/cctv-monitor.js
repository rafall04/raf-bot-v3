/**
 * Header Doc
 * Purpose: Monitor CCTV publik. Poll netwatch MikroTik berkala, deteksi transisi up→down per
 *          host terdaftar di cctv-registry. Tunggu confirmation window (tahan flap PLN); kalau
 *          masih down → broadcast WA ke pelanggan. Saat pulih (down→up) sebelum window → batal,
 *          atau setelah broadcast → kirim notif "pulih". Tujuan: hilangkan kerja admin manual.
 *
 * Caller: lib/app-runtime.js (start saat boot), lib/process-lifecycle.js (stop), routes/cctv.js (CRUD device + status).
 * Deps: ./cctv-registry, ./mikrotik (getNetwatchList), ./whatsapp-critical-delivery (sendCritical).
 * MainFuncs: startCctvMonitor, stopCctvMonitor, restartCctvMonitor, getCctvMonitorStatus.
 *            createCctvMonitor(deps) — testable factory (semua dep dapat di-inject).
 * SideEffects: setInterval timer (unref), file IO incident log database/cctv-incidents.json.
 *
 * SEMANTIK:
 *   - Cycle pertama hanya SEED state (tidak broadcast), agar CCTV yang sudah down sebelum start
 *     tidak memicu blast massal.
 *   - Hanya status transisi yang trigger; status sama berturut-turut diabaikan.
 *   - Hanya 'up'→'down' yang masuk pending. 'unknown' diabaikan (netwatch baru aktif).
 *   - Confirmation window per-CCTV (override registry) atau global config.
 *   - Dedup: satu insiden = satu broadcast. Re-down dalam cooldown diabaikan (anti flap PLN-blink).
 *   - Recovery: jika pulih sebelum broadcast → cancel pending. Sesudah broadcast → kirim notif pulih.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const INCIDENTS_FILE = path.join(__dirname, '..', 'database', 'cctv-incidents.json');
const MAX_INCIDENTS = 500;

const DEFAULTS = {
    enabled: false,
    pollIntervalMs: 60_000,            // 1 menit
    confirmationMinutes: 15,           // default — bisa di-override per-CCTV atau via config
    rebroadcastCooldownMs: 30 * 60_000, // 30 menit: anti flap (PLN-blink) → 1 insiden = 1 broadcast
    notifyRecovery: true,              // kirim WA "pulih" saat CCTV nyala kembali setelah broadcast
    massOutageThreshold: 0,            // 0 = nonaktif; mis. 5 → bila ≥5 CCTV down bersamaan, tahan broadcast pelanggan
    massOutageAdminPhone: '',          // WA admin penerima ringkasan gangguan massal (multi: | atau ,)
    massOutageCooldownMs: 30 * 60_000, // jeda antar-alert admin (anti spam ringkasan)
    messageMassOutage:
        "⚠️ *Peringatan Gangguan Massal CCTV*\n\n" +
        "{count} CCTV terdeteksi *mati bersamaan* per {time_local}.\n" +
        "Kemungkinan gangguan PLN/uplink (bukan per-lokasi) — broadcast ke pelanggan *ditahan otomatis*.\n\n" +
        "Mohon cek jaringan inti.",
    messageDown:
        "Halo {customer_name},\n\n" +
        "🔴 CCTV *{cctv_name}* terdeteksi *mati*.\n" +
        "🕒 Sejak: {since_local}\n" +
        "⏱️ Durasi: {minutes_down}\n\n" +
        "Kemungkinan listrik atau koneksi internet di lokasi sedang terganggu — mohon dicek ya. " +
        "Bila perlu bantuan, balas pesan ini. 🙏\n\nTerima kasih.",
    messageUp:
        "Halo {customer_name},\n\n" +
        "🟢 CCTV *{cctv_name}* sudah *online kembali*.\n" +
        "🕒 Pulih: {up_local}\n\n" +
        "Terima kasih atas kerja samanya. 🙏",
};

function defaultLoadIncidents() {
    try {
        if (fs.existsSync(INCIDENTS_FILE)) {
            const p = JSON.parse(fs.readFileSync(INCIDENTS_FILE, 'utf8'));
            return Array.isArray(p) ? p : [];
        }
    } catch (e) { console.error('[CCTV] read incidents:', e.message); }
    return [];
}
function defaultSaveIncidents(list) {
    try {
        const dir = path.dirname(INCIDENTS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const trimmed = list.length > MAX_INCIDENTS ? list.slice(-MAX_INCIDENTS) : list;
        fs.writeFileSync(INCIDENTS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
    } catch (e) { console.error('[CCTV] write incidents:', e.message); }
}

function fmtDuration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + ' menit';
    const h = Math.floor(m / 60); const r = m % 60;
    return h + ' jam' + (r ? ' ' + r + ' menit' : '');
}
function fmtLocal(d) {
    try { return new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }); }
    catch (_e) { return String(d); }
}

function renderTemplate(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
}

function createCctvMonitor(deps = {}) {
    const getConfig = deps.getConfig || (() => ((global.config && global.config.cctvMonitor) || {}));
    const getDevices = deps.getDevices || (() => require('./cctv-registry').list());
    const fetchNetwatch = deps.fetchNetwatch || (async () => {
        const r = await require('./mikrotik').getNetwatchList({ caller: 'cctv-monitor.poll' });
        return r && r.ok ? (Array.isArray(r.data) ? r.data : []) : [];
    });
    const sendCritical = deps.sendCritical || require('./whatsapp-critical-delivery').sendCritical;
    const loadIncidents = deps.loadIncidents || defaultLoadIncidents;
    const saveIncidents = deps.saveIncidents || defaultSaveIncidents;
    const now = deps.now || (() => Date.now());
    const setTimer = deps.setTimeoutFn || setTimeout;
    const clearTimer = deps.clearTimeoutFn || clearTimeout;
    const setIntervalFn = deps.setIntervalFn || setInterval;
    const clearIntervalFn = deps.clearIntervalFn || clearInterval;
    const logger = deps.logger || console;

    // host (lowercase) → { status, since(ms), pending? {timer,incidentId,detectedAt}, active? {incidentId,broadcastedAt} }
    const state = new Map();
    let pollTimer = null;
    let isRunning = false;
    let isPolling = false;
    let seeded = false;
    let lastMassAlert = 0;
    const stats = { started_at: null, poll_count: 0, last_poll_at: null, last_error: null, broadcasts: 0, recoveries: 0, mass_alerts: 0, mass_suppressed: 0 };

    function cfg() { return { ...DEFAULTS, ...(getConfig() || {}) }; }

    function devByHost() {
        const m = new Map();
        for (const d of getDevices() || []) {
            if (!d || !d.host || d.enabled === false) continue;
            m.set(String(d.host).trim().toLowerCase(), d);
        }
        return m;
    }

    function recordIncident(rec) {
        const list = loadIncidents();
        list.push({ ...rec, createdAt: new Date(now()).toISOString() });
        saveIncidents(list);
    }
    function updateIncident(id, patch) {
        const list = loadIncidents();
        const i = list.findIndex((x) => x.incidentId === id);
        if (i >= 0) { list[i] = { ...list[i], ...patch, updatedAt: new Date(now()).toISOString() }; saveIncidents(list); }
    }

    function buildVars(device, sinceMs, _kind) {
        const t = now();
        return {
            customer_name: device.customerName || 'Pelanggan',
            cctv_name: device.name,
            cctv_host: device.host,
            since_local: fmtLocal(sinceMs),
            up_local: fmtLocal(t),
            minutes_down: fmtDuration(t - sinceMs),
        };
    }

    async function notify(device, kind, sinceMs, incidentId) {
        const conf = cfg();
        // Fallback ke DEFAULTS bila template config kosong (mis. config.example pakai "").
        const tplDefault = (kind === 'down' ? conf.messageDown : conf.messageUp)
            || (kind === 'down' ? DEFAULTS.messageDown : DEFAULTS.messageUp);
        const tpl = (kind === 'down' && device.customMessage) ? device.customMessage : tplDefault;
        const text = renderTemplate(tpl, buildVars(device, sinceMs, kind));
        const phones = String(device.phone || '').split(/[|,]/).map((p) => p.trim()).filter(Boolean);
        let delivered = 0;
        for (const ph of phones) {
            try {
                const r = await sendCritical(ph, { text }, { label: 'cctv_' + kind, waitForReadyMs: 8000 });
                if (r && r.delivered) delivered++;
            } catch (e) {
                logger.error && logger.error('[CCTV] sendCritical error', kind, ph, e.message);
            }
        }
        updateIncident(incidentId, {
            ['notify_' + kind + '_status']: delivered > 0 ? 'sent' : 'failed',
            ['notify_' + kind + '_at']: new Date(now()).toISOString(),
            ['notify_' + kind + '_delivered']: delivered,
            ['notify_' + kind + '_recipients']: phones.length,
        });
        return delivered;
    }

    // Hitung jumlah CCTV yang sedang DOWN (lintas host) — basis deteksi gangguan massal.
    function countDown() {
        let n = 0;
        for (const s of state.values()) if (s.status === 'down') n++;
        return n;
    }
    // Kirim 1 ringkasan ke admin saat gangguan massal terdeteksi (dengan cooldown anti-spam).
    function maybeMassAlert(downCount, conf) {
        const cooldown = conf.massOutageCooldownMs || DEFAULTS.massOutageCooldownMs;
        if (lastMassAlert && (now() - lastMassAlert) < cooldown) return; // sudah dikirim baru-baru ini
        lastMassAlert = now();
        stats.mass_alerts++;
        const phones = String(conf.massOutageAdminPhone || '').split(/[|,]/).map((p) => p.trim()).filter(Boolean);
        if (phones.length === 0) return; // tak ada tujuan admin → cukup tahan broadcast tanpa alert
        const text = renderTemplate(conf.messageMassOutage || DEFAULTS.messageMassOutage, {
            count: downCount, time_local: fmtLocal(now()),
        });
        for (const ph of phones) {
            sendCritical(ph, { text }, { label: 'cctv_mass_outage', waitForReadyMs: 8000 }).catch(() => {});
        }
        logger.log && logger.log('[CCTV] mass-outage admin alert terkirim (' + downCount + ' down)');
    }

    function onConfirm(host) {
        const s = state.get(host);
        if (!s || !s.pending) return;
        const device = devByHost().get(host);
        if (!device) { s.pending = null; return; }
        const pending = s.pending; s.pending = null;
        const conf = cfg();
        // Opt-out per-CCTV: pelanggan minta tak di-WA → cukup pantau (admin/Telegram tetap tahu).
        if (device.notifyCustomer === false) {
            updateIncident(pending.incidentId, { status: 'customer_optout' });
            return;
        }
        // Anti-flap: skip kalau baru saja broadcast utk insiden sebelumnya.
        if (s.lastBroadcast && (now() - s.lastBroadcast) < conf.rebroadcastCooldownMs) {
            updateIncident(pending.incidentId, { status: 'cooldown_skipped' });
            return;
        }
        // Guard gangguan massal: bila banyak CCTV down bersamaan → kemungkinan gangguan hulu
        // (PLN/uplink), JANGAN spam pelanggan; tahan broadcast + kirim 1 ringkasan ke admin.
        const massThreshold = Number(conf.massOutageThreshold) || 0;
        if (massThreshold > 0 && countDown() >= massThreshold) {
            const downCount = countDown();
            stats.mass_suppressed++;
            updateIncident(pending.incidentId, { status: 'mass_suppressed', downCount });
            maybeMassAlert(downCount, conf);
            logger.log && logger.log('[CCTV] mass-outage (' + downCount + ' down) → broadcast pelanggan DITAHAN: ' + device.name + ' (' + host + ')');
            return; // tak set active → tak ada notif "pulih" utk insiden yang ditahan
        }
        // Broadcast.
        s.active = { incidentId: pending.incidentId, broadcastedAt: now(), sinceMs: s.since };
        s.lastBroadcast = now();
        stats.broadcasts++;
        updateIncident(pending.incidentId, { status: 'broadcasted', broadcastedAt: new Date(now()).toISOString() });
        notify(device, 'down', s.since, pending.incidentId).catch(() => {});
        logger.log && logger.log('[CCTV] broadcast DOWN ' + device.name + ' (' + host + ')');
    }

    function startPending(host, device, conf) {
        const s = state.get(host);
        const minutes = Number.isFinite(+device.confirmationMinutes) && +device.confirmationMinutes > 0
            ? +device.confirmationMinutes : conf.confirmationMinutes;
        const ms = Math.max(60_000, minutes * 60_000); // minimal 1 menit untuk safety
        const incidentId = 'cctv_' + now() + '_' + Math.random().toString(36).slice(2, 7);
        const timer = setTimer(() => onConfirm(host), ms);
        if (timer && typeof timer.unref === 'function') timer.unref();
        s.pending = { incidentId, timer, detectedAt: now() };
        recordIncident({
            incidentId,
            cctv_id: device.id, cctv_name: device.name, host, phone: device.phone,
            detectedAt: new Date(now()).toISOString(),
            confirmationMinutes: minutes,
            status: 'pending',
        });
        logger.log && logger.log('[CCTV] DOWN pending konfirmasi ' + minutes + 'm: ' + device.name + ' (' + host + ')');
    }

    function cancelPending(host, reason) {
        const s = state.get(host);
        if (!s || !s.pending) return;
        clearTimer(s.pending.timer);
        updateIncident(s.pending.incidentId, { status: reason || 'cancelled' });
        s.pending = null;
    }

    function onRecovery(host) {
        const s = state.get(host);
        const device = devByHost().get(host);
        // (a) pulih sebelum broadcast → batal
        if (s && s.pending) cancelPending(host, 'recovered_before_broadcast');
        // (b) pulih setelah broadcast → notify "pulih" sekali
        if (s && s.active && device) {
            const conf = cfg();
            const activeId = s.active.incidentId; const sinceMs = s.active.sinceMs;
            s.active = null;
            stats.recoveries++;
            if (conf.notifyRecovery !== false) {
                notify(device, 'up', sinceMs, activeId).catch(() => {});
                logger.log && logger.log('[CCTV] UP pulih → notif: ' + device.name + ' (' + host + ')');
            }
            updateIncident(activeId, { recoveredAt: new Date(now()).toISOString(), status: 'recovered' });
        }
    }

    async function pollOnce() {
        if (isPolling) return;
        const conf = cfg();
        if (conf.enabled !== true) return;
        isPolling = true;
        try {
            const devMap = devByHost();
            if (devMap.size === 0) { isPolling = false; return; }
            const entries = await fetchNetwatch();
            // Index netwatch by host (lowercase).
            const nwByHost = new Map();
            for (const e of entries || []) {
                if (e && e.host) nwByHost.set(String(e.host).trim().toLowerCase(), e);
            }
            for (const [host, device] of devMap) {
                if (!state.has(host)) state.set(host, { status: null, since: null });
                const s = state.get(host);
                const nw = nwByHost.get(host);
                s.inNetwatch = !!nw; // lacak keberadaan di netwatch (utk badge peringatan di UI)
                if (!nw) continue; // CCTV terdaftar tapi tak ada di netwatch MikroTik → admin perlu konfigurasi
                const status = String(nw.status || '').toLowerCase();
                if (status !== 'up' && status !== 'down') continue; // 'unknown' atau lainnya → skip
                if (status !== s.status) {
                    const prev = s.status; s.status = status; s.since = now();
                    if (!seeded) continue; // cycle pertama: seed only
                    if (status === 'down' && prev === 'up') {
                        startPending(host, device, conf);
                    } else if (status === 'up' && prev === 'down') {
                        onRecovery(host);
                    }
                }
            }
            seeded = true;
            stats.poll_count++;
            stats.last_poll_at = new Date(now()).toISOString();
            stats.last_error = null;
        } catch (err) {
            stats.last_error = { at: new Date(now()).toISOString(), message: err.message };
            logger.error && logger.error('[CCTV] poll error:', err.message);
        } finally {
            isPolling = false;
        }
    }

    function start() {
        if (isRunning) return;
        const conf = cfg();
        if (conf.enabled !== true) {
            logger.log && logger.log('[CCTV] Disabled (set config.cctvMonitor.enabled=true)');
            return;
        }
        const ms = Math.max(20_000, conf.pollIntervalMs || DEFAULTS.pollIntervalMs);
        logger.log && logger.log('[CCTV] Starting monitor (interval ' + Math.round(ms / 1000) + 's)');
        stats.started_at = new Date(now()).toISOString();
        isRunning = true; seeded = false; state.clear();
        pollOnce();
        pollTimer = setIntervalFn(pollOnce, ms);
        if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();
    }
    function stop() {
        if (pollTimer) { clearIntervalFn(pollTimer); pollTimer = null; }
        isRunning = false;
        logger.log && logger.log('[CCTV] Stopped');
    }
    function restart() { stop(); setTimer(start, 500); }

    function getStatus() {
        const list = [];
        for (const [host, s] of state) {
            list.push({
                host, status: s.status, since: s.since,
                pending: !!s.pending, broadcasted: !!s.active,
                inNetwatch: typeof s.inNetwatch === 'boolean' ? s.inNetwatch : null,
                pendingIncidentId: s.pending ? s.pending.incidentId : null,
            });
        }
        return { running: isRunning, tracked: state.size, stats: { ...stats }, devices: list };
    }
    return { start, stop, restart, getStatus, _pollOnceForTest: pollOnce, _state: () => state };
}

let _singleton = null;
function getMonitor() { if (!_singleton) _singleton = createCctvMonitor(); return _singleton; }

module.exports = {
    createCctvMonitor,
    startCctvMonitor: () => getMonitor().start(),
    stopCctvMonitor: () => getMonitor().stop(),
    restartCctvMonitor: () => getMonitor().restart(),
    getCctvMonitorStatus: () => getMonitor().getStatus(),
    getCctvIncidents: (limit = 100) => {
        const all = defaultLoadIncidents();
        const n = Math.max(1, Math.min(Number(limit) || 100, 1000));
        return all.slice(-n).reverse(); // terbaru dulu
    },
    INCIDENTS_FILE,
    DEFAULTS,
};
