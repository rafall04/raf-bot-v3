/**
 * Header Doc
 * Purpose: Sinkronisasi AMAN daftar CCTV (registry) → entri netwatch MikroTik. Dipakai auto-sync
 *          CRUD halaman admin (add/edit/delete) + tombol "Sinkron ulang". Prinsip keselamatan
 *          (dari review adversarial 5-sudut, #b314):
 *            (1) Sasar entri PERSIS by `.id` (disimpan di device.netwatchId); fallback host+klasifikasi.
 *            (2) HANYA sentuh entri milik-CCTV (`classifyEntry().klass==='cctv'`). Entri OLT/infra/
 *                backhaul yang kebetulan sehost TAK PERNAH ditimpa/dihapus — bila tabrakan IP, TOLAK
 *                dengan peringatan (jangan clobber). Router prod punya 28 entri campuran.
 *            (3) Preserve-on-empty: jangan pernah mengosongkan script/interval/timeout/disabled yang
 *                sudah ada; script hanya ditulis bila config Telegram valid DAN berbeda dari router
 *                (adopt entri yang sudah benar → script dipertahankan, bukan ditimpa).
 *            (4) Urutan aman: ganti-IP → set/add di host BARU dulu, baru hapus entri lama (tak pernah
 *                nol coverage). Delete → hapus netwatch dulu (dipanggil sebelum registry.remove).
 * Caller: routes/cctv.js (POST/PUT/DELETE /devices, /resync). Gate config.cctvMonitor.autoNetwatch.
 * Deps: ./mikrotik (getNetwatchFull/setNetwatch/removeNetwatch), ./cctv-netwatch-script
 *       (buildNetwatchScripts/isValidNetwatchConfig), ./cctv-netwatch-discovery (classifyEntry),
 *       ./cctv-registry (normalizeHost). Config Telegram dari global.config.cctvMonitor.netwatch.
 * MainFuncs: syncDevice, removeForDevice, netwatchHealth.
 * SideEffects: MENULIS netwatch MikroTik (add/set/remove) — hanya entri milik-CCTV.
 */
'use strict';

const mikrotik = require('./mikrotik');
const netscript = require('./cctv-netwatch-script');
const { classifyEntry } = require('./cctv-netwatch-discovery');
const { normalizeHost } = require('./cctv-registry');

function nwConfig() {
    return (global.config && global.config.cctvMonitor && global.config.cctvMonitor.netwatch) || {};
}

async function fetchFull() {
    const r = await mikrotik.getNetwatchFull({ caller: 'cctv.sync' });
    if (!r || !r.ok || !Array.isArray(r.data)) {
        throw new Error((r && (r.message || r.errorCode)) || 'Gagal membaca netwatch dari MikroTik.');
    }
    return r.data;
}

// Entri milik-CCTV di sebuah host: cocok by netwatchId (paling presisi) ATAU host sama + klass CCTV.
function ownedEntriesAt(full, host, netwatchId) {
    const h = normalizeHost(host);
    return full.filter((e) => {
        if (netwatchId && String(e.id) === String(netwatchId)) return true;
        if (normalizeHost(e.host) !== h) return false;
        return classifyEntry(e).klass === 'cctv';
    });
}

/**
 * Sinkron satu device CCTV ke netwatch. NEVER-THROW-ke-caller lewat return {ok:false,...}.
 * @returns {Promise<{ok, mode, netwatchId, telegram, warnings:string[], message}>}
 */
