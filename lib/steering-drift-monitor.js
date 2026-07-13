/**
 * Header Doc
 * Purpose: Pemantau "drift steering" — mengingatkan admin (WA) bila peta pool hardcoded (jaring
 *          pengaman resolver, `upstream-path-resolver.DEFAULT_PATH_POOLS` / config.pathPools) tak
 *          lagi cocok dengan address-list PROFIL live di router (`freedns`/`lokaldns`). Resolver
 *          jalur (`lib/customer-path-resolver`) sudah presisi memakai profil live; monitor ini
 *          menjaga agar JARING PENGAMAN tetap akurat untuk saat router tak terbaca. Tick harian +
 *          sekali saat boot (tertunda). Alert DIREDAM: hanya kirim ulang bila tanda-tangan drift
 *          berubah atau sudah >24 jam — state di disk supaya selamat dari pm2 restart (7-13×/hari).
 * Caller: `lib/app-runtime.js` (startSteeringDriftMonitor saat boot; gate
 *         `config.steeringDriftMonitor.enabled === true`, default MATI).
 * Deps: `./customer-path-resolver` (getSteeringSnapshot + computeSteeringDrift),
 *       `./whatsapp-critical-delivery` (sendCritical), `./admin-recipients` (getAdminJids),
 *       `./response-template-helper` (renderResponseTemplate), `fs`, `path`.
 * MainFuncs: `startSteeringDriftMonitor`, `stopSteeringDriftMonitor`, `checkOnce`.
 * SideEffects: Kirim WA ke admin (best-effort, tak pernah throw ke caller); tulis state debounce
 *              JSON; timer in-memori (single-instance). Baca router READ-ONLY via resolver.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000; // beri WA/HTTP init duluan sebelum cek pertama.

let tickTimer = null;
let startupTimer = null;

function resolveStatePath() {
    const base = process.env.NODE_ENV === 'test' ? 'steering-drift-state_test.json' : 'steering-drift-state.json';
    return path.join(__dirname, '..', 'database', base);
}

function loadState(statePath = resolveStatePath()) {
    try {
        if (!fs.existsSync(statePath)) return { signature: '', lastAlertAt: 0 };
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : { signature: '', lastAlertAt: 0 };
    } catch (_e) {
        return { signature: '', lastAlertAt: 0 };
    }
}

function saveState(state, statePath = resolveStatePath()) {
    try {
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (err) {
        console.warn(`[STEER-DRIFT] Gagal menyimpan state: ${err.message}`);
    }
}

/** Tanda-tangan stabil dari daftar drift (urut) untuk debounce. */
function driftSignature(drift) {
    return drift.map((d) => `${d.cidr}:${d.poolPath}>${d.livePath}`).sort().join('|');
}

function buildAlertText(drift, renderResponseTemplate) {
    const detail = drift.map((d) => `• ${d.cidr}: peta→${d.poolPath}, live→${d.livePath}`).join('\n');
    const fallback = [
        '⚠️ *Drift Steering Terdeteksi*',
        '',
        'Peta pool (jaring pengaman resolver jalur) tak lagi cocok dengan address-list live di router:',
        '${detail}',
        '',
        'Resolver tetap presisi memakai profil live (freedns/lokaldns); ini hanya JARING PENGAMAN saat router tak terbaca.',
        'Tindakan: samakan `DEFAULT_PATH_POOLS`/`config.upstreamMonitor.pathPools` dengan address-list, atau kembalikan address-list.',
    ].join('\n');
    return renderResponseTemplate('steering_drift_alert', fallback, { detail, count: String(drift.length) });
}

function defaultDeps() {
    return {
        getSnapshot: () => require('./customer-path-resolver').getSteeringSnapshot(),
        computeDrift: (snap) => require('./customer-path-resolver').computeSteeringDrift(snap),
        send: (jid, text, opts) => require('./whatsapp-critical-delivery').sendCritical(jid, text, opts),
        getAdminJids: () => require('./admin-recipients').getAdminJids(),
        renderResponseTemplate: (key, fallback, data) => require('./response-template-helper').renderResponseTemplate(key, fallback, data),
        loadState,
        saveState,
        nowMs: () => Date.now(),
    };
}

/**
 * Satu siklus cek drift. Tak pernah throw. Mengembalikan ringkasan untuk test/log.
 * @returns {Promise<{drift:Array, alerted:boolean, reason:string}>}
 */
async function checkOnce(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    let snapshot;
    try {
        snapshot = await deps.getSnapshot();
    } catch (_e) {
        return { drift: [], alerted: false, reason: 'router-unreadable' };
    }
    let drift = [];
    try {
        drift = deps.computeDrift(snapshot) || [];
    } catch (err) {
        console.warn(`[STEER-DRIFT] computeDrift gagal: ${err.message}`);
        return { drift: [], alerted: false, reason: 'compute-error' };
    }
    if (!drift.length) return { drift, alerted: false, reason: 'aligned' };

    console.warn(`[STEER-DRIFT] ${drift.length} subnet drift: ` + drift.map((d) => `${d.cidr}(peta ${d.poolPath}≠live ${d.livePath})`).join(', '));

    const sig = driftSignature(drift);
    const state = deps.loadState();
    const now = deps.nowMs();
    if (state.signature === sig && now - (state.lastAlertAt || 0) < DAY_MS) {
        return { drift, alerted: false, reason: 'debounced' };
    }

    let sent = 0;
    try {
        const text = buildAlertText(drift, deps.renderResponseTemplate);
        const jids = deps.getAdminJids() || [];
        for (const jid of jids) {
            try {
                await deps.send(jid, text, { label: 'steering-drift' });
                sent++;
            } catch (err) {
                console.warn(`[STEER-DRIFT] gagal kirim ke ${jid}: ${err.message}`);
            }
        }
    } catch (err) {
        console.warn(`[STEER-DRIFT] gagal siapkan alert: ${err.message}`);
    }
    deps.saveState({ signature: sig, lastAlertAt: now });
    return { drift, alerted: sent > 0, reason: sent > 0 ? 'alerted' : 'send-failed' };
}

function isEnabled() {
    const cfg = (global.config && global.config.steeringDriftMonitor) || {};
    return cfg.enabled === true;
}

function startSteeringDriftMonitor() {
    if (tickTimer) return;
    if (!isEnabled()) {
        console.log('[STEER-DRIFT] Nonaktif (set config.steeringDriftMonitor.enabled=true untuk mengaktifkan)');
        return;
    }
    console.log('[STEER-DRIFT] Start (cek pertama ~30s setelah boot, lalu harian)');
    startupTimer = setTimeout(() => { checkOnce().catch(() => {}); }, STARTUP_DELAY_MS);
    if (startupTimer.unref) startupTimer.unref();
    tickTimer = setInterval(() => { checkOnce().catch(() => {}); }, DAY_MS);
    if (tickTimer.unref) tickTimer.unref();
}

function stopSteeringDriftMonitor() {
    if (tickTimer) clearInterval(tickTimer);
    if (startupTimer) clearTimeout(startupTimer);
    tickTimer = null;
    startupTimer = null;
}

module.exports = {
    startSteeringDriftMonitor,
    stopSteeringDriftMonitor,
    checkOnce,
    _internal: { driftSignature, buildAlertText, resolveStatePath, loadState, saveState },
};
