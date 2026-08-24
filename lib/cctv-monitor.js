/**
 * Header Doc
 * Purpose: Monitor CCTV publik. Poll netwatch MikroTik berkala, deteksi transisi up→down per
 *          host terdaftar di cctv-registry. Tunggu confirmation window (tahan flap PLN); kalau
 *          masih down → broadcast WA ke pelanggan. Saat pulih (down→up) sebelum window → batal,
 *          atau setelah broadcast → kirim notif "pulih". Tujuan: hilangkan kerja admin manual.
 *
 * Caller: lib/app-runtime.js (start saat boot), lib/process-lifecycle.js (stop), routes/cctv.js (CRUD device + status).
 * Deps: ./cctv-registry, ./mikrotik (getNetwatchList), ./whatsapp-critical-delivery (sendCritical),
 *       ./cctv-power-outage-gate (getContext → baca dying-gasp OLT), ./admin-recipients (getAdminJids).
 * MainFuncs: startCctvMonitor, stopCctvMonitor, restartCctvMonitor, getCctvMonitorStatus.
 *            createCctvMonitor(deps) — testable factory (semua dep dapat di-inject).
 * SideEffects: setInterval timer (unref), file IO incident log database/cctv-incidents.json,
 *              baca-ONLY database/olt_events.sqlite (gerbang mati-listrik, via cctv-power-outage-gate).
 *
 * SEMANTIK:
 *   - Cycle pertama hanya SEED state (tidak broadcast), agar CCTV yang sudah down sebelum start
 *     tidak memicu blast massal.
 *   - Hanya status transisi yang trigger; status sama berturut-turut diabaikan.
 *   - Hanya 'up'→'down' yang masuk pending. 'unknown' diabaikan (netwatch baru aktif).
 *   - Confirmation window per-CCTV (override registry) atau global config.
 *   - Dedup: satu insiden = satu broadcast. Re-down dalam cooldown diabaikan (anti flap PLN-blink).
 *   - Recovery: jika pulih sebelum broadcast → cancel pending. Sesudah broadcast → kirim notif pulih.
 *   - Mati listrik area (sadar-modem): bila OLT mencatat kluster dying-gasp (≥ powerOutageDgThreshold
 *     modem) di sekitar waktu CCTV turun, broadcast pelanggan DITAHAN (gangguan LISTRIK, bukan CCTV)
 *     + 1 ringkasan ke admin. Bukti durabel dari database/olt_events.sqlite (cctv-power-outage-gate).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const uptimeLib = require('./cctv-uptime');

const INCIDENTS_FILE = path.join(__dirname, '..', 'database', 'cctv-incidents.json');
const MAX_INCIDENTS = 3000; // cukup untuk hitung uptime ~30 hari banyak CCTV

const DEFAULTS = {
    enabled: false,
    pollIntervalMs: 60_000,            // 1 menit
    confirmationMinutes: 15,           // default — bisa di-override per-CCTV atau via config
    rebroadcastCooldownMs: 30 * 60_000, // 30 menit: anti flap (PLN-blink) → 1 insiden = 1 broadcast
    notifyRecovery: true,              // kirim WA "pulih" saat CCTV nyala kembali setelah broadcast
    quietHoursEnabled: false,          // jam tenang: tunda WA pelanggan sampai jam tenang berakhir
    quietStart: '22:00',               // format "HH:MM" (zona Asia/Jakarta)
    quietEnd: '06:00',
    quietApplyCustomer: true,          // jam tenang berlaku utk pelanggan (default ya)
    quietApplyCoordinator: true,       // ...nomor pribadi koordinator
    quietApplyGroup: true,             // ...grup WA RT
    aggregateWindowMs: 90_000,         // gabung broadcast DOWN ke nomor yang sama dalam jendela ini (0 = nonaktif)
    massOutageThreshold: 0,            // 0 = nonaktif; mis. 5 → bila ≥5 CCTV down bersamaan, tahan broadcast pelanggan
    massOutageAdminPhone: '',          // WA admin penerima ringkasan gangguan massal (multi: | atau ,)
    massOutageCooldownMs: 30 * 60_000, // jeda antar-alert admin (anti spam ringkasan)
    messageMassOutage:
        "⚠️ *Peringatan Gangguan Massal CCTV*\n\n" +
        "{count} CCTV terdeteksi *mati bersamaan* per {time_local}.\n" +
        "Kemungkinan gangguan PLN/uplink (bukan per-lokasi) — broadcast ke pelanggan *ditahan otomatis*.\n\n" +
        "Mohon cek jaringan inti.",
    // Gerbang SADAR-MODEM (mati listrik area): silang-cek CCTV-down ke log dying-gasp OLT. Bila
    // ≥ powerOutageDgThreshold modem mati bersamaan (dying-gasp) di sekitar waktu CCTV turun →
    // ini gangguan LISTRIK (modem & CCTV mati bersama), bukan kerusakan CCTV → broadcast pelanggan
    // DITAHAN + 1 ringkasan ke admin. Bukti dari database/olt_events.sqlite (cctv-power-outage-gate).
    powerOutageGateEnabled: true,      // fail-safe: gerbang menahan; kalau OLT tak terbaca → kirim spt biasa
    powerOutageDgThreshold: 3,         // ≥ N modem dying-gasp serentak = mati listrik area (samakan oltLosBroadcast.clusterThreshold)
    powerOutageLookbackMs: 6 * 60_000, // jendela mundur dari waktu CCTV turun (dying-gasp mendahului CCTV-unreachable)
    powerOutageForwardMs: 2 * 60_000,  // toleransi maju bila syslog OLT sedikit telat dari deteksi netwatch
    powerOutageAdminPhone: '',         // penerima ringkasan (kosong → pakai massOutageAdminPhone → getAdminJids)
    powerOutageCooldownMs: 30 * 60_000,// jeda antar-ringkasan admin (anti spam saat outage berlarut)
    messagePowerOutage:
        "⚠️ *Mati Listrik Area Terdeteksi (CCTV)*\n\n" +
        "{dg_count} modem pelanggan *mati bersamaan* (dying-gasp) sekitar {time_local}.\n" +
        "CCTV *{cctv_name}* (area {area}) ikut mati — ini gangguan *LISTRIK*, bukan kerusakan CCTV.\n" +
        "Broadcast \"CCTV mati\" ke pelanggan *ditahan otomatis*.\n\n" +
        "Sebagian pelanggan terdampak:\n{sample}\n\n" +
        "Modem & CCTV akan pulih sendiri saat listrik kembali.",
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
    messageDownMulti:
        "Halo {customer_name},\n\n" +
        "🔴 *{count} CCTV* terdeteksi *mati*:\n{list}\n\n" +
        "Kemungkinan listrik atau koneksi internet di lokasi sedang terganggu — mohon dicek ya. " +
        "Bila perlu bantuan, balas pesan ini. 🙏\n\nTerima kasih.",
    messageCoordDown:
        "Halo {coordinator_name},\n\n" +
        "🔴 *{count} CCTV* di area *{area}* terdeteksi *mati*:\n{list}\n\n" +
        "Mohon koordinasikan dengan warga setempat untuk pengecekan (listrik/koneksi). " +
        "Terima kasih. 🙏",
    messageGroupDown:
        "🔴 *Info CCTV — {area}*\n\n" +
        "Halo warga 🙏\n" +
        "Terpantau *{count} CCTV* sedang *mati*:\n{list}\n\n" +
        "Mohon bantu cek bila ada yang tahu kondisi di lokasi (listrik/koneksi). " +
        "Terima kasih atas koordinasinya.",
    messageGroupUp:
        "🟢 *Info CCTV — {area}*\n\n" +
        "CCTV *{cctv_name}* sudah *online kembali* ({up_local}).\n" +
        "Terima kasih atas koordinasinya. 🙏",
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

// Delegasi ke pemilik tunggal format durasi (#b260). Teks ini sampai ke PELANGGAN.
const fmtDuration = (ms) => require("./format-duration").formatDurasi(ms) || "0 menit";
function fmtLocal(d) {
    try { return new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }); }
    catch (_e) { return String(d); }
}
function jakartaHHMM(ms) {
    try { return new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false }).slice(0, 5); }
    catch (_e) { return '00:00'; }
}
function toMinutesOfDay(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
}
// true bila hhmmNow berada dalam [start, end); menangani window yang melewati tengah malam (start > end).
function isWithinQuiet(hhmmNow, start, end) {
    const n = toMinutesOfDay(hhmmNow), s = toMinutesOfDay(start), e = toMinutesOfDay(end);
    if (n === null || s === null || e === null || s === e) return false;
    return s < e ? (n >= s && n < e) : (n >= s || n < e);
}

function renderTemplate(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
}
function splitPhones(p) {
    return String(p == null ? '' : p).split(/[|,]/).map((x) => x.trim()).filter(Boolean);
}

function createCctvMonitor(deps = {}) {
    const getConfig = deps.getConfig || (() => ((global.config && global.config.cctvMonitor) || {}));
    const getDevices = deps.getDevices || (() => require('./cctv-registry').list());
    const fetchNetwatch = deps.fetchNetwatch || (async () => {
        const r = await require('./mikrotik').getNetwatchList({ caller: 'cctv-monitor.poll' });
        return r && r.ok ? (Array.isArray(r.data) ? r.data : []) : [];
    });
    const sendCritical = deps.sendCritical || require('./whatsapp-critical-delivery').sendCritical;
    const getAreaCoordinator = deps.getAreaCoordinator || ((area) => {
        try { return require('./cctv-area-registry').getByName(area); } catch (_e) { return null; }
    });
    // Gerbang mati-listrik: baca kluster dying-gasp OLT (never-throw, fail-open → { dgOnu: 0 }).
    const getPowerOutageContext = deps.getPowerOutageContext
        || ((opts) => require('./cctv-power-outage-gate').getContext(opts));
    // Penerima ringkasan admin bila powerOutageAdminPhone/massOutageAdminPhone kosong.
    const getAdminJids = deps.getAdminJids
        || (() => { try { return require('./admin-recipients').getAdminJids() || []; } catch (_e) { return []; } });
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
    let restored = false;
    let lastMassAlert = 0;
    let lastPowerAlert = 0;  // cooldown ringkasan admin gerbang mati-listrik
    let pendingBatch = [];   // antrean broadcast DOWN untuk digabung per nomor penerima
    let batchTimer = null;
    const stats = { started_at: null, poll_count: 0, last_poll_at: null, last_error: null, broadcasts: 0, recoveries: 0, mass_alerts: 0, mass_suppressed: 0, power_suppressed: 0, power_alerts: 0 };

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
    // Catat waktu pulih ke insiden terbuka terakhir host (utk hitung uptime), apa pun status broadcast-nya.
    function closeLatestIncident(host) {
        const list = loadIncidents();
        for (let i = list.length - 1; i >= 0; i--) {
            const inc = list[i];
            if (String(inc.host || '').trim().toLowerCase() === host && !inc.recoveredAt) {
                list[i] = { ...inc, recoveredAt: new Date(now()).toISOString() };
                saveIncidents(list);
                return;
            }
        }
    }
    function uptimeVars(host) {
        try {
            const inc = loadIncidents();
            const t = now();
            const pct = (p) => uptimeLib.uptimePct(inc, host, t, p).toFixed(1) + '%';
            return { uptime_24h: pct(uptimeLib.DAY_MS), uptime_7d: pct(7 * uptimeLib.DAY_MS), uptime_30d: pct(30 * uptimeLib.DAY_MS) };
        } catch (_e) {
            return { uptime_24h: '-', uptime_7d: '-', uptime_30d: '-' };
        }
    }

    // Vars untuk pesan PELANGGAN (cabang koordinator/grup merakit varsnya sendiri di bawah).
    //
    // `cctv_host` SENGAJA tidak dioper: isinya IP internal (mis. 192.168.99.10) — alamat
    // perangkat di jaringan kita, bukan sesuatu yang layak dibaca pelanggan apalagi tersebar
    // saat pesannya di-forward ke grup RT. Template bawaan kebetulan belum memakainya, tapi
    // halaman /cctv-monitor MENGANJURKANNYA sebagai variabel yang tersedia — jadi kebocoran
    // dulu hanya berjarak satu edit admin. Anjuran itu ikut dicabut di halaman tersebut.
    function buildVars(device, sinceMs, _kind) {
        const t = now();
        return {
            customer_name: device.customerName || 'Pelanggan',
            cctv_name: device.name,
            since_local: fmtLocal(sinceMs),
            up_local: fmtLocal(t),
            minutes_down: fmtDuration(t - sinceMs),
            ...uptimeVars(device.host),
        };
    }

    // Notif PULIH ke SEMUA penerima (pelanggan + koordinator + grup) — mirror recipientsFor broadcast DOWN,
    // jadi grup/koordinator yg dapat "mati" juga dapat "pulih". Pelanggan pakai messageUp (sapaan nama),
    // koordinator/grup pakai messageGroupUp (sapaan area). Dedup per nomor (prioritas coordinator>group>customer).
    async function broadcastUp(device, sinceMs, incidentId, roles) {
        const conf = cfg();
        const allow = Array.isArray(roles) ? new Set(roles) : null; // null = semua (kompat lama)
        const byPhone = new Map();
        for (const rcp of recipientsFor(device)) {
            if (allow && !allow.has(rcp.role)) continue; // notif "pulih" hanya ke jenis yg tadi dapat "mati"
            if (!byPhone.has(rcp.phone)) byPhone.set(rcp.phone, { role: rcp.role, area: rcp.area });
            const e = byPhone.get(rcp.phone);
            if (rcp.role === 'coordinator') { e.role = 'coordinator'; e.area = rcp.area; }
            else if (rcp.role === 'group' && e.role !== 'coordinator') { e.role = 'group'; e.area = rcp.area; }
        }
        let delivered = 0;
        for (const [phone, ent] of byPhone) {
            const text = ent.role === 'customer'
                ? renderTemplate(conf.messageUp || DEFAULTS.messageUp, buildVars(device, sinceMs, 'up'))
                : renderTemplate(conf.messageGroupUp || DEFAULTS.messageGroupUp, {
                    area: ent.area || device.area || '-', cctv_name: device.name, up_local: fmtLocal(now()), ...uptimeVars(device.host),
                });
            try {
                const r = await sendCritical(phone, { text }, { label: 'cctv_up', waitForReadyMs: 8000 });
                if (r && r.delivered) delivered++;
            } catch (e) {
                logger.error && logger.error('[CCTV] sendCritical up', phone, e.message);
            }
        }
        updateIncident(incidentId, {
            notify_up_status: delivered > 0 ? 'sent' : 'failed',
            notify_up_at: new Date(now()).toISOString(),
            notify_up_delivered: delivered,
            notify_up_recipients: byPhone.size,
        });
        return delivered;
    }

    // Hitung jumlah CCTV yang sedang DOWN (lintas host) — basis deteksi gangguan massal.
    function countDown() {
        let n = 0;
        for (const s of state.values()) if (s.status === 'down' && !s.snoozed) n++; // CCTV snooze/maintenance tak ikut hitung gangguan massal
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
    // Kirim 1 ringkasan ke admin saat mati-listrik area menahan broadcast CCTV (cooldown anti-spam).
    // Penerima: powerOutageAdminPhone → massOutageAdminPhone → getAdminJids() (admin di accounts.json).
    function maybePowerOutageAlert(ctx, device, conf) {
        const cooldown = Number(conf.powerOutageCooldownMs) || DEFAULTS.powerOutageCooldownMs;
        if (lastPowerAlert && (now() - lastPowerAlert) < cooldown) return; // sudah dikirim baru-baru ini
        lastPowerAlert = now();
        stats.power_alerts++;
        let phones = String(conf.powerOutageAdminPhone || conf.massOutageAdminPhone || '')
            .split(/[|,]/).map((p) => p.trim()).filter(Boolean);
        if (phones.length === 0) {
            try { phones = (getAdminJids() || []).filter(Boolean); } catch (_e) { phones = []; }
        }
        if (phones.length === 0) return; // tak ada tujuan → cukup tahan broadcast tanpa alert
        const sample = (ctx.customers || []).slice(0, 8).map((n) => '• ' + n).join('\n');
        const text = renderTemplate(conf.messagePowerOutage || DEFAULTS.messagePowerOutage, {
            dg_count: ctx.dgOnu,
            time_local: fmtLocal(ctx.firstAtMs || now()),
            cctv_name: device.name,
            area: device.area || '-',
            sample: sample || '-',
        });
        for (const ph of phones) {
            sendCritical(ph, { text }, { label: 'cctv_power_outage', waitForReadyMs: 8000 }).catch(() => {});
        }
        logger.log && logger.log('[CCTV] power-outage admin alert terkirim (' + ctx.dgOnu + ' modem dying-gasp)');
    }
    // Tangkap "verdikt" mati-listrik untuk host yang PENDING: hitung kluster dying-gasp OLT di sekitar
    // waktu CCTV turun (s.since) dan simpan di pending → dibaca SINKRON oleh onConfirm. Dipanggil dari
    // pollOnce (sudah async). NEVER-THROW: gagal baca → pending TAK ditandai computed (retry poll berikut,
    // fail-open bila tetap gagal sampai konfirmasi).
    async function ensureOutageVerdict(host, s, conf) {
        if (!s || !s.pending || s.pending.outageComputed) return;
        const at = Number.isFinite(s.since) ? s.since : now();
        const lookbackMs = Number(conf.powerOutageLookbackMs) || DEFAULTS.powerOutageLookbackMs;
        const forwardMs = Number(conf.powerOutageForwardMs) || DEFAULTS.powerOutageForwardMs;
        let ctx = null;
        try {
            ctx = await getPowerOutageContext({ at, lookbackMs, forwardMs });
        } catch (e) {
            logger.error && logger.error('[CCTV] power-outage gate error:', e && e.message);
            return; // biarkan outageComputed=false → dicoba lagi poll berikutnya
        }
        if (!s.pending) return; // insiden mungkin sudah beres saat menunggu query
        s.pending.outageDgOnu = (ctx && Number(ctx.dgOnu)) || 0;
        s.pending.outageCustomers = (ctx && ctx.customers) || [];
        s.pending.outageFirstAt = (ctx && ctx.firstAtMs) || null;
        s.pending.outageComputed = true;
    }

    function isQuietNow(conf) {
        if (conf.quietHoursEnabled !== true) return false;
        return isWithinQuiet(jakartaHHMM(now()), conf.quietStart, conf.quietEnd);
    }
    // Apakah jam tenang berlaku untuk peran penerima ini? (default ya, kompat dgn config lama).
    function quietAppliesTo(role, conf) {
        if (role === 'coordinator') return conf.quietApplyCoordinator !== false;
        if (role === 'group') return conf.quietApplyGroup !== false;
        return conf.quietApplyCustomer !== false; // 'customer' & lainnya
    }
    function uniqueRoles(recipients) { return [...new Set((recipients || []).map((r) => r.role))]; }
    // Jam tenang EFEKTIF utk sebuah CCTV — area bisa override global: 'off' (tanpa jam tenang),
    // 'custom' (jendela jam tenang area sendiri), atau 'inherit'/kosong (ikut global).
    function effectiveQuietNow(device, conf) {
        const area = device && device.area ? getAreaCoordinator(device.area) : null;
        const mode = area && area.quietMode;
        if (mode === 'off') return false;
        if (mode === 'custom') {
            return isWithinQuiet(jakartaHHMM(now()), area.quietStart || conf.quietStart || '22:00', area.quietEnd || conf.quietEnd || '06:00');
        }
        return isQuietNow(conf); // inherit (default): ikut jendela global
    }
    function renderDownText(device, sinceMs, conf) {
        const tpl = device.customMessage || conf.messageDown || DEFAULTS.messageDown;
        return renderTemplate(tpl, buildVars(device, sinceMs, 'down'));
    }
    async function sendDownToPhone(phone, text, incidentIds) {
        let delivered = 0;
        try {
            const r = await sendCritical(phone, { text }, { label: 'cctv_down', waitForReadyMs: 8000 });
            if (r && r.delivered) delivered++;
        } catch (e) { logger.error && logger.error('[CCTV] sendCritical down', phone, e.message); }
        for (const id of incidentIds) {
            updateIncident(id, {
                notify_down_status: delivered > 0 ? 'sent' : 'failed',
                notify_down_at: new Date(now()).toISOString(),
                notify_down_delivered: delivered,
                notify_down_recipients: 1,
            });
        }
        return delivered;
    }
    // Daftar penerima broadcast DOWN: pelanggan (jika tak opt-out) + koordinator area (jika ada).
    function recipientsFor(device) {
        const out = [];
        const coord = getAreaCoordinator(device.area);
        const groupActive = !!(coord && coord.enabled !== false && coord.coordinatorGroupId);
        // Opt-in: bila warga/koordinator sudah tergabung di grup RT, japri pribadi ditiadakan (cukup lewat grup).
        const groupCoversCustomer = groupActive && coord.customersInGroup === true;
        const groupCoversCoordinator = groupActive && coord.coordinatorInGroup === true;
        if (device.notifyCustomer !== false && !groupCoversCustomer) {
            for (const ph of splitPhones(device.phone)) out.push({ phone: ph, role: 'customer' });
        }
        if (coord && coord.enabled !== false) {
            // Grup WA RT (jika diset): 1 pesan koordinasi di grup (template khusus grup, menyapa warga).
            if (coord.coordinatorGroupId) {
                out.push({ phone: coord.coordinatorGroupId, role: 'group', area: device.area, coordName: coord.coordinatorName || coord.coordinatorGroupName });
            }
            // Nomor pribadi koordinator — dilewati bila koordinator sudah di grup (terpusat ke grup).
            if (!groupCoversCoordinator) {
                for (const ph of splitPhones(coord.coordinatorPhone)) {
                    out.push({ phone: ph, role: 'coordinator', area: device.area, coordName: coord.coordinatorName });
                }
            }
        }
        return out;
    }
    function renderCustomerText(list, conf) {
        if (list.length === 1) return renderDownText(list[0].device, list[0].sinceMs, conf);
        const listText = list.map((it) => '• ' + it.device.name + ' (sejak ' + fmtLocal(it.sinceMs) + ')').join('\n');
        return renderTemplate(conf.messageDownMulti || DEFAULTS.messageDownMulti, {
            customer_name: list[0].device.customerName || 'Pelanggan', count: list.length, list: listText,
        });
    }
    function renderCoordText(ent, conf) {
        const listText = ent.list.map((it) => '• ' + it.device.name + ' (sejak ' + fmtLocal(it.sinceMs) + ')').join('\n');
        return renderTemplate(conf.messageCoordDown || DEFAULTS.messageCoordDown, {
            coordinator_name: ent.coordName || 'Koordinator', area: ent.area || '-', count: ent.list.length, list: listText,
        });
    }
    function renderGroupText(ent, conf) {
        const listText = ent.list.map((it) => '• ' + it.device.name + ' (sejak ' + fmtLocal(it.sinceMs) + ')').join('\n');
        return renderTemplate(conf.messageGroupDown || DEFAULTS.messageGroupDown, {
            area: ent.area || '-', count: ent.list.length, list: listText,
        });
    }
    // Kirim antrean: kelompokkan per nomor (role koordinator menang) → 1 pesan per nomor.
    function flushBatch() {
        // Hanya kirim DOWN utk CCTV yang MASIH mati saat flush; yang sudah pulih dikeluarkan dari antrean
        // (sudah/akan dapat notif "pulih" sendiri) → cegah DOWN nyusul utk CCTV yang sudah recover.
        const items = pendingBatch.filter((it) => {
            const st = state.get(String((it.device && it.device.host) || '').trim().toLowerCase());
            return st && st.status === 'down';
        });
        pendingBatch = []; batchTimer = null;
        if (!items.length) return;
        const conf = cfg();
        const byPhone = new Map();
        for (const it of items) {
            for (const rcp of (it.recipients || [])) {
                if (!byPhone.has(rcp.phone)) byPhone.set(rcp.phone, { role: rcp.role, area: rcp.area, coordName: rcp.coordName, list: [] });
                const e = byPhone.get(rcp.phone);
                // Prioritas peran utk pemilihan template: coordinator > group > customer.
                if (rcp.role === 'coordinator') { e.role = 'coordinator'; e.area = rcp.area; e.coordName = rcp.coordName; }
                else if (rcp.role === 'group' && e.role !== 'coordinator') { e.role = 'group'; e.area = rcp.area; e.coordName = rcp.coordName; }
                e.list.push(it);
            }
        }
        for (const [phone, ent] of byPhone) {
            let text;
            if (ent.role === 'coordinator') text = renderCoordText(ent, conf);
            else if (ent.role === 'group') text = renderGroupText(ent, conf);
            else text = renderCustomerText(ent.list, conf);
            sendDownToPhone(phone, text, ent.list.map((it) => it.incidentId)).catch(() => {});
        }
    }
    // Antre broadcast DOWN; digabung dalam jendela aggregateWindowMs (0 = kirim segera).
    function enqueueDown(device, sinceMs, incidentId, recipients) {
        pendingBatch.push({ device, sinceMs, incidentId, recipients });
        const winMs = Math.max(0, Number(cfg().aggregateWindowMs) || 0);
        if (winMs === 0) { flushBatch(); return; }
        if (!batchTimer) {
            batchTimer = setTimer(flushBatch, winMs);
            if (batchTimer && typeof batchTimer.unref === 'function') batchTimer.unref();
        }
    }

    // Kirim broadcast DOWN (dipakai onConfirm normal & sweep jam tenang). Set active + catat insiden.
    function broadcastDown(host, device, incidentId, sinceMs) {
        const s = state.get(host);
        if (!s) return;
        const conf = cfg();
        const all = recipientsFor(device);
        if (all.length === 0) {
            // tak ada penerima (pelanggan opt-out & tanpa koordinator) → catat, jangan kirim/aktifkan.
            updateIncident(incidentId, { status: device.notifyCustomer === false ? 'customer_optout' : 'no_recipient' });
            s.deferred = null;
            return;
        }
        // Jam tenang PER-JENIS (jendela bisa di-override per-area): penerima yg jenisnya "kena jam tenang"
        // ditahan (dikirim saat jam tenang berakhir via sweep), sisanya dikirim sekarang.
        const quiet = effectiveQuietNow(device, conf);
        const immediate = [];
        const held = [];
        for (const r of all) {
            if (quiet && quietAppliesTo(r.role, conf)) held.push(r);
            else immediate.push(r);
        }
        if (immediate.length) {
            s.active = { incidentId, broadcastedAt: now(), sinceMs, roles: uniqueRoles(immediate) };
            s.lastBroadcast = now();
            stats.broadcasts++;
            updateIncident(incidentId, { status: 'broadcasted', broadcastedAt: new Date(now()).toISOString() });
            enqueueDown(device, sinceMs, incidentId, immediate);
            logger.log && logger.log('[CCTV] broadcast DOWN ' + device.name + ' (' + host + ') → ' + immediate.length + ' penerima' + (held.length ? ' (+' + held.length + ' ditahan jam tenang)' : ''));
        }
        if (held.length) {
            s.deferred = { incidentId, sinceMs, recipients: held };
            if (!immediate.length) {
                updateIncident(incidentId, { status: 'deferred_quiet' });
                logger.log && logger.log('[CCTV] DOWN ditahan (jam tenang): ' + device.name + ' (' + host + ') → ' + held.length + ' penerima');
            }
        } else {
            s.deferred = null;
        }
    }

    // Kirim pesan TES ke SEMUA penerima device (pelanggan + koordinator + grup) — meniru routing
    // broadcast nyata via recipientsFor, TANPA gating jam tenang/gangguan-massal & tanpa catat insiden.
    // Tiap pesan diberi prefix jelas "PESAN TES" agar penerima tak panik. Dipakai tombol Tes di UI.
    async function runTestBroadcast(device) {
        const conf = cfg();
        const list = [{ device, sinceMs: now() }];
        // Dedupe per nomor/JID + prioritas peran coordinator > group > customer (mirror flushBatch).
        const byPhone = new Map();
        for (const rcp of recipientsFor(device)) {
            if (!byPhone.has(rcp.phone)) byPhone.set(rcp.phone, { role: rcp.role, area: rcp.area, coordName: rcp.coordName });
            const e = byPhone.get(rcp.phone);
            if (rcp.role === 'coordinator') { e.role = 'coordinator'; e.area = rcp.area; e.coordName = rcp.coordName; }
            else if (rcp.role === 'group' && e.role !== 'coordinator') { e.role = 'group'; e.area = rcp.area; e.coordName = rcp.coordName; }
        }
        const results = [];
        for (const [phone, ent] of byPhone) {
            let body;
            if (ent.role === 'coordinator') body = renderCoordText({ area: ent.area, coordName: ent.coordName, list }, conf);
            else if (ent.role === 'group') body = renderGroupText({ area: ent.area, list }, conf);
            else body = renderCustomerText(list, conf);
            const text = '🧪 *PESAN TES — abaikan*\n\n' + body;
            let delivered = false;
            try {
                const r = await sendCritical(phone, { text }, { label: 'cctv_test', waitForReadyMs: 8000 });
                delivered = !!(r && r.delivered);
            } catch (e) { logger.error && logger.error('[CCTV] test broadcast', phone, e.message); }
            results.push({ phone, role: ent.role, delivered });
        }
        return { total: results.length, delivered: results.filter((x) => x.delivered).length, recipients: results };
    }

    function onConfirm(host) {
        const s = state.get(host);
        if (!s || !s.pending) return;
        const device = devByHost().get(host);
        if (!device) { s.pending = null; return; }
        const pending = s.pending; s.pending = null;
        // Guard sinkronisasi: bila CCTV sudah PULIH sebelum window konfirmasi habis, JANGAN broadcast DOWN
        // (statusnya sudah 'up'). Tanpa ini, timer konfirmasi yg terlanjur jalan bisa kirim DOWN basi.
        if (s.status !== 'down') {
            updateIncident(pending.incidentId, { status: 'recovered_before_broadcast' });
            return;
        }
        const conf = cfg();
        // (Opt-out pelanggan kini disaring di recipientsFor → koordinator tetap dinotif.)
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
        // Gerbang SADAR-MODEM (mati listrik area): verdikt dying-gasp OLT ditangkap saat CCTV turun
        // (pending.outageDgOnu, dihitung di pollOnce). Bila ≥ ambang modem mati bersamaan → ini
        // gangguan LISTRIK, bukan kerusakan CCTV → tahan broadcast pelanggan + 1 ringkasan admin.
        // Fail-open: outageDgOnu undefined (gate mati / OLT tak terbaca) → dianggap 0 → kirim spt biasa.
        if (conf.powerOutageGateEnabled !== false) {
            const dgThreshold = Number(conf.powerOutageDgThreshold) || 0;
            const dgOnu = Number(pending.outageDgOnu) || 0;
            if (dgThreshold > 0 && dgOnu >= dgThreshold) {
                stats.power_suppressed++;
                updateIncident(pending.incidentId, { status: 'power_outage_suppressed', dgOnu });
                maybePowerOutageAlert(
                    { dgOnu, customers: pending.outageCustomers, firstAtMs: pending.outageFirstAt },
                    device, conf
                );
                logger.log && logger.log('[CCTV] mati-listrik area (' + dgOnu + ' modem dying-gasp) → broadcast pelanggan DITAHAN: ' + device.name + ' (' + host + ')');
                return; // tak set active → tak ada notif "pulih" utk insiden yang ditahan
            }
        }
        // Jam tenang (per-jenis) ditangani di broadcastDown: penerima yg kena ditahan, sisanya dikirim.
        broadcastDown(host, device, pending.incidentId, s.since);
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
        closeLatestIncident(host); // rekam waktu pulih (utk uptime) — semua jenis insiden
        // (a) pulih sebelum broadcast → batal
        if (s && s.pending) cancelPending(host, 'recovered_before_broadcast');
        // (b) penerima yg masih DITAHAN jam tenang (belum dapat "mati") → batalkan, tak perlu "pulih".
        if (s && s.deferred) {
            if (!s.active) updateIncident(s.deferred.incidentId, { status: 'deferred_resolved' });
            s.deferred = null;
        }
        // (c) pulih setelah broadcast → notif "pulih" sekali, HANYA ke jenis yg tadi dapat "mati".
        // DOWN yg mungkin masih di antrean agregasi otomatis di-skip flushBatch (status host sudah 'up').
        if (s && s.active && device) {
            const conf = cfg();
            const activeId = s.active.incidentId; const sinceMs = s.active.sinceMs; const roles = s.active.roles;
            s.active = null;
            stats.recoveries++;
            if (conf.notifyRecovery !== false) {
                broadcastUp(device, sinceMs, activeId, roles).catch(() => {});
                logger.log && logger.log('[CCTV] UP pulih → notif: ' + device.name + ' (' + host + ')');
            }
            updateIncident(activeId, { recoveredAt: new Date(now()).toISOString(), status: 'recovered' });
        }
    }

    // Tahan-restart: rekonstruksi state in-flight dari riwayat insiden setelah seed poll pertama.
    // Insiden terbuka utk host yang MASIH mati dipulihkan; yang sudah pulih saat monitor off → ditutup.
    function restoreInFlight() {
        let incidents;
        try { incidents = loadIncidents(); } catch (_e) { return; }
        if (!Array.isArray(incidents) || incidents.length === 0) return;
        const conf = cfg();
        const openByHost = new Map();
        for (const inc of incidents) {
            if (!inc || inc.recoveredAt || !inc.host) continue;
            openByHost.set(String(inc.host).trim().toLowerCase(), inc); // terbaru menang (urutan kronologis)
        }
        let n = 0;
        for (const [host, s] of state) {
            const inc = openByHost.get(host);
            if (!inc) continue;
            if (s.status === 'down') {
                const detected = Date.parse(inc.detectedAt);
                if (Number.isFinite(detected)) s.since = detected;
                if (inc.status === 'pending') {
                    const minutes = Number.isFinite(+inc.confirmationMinutes) && +inc.confirmationMinutes > 0
                        ? +inc.confirmationMinutes : conf.confirmationMinutes;
                    const remaining = Math.max(1000, (minutes * 60_000) - Math.max(0, now() - (s.since || now())));
                    const timer = setTimer(() => onConfirm(host), remaining);
                    if (timer && typeof timer.unref === 'function') timer.unref();
                    s.pending = { incidentId: inc.incidentId, timer, detectedAt: s.since };
                    n++;
                } else if (inc.status === 'deferred_quiet') {
                    const dev = devByHost().get(host);
                    const held = dev ? recipientsFor(dev).filter((r) => quietAppliesTo(r.role, conf)) : [];
                    s.deferred = { incidentId: inc.incidentId, sinceMs: s.since, recipients: held };
                    n++;
                } else if (inc.status === 'broadcasted') {
                    const bAt = Date.parse(inc.broadcastedAt);
                    const dev = devByHost().get(host);
                    s.active = { incidentId: inc.incidentId, broadcastedAt: Number.isFinite(bAt) ? bAt : now(), sinceMs: s.since, roles: dev ? uniqueRoles(recipientsFor(dev)) : [] };
                    s.lastBroadcast = Number.isFinite(bAt) ? bAt : now();
                    n++;
                }
                // cooldown_skipped / mass_suppressed: tak ada aksi tertunda → biarkan.
            } else {
                // host sudah pulih saat monitor mati → tutup insiden (akurasi uptime), tanpa notif susulan.
                updateIncident(inc.incidentId, { status: 'recovered', recoveredAt: new Date(now()).toISOString() });
            }
        }
        if (n) logger.log && logger.log('[CCTV] restore in-flight dari riwayat: ' + n + ' insiden');
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
                // Maintenance/snooze: status TETAP dilacak (biar baseline akurat), TAPI alert ditahan
                // selama snooze aktif. Saat snooze berakhir, rekonsiliasi sekali sesuai kondisi nyata.
                const snoozing = !!(device.snoozeUntil && now() < device.snoozeUntil);
                const justUnsnoozed = s.snoozed === true && !snoozing;
                s.snoozed = snoozing;
                if (status !== s.status) {
                    const prev = s.status; s.status = status; s.since = now();
                    if (!seeded) continue; // cycle pertama: seed only
                    if (snoozing) continue; // selama snooze: status terlacak, alert ditahan
                    if (status === 'down' && prev === 'up') {
                        startPending(host, device, conf);
                    } else if (status === 'up' && prev === 'down') {
                        onRecovery(host);
                    }
                } else if (justUnsnoozed) {
                    // Snooze baru berakhir tanpa perubahan status → rekonsiliasi sekali:
                    if (status === 'down' && !s.active && !s.pending) startPending(host, device, conf); // masih mati → mulai alert
                    else if (status === 'up' && s.active) onRecovery(host); // pulih saat snooze → tutup insiden
                }
            }
            if (!restored) { restoreInFlight(); restored = true; } // sekali, setelah seed poll pertama
            // Gerbang mati-listrik: tangkap verdikt dying-gasp OLT untuk tiap host PENDING (baru maupun
            // hasil restore) → dibaca sinkron oleh onConfirm. Query async ditaruh di sini (pollOnce sudah
            // async) agar onConfirm tetap sinkron. Never-throw per-host; verdikt di-cache di gate.
            if (conf.powerOutageGateEnabled !== false && (Number(conf.powerOutageDgThreshold) || 0) > 0) {
                for (const [phost, ps] of state) {
                    if (ps.pending && !ps.pending.outageComputed) {
                        await ensureOutageVerdict(phost, ps, conf);
                    }
                }
            }
            // Sweep "jam tenang": kirim penerima yang DITAHAN begitu jam tenang berakhir & masih mati.
            for (const [dhost, ds] of state) {
                if (!ds.deferred) continue;
                const dev = devByHost().get(dhost);
                if (ds.status === 'up') {
                    if (!ds.active) updateIncident(ds.deferred.incidentId, { status: 'deferred_resolved' });
                    ds.deferred = null;
                } else if (ds.status === 'down' && !(dev && effectiveQuietNow(dev, conf))) {
                    const held = ds.deferred.recipients || [];
                    if (dev && held.length) {
                        const incidentId = ds.deferred.incidentId; const sinceMs = ds.deferred.sinceMs;
                        const roles = uniqueRoles(held);
                        if (ds.active && ds.active.incidentId === incidentId) ds.active.roles = [...new Set([...(ds.active.roles || []), ...roles])];
                        else ds.active = { incidentId, broadcastedAt: now(), sinceMs, roles };
                        ds.lastBroadcast = now();
                        updateIncident(incidentId, { status: 'broadcasted', broadcastedAt: new Date(now()).toISOString() });
                        enqueueDown(dev, sinceMs, incidentId, held);
                        logger.log && logger.log('[CCTV] jam tenang berakhir → kirim ' + held.length + ' penerima tertahan: ' + dev.name + ' (' + dhost + ')');
                    } else if (!dev) {
                        updateIncident(ds.deferred.incidentId, { status: 'deferred_cancelled' });
                    }
                    ds.deferred = null;
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
        isRunning = true; seeded = false; restored = false; state.clear();
        pendingBatch = []; batchTimer = null;
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
        const devMap = devByHost();
        for (const [host, s] of state) {
            const dev = devMap.get(host);
            const snoozeUntil = (dev && Number(dev.snoozeUntil)) || null;
            list.push({
                host, status: s.status, since: s.since,
                pending: !!s.pending, broadcasted: !!s.active,
                inNetwatch: typeof s.inNetwatch === 'boolean' ? s.inNetwatch : null,
                pendingIncidentId: s.pending ? s.pending.incidentId : null,
                snoozeUntil, snoozed: !!(snoozeUntil && now() < snoozeUntil),
            });
        }
        return { running: isRunning, tracked: state.size, stats: { ...stats }, devices: list };
    }
    return { start, stop, restart, getStatus, runTestBroadcast, _pollOnceForTest: pollOnce, _state: () => state };
}

let _singleton = null;
function getMonitor() { if (!_singleton) _singleton = createCctvMonitor(); return _singleton; }

module.exports = {
    createCctvMonitor,
    startCctvMonitor: () => getMonitor().start(),
    stopCctvMonitor: () => getMonitor().stop(),
    restartCctvMonitor: () => getMonitor().restart(),
    getCctvMonitorStatus: () => getMonitor().getStatus(),
    runCctvTestBroadcast: (device) => getMonitor().runTestBroadcast(device),
    getCctvIncidents: (limit = 100) => {
        const all = defaultLoadIncidents();
        const n = Math.max(1, Math.min(Number(limit) || 100, 3000));
        return all.slice(-n).reverse(); // terbaru dulu
    },
    INCIDENTS_FILE,
    DEFAULTS,
    isWithinQuiet,
};