async function syncDevice(device, opts = {}) {
    const warnings = [];
    let full;
    try { full = await fetchFull(); } catch (e) { return { ok: false, mode: 'error', netwatchId: device.netwatchId || null, telegram: false, warnings, message: e.message }; }

    const cfg = nwConfig();
    const telegram = netscript.isValidNetwatchConfig(cfg);
    const scripts = telegram
        ? netscript.buildNetwatchScripts(cfg, { name: device.name, area: device.area, host: device.host })
        : { upScript: '', downScript: '' };
    const host = normalizeHost(device.host);

    // Resolusi entri milik-CCTV yang sudah ada.
    const owned = ownedEntriesAt(full, device.host, device.netwatchId);
    let resultId = device.netwatchId || null;
    let mode;

    if (owned.length > 0) {
        const target = owned[0];
        if (owned.length > 1) warnings.push(`Ada ${owned.length} entri netwatch CCTV di IP ${device.host} — memakai yang pertama; rapikan duplikat bila perlu.`);
        const setParams = { id: target.id, host: device.host, comment: device.name };
        // Script: hanya tulis bila config valid DAN beda dari router (preserve entri yg sudah benar).
        if (telegram && (scripts.upScript !== (target.up_script || '') || scripts.downScript !== (target.down_script || ''))) {
            setParams.upScript = scripts.upScript;
            setParams.downScript = scripts.downScript;
        }
        // disabled ikut device.enabled — hanya bila berbeda dari kondisi router (jangan clobber disable manual tanpa alasan).
        const wantDisabled = device.enabled === false;
        if ((String(target.disabled) === 'true') !== wantDisabled) setParams.disabled = wantDisabled;
        const r = await mikrotik.setNetwatch(setParams, { caller: 'cctv.sync.set' });
        if (!r || !r.ok) return { ok: false, mode: 'set', netwatchId: target.id, telegram, warnings, message: (r && r.message) || 'Gagal set netwatch.' };
        resultId = target.id;
        mode = 'set';
    } else {
        // Tak ada entri milik-CCTV. Tabrakan IP dgn entri NON-CCTV → TOLAK (jangan clobber infra).
        const foreign = full.filter((e) => normalizeHost(e.host) === host);
        if (foreign.length > 0) {
            return { ok: false, mode: 'conflict', netwatchId: null, telegram, warnings, message: `IP ${device.host} sudah dipakai entri netwatch non-CCTV ("${foreign[0].comment || foreign[0].host}") — netwatch TIDAK diubah. Ganti IP CCTV atau rapikan netwatch dulu.` };
        }
        if (!telegram) warnings.push('Bot Token/Chat ID Telegram belum diisi — entri dibuat TANPA notifikasi Telegram (status tetap terpantau untuk broadcast WA).');
        const r = await mikrotik.setNetwatch(
            { host: device.host, comment: device.name, interval: cfg.interval, timeout: cfg.timeout, upScript: scripts.upScript, downScript: scripts.downScript, disabled: device.enabled === false },
            { caller: 'cctv.sync.add' }
        );
        if (!r || !r.ok) return { ok: false, mode: 'add', netwatchId: null, telegram, warnings, message: (r && r.message) || 'Gagal menambah netwatch.' };
        resultId = (r.data && r.data.id) || null;
        mode = 'add';
    }

    // Ganti-IP: setelah host BARU sukses, hapus entri milik-CCTV di host LAMA (tak pernah nol coverage).
    if (opts.oldHost && normalizeHost(opts.oldHost) !== host) {
        const oldOwned = ownedEntriesAt(full, opts.oldHost, opts.oldNetwatchId);
        if (oldOwned.length > 0) {
            const rr = await mikrotik.removeNetwatch({ ids: oldOwned.map((e) => e.id), host: opts.oldHost }, { caller: 'cctv.sync.rehost' });
            if (!rr || !rr.ok) warnings.push(`Entri netwatch lama di IP ${opts.oldHost} gagal dihapus — hapus manual bila perlu.`);
        }
    }

    return { ok: true, mode, netwatchId: resultId, telegram, warnings, message: mode === 'add' ? 'Entri netwatch dibuat di MikroTik.' : 'Entri netwatch disinkron.' };
}

/**
 * Hapus entri netwatch milik CCTV ini (dipanggil SEBELUM registry.remove). Entri non-CCTV sehost
 * DIBIARKAN. never-throw → {ok:false} bila router gagal (caller pertahankan device untuk retry).
 * @returns {Promise<{ok, removed, skippedNonCctv:string[], message}>}
 */
async function removeForDevice(device) {
    let full;
    try { full = await fetchFull(); } catch (e) { return { ok: false, removed: 0, skippedNonCctv: [], message: e.message }; }
    const h = normalizeHost(device.host);
    const hostEntries = full.filter((e) => normalizeHost(e.host) === h);
    const owned = ownedEntriesAt(full, device.host, device.netwatchId);
    const ownedIds = new Set(owned.map((e) => String(e.id)));
    const skippedNonCctv = hostEntries.filter((e) => !ownedIds.has(String(e.id))).map((e) => e.comment || e.host);

    if (owned.length === 0) {
        return { ok: true, removed: 0, skippedNonCctv, message: skippedNonCctv.length ? `Tak ada entri netwatch milik-CCTV di IP ${device.host} (${skippedNonCctv.length} entri lain DIBIARKAN).` : 'Tak ada entri netwatch untuk dihapus.' };
    }
    const r = await mikrotik.removeNetwatch({ ids: owned.map((e) => e.id), host: device.host }, { caller: 'cctv.sync.remove' });
    if (!r || !r.ok) return { ok: false, removed: 0, skippedNonCctv, message: (r && r.message) || 'Gagal menghapus netwatch.' };
    return { ok: true, removed: (r.data && r.data.removed) != null ? r.data.removed : owned.length, skippedNonCctv, message: `Entri netwatch dihapus.${skippedNonCctv.length ? ` (${skippedNonCctv.length} entri non-CCTV di IP sama DIBIARKAN.)` : ''}` };
}

/**
 * Status netwatch per-device untuk kolom kesehatan di UI. READ-ONLY (1 fetch).
 * @returns {Promise<{ok, telegram, devices: Array<{id,host,inNetwatch,cctvOwned,conformant,disabled,netwatchId,telegramScript}>}>}
 */
async function netwatchHealth(devices) {
    let full;
    try { full = await fetchFull(); } catch (e) { return { ok: false, message: e.message, devices: [] }; }
    const telegram = netscript.isValidNetwatchConfig(nwConfig());
    const out = (devices || []).map((d) => {
        const owned = ownedEntriesAt(full, d.host, d.netwatchId);
        const target = owned[0] || null;
        const cls = target ? classifyEntry(target) : null;
        const hasScript = !!(target && (target.up_script || target.down_script));
        return {
            id: d.id,
            host: d.host,
            inNetwatch: full.some((e) => normalizeHost(e.host) === normalizeHost(d.host)),
            cctvOwned: !!target,
            conformant: !!(cls && cls.conformant),
            disabled: !!(target && String(target.disabled) === 'true'),
            netwatchId: target ? target.id : null,
            telegramScript: hasScript,
        };
    });
    return { ok: true, telegram, devices: out };
}

module.exports = { syncDevice, removeForDevice, netwatchHealth, _ownedEntriesAt: ownedEntriesAt };
