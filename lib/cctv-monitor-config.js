/**
 * Header Doc
 * Purpose: Helper MURNI untuk pengaturan monitor CCTV esensial (enabled / confirmationMinutes /
 *          notifyRecovery) — bangun patch config dari input admin + tampilan publik. Dipisah dari
 *          route agar validasi/merge dapat diuji tanpa fs/global/monitor.
 * Caller: routes/cctv.js (GET/POST /api/cctv/config).
 * Deps: ./cctv-monitor (DEFAULTS).
 * MainFuncs: buildCctvConfigPatch, toPublicView.
 * SideEffects: none (fungsi murni).
 */
'use strict';

const { DEFAULTS } = require('./cctv-monitor');
const { DEFAULT_NETWATCH } = require('./cctv-netwatch-script');

const WINDOW_MIN = 1;
const WINDOW_MAX = 1440; // 24 jam

function toBool(v) {
    return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * Bangun objek `cctvMonitor` baru dari config saat ini + patch user (hanya field esensial).
 * Field yang tidak dikirim dipertahankan apa adanya. Throw Error bila confirmationMinutes invalid.
 * @param {object} current config.cctvMonitor saat ini
 * @param {object} body input dari admin {enabled?, confirmationMinutes?, notifyRecovery?}
 * @returns {object} objek cctvMonitor hasil merge
 */
function buildCctvConfigPatch(current, body) {
    const next = { ...(current || {}) };
    const b = body || {};

    if (b.enabled !== undefined) next.enabled = toBool(b.enabled);
    if (b.notifyRecovery !== undefined) next.notifyRecovery = toBool(b.notifyRecovery);

    if (b.confirmationMinutes !== undefined && b.confirmationMinutes !== null && b.confirmationMinutes !== '') {
        const m = parseInt(b.confirmationMinutes, 10);
        if (!Number.isFinite(m) || m < WINDOW_MIN || m > WINDOW_MAX) {
            throw new Error('Window konfirmasi harus ' + WINDOW_MIN + '–' + WINDOW_MAX + ' menit.');
        }
        next.confirmationMinutes = m;
    }

    // Template pesan default global. String kosong = pakai default bawaan (monitor fallback).
    if (b.messageDown !== undefined) next.messageDown = String(b.messageDown);
    if (b.messageUp !== undefined) next.messageUp = String(b.messageUp);

    // Guard gangguan massal (anti-spam saat PLN/uplink mati).
    if (b.massOutageThreshold !== undefined) {
        const raw = b.massOutageThreshold;
        if (raw === '' || raw === null) {
            next.massOutageThreshold = 0;
        } else {
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || n < 0 || n > 1000) {
                throw new Error('Ambang gangguan massal harus 0–1000 (0 = nonaktif).');
            }
            next.massOutageThreshold = n;
        }
    }
    if (b.massOutageAdminPhone !== undefined) next.massOutageAdminPhone = String(b.massOutageAdminPhone).trim();
    if (b.messageMassOutage !== undefined) next.messageMassOutage = String(b.messageMassOutage);

    // Sub-config netwatch/Telegram (provisioning script on-up/on-down untuk teknisi).
    if (b.netwatch && typeof b.netwatch === 'object') {
        const nw = { ...((current && current.netwatch) || {}) };
        const n = b.netwatch;
        if (n.botToken !== undefined) nw.botToken = String(n.botToken).trim();
        if (n.chatId !== undefined) nw.chatId = String(n.chatId).trim();
        if (n.interval !== undefined) nw.interval = String(n.interval).trim() || '5s';
        if (n.timeout !== undefined) nw.timeout = String(n.timeout).trim() || '1s';
        if (n.msgUp !== undefined) nw.msgUp = String(n.msgUp);
        if (n.msgDown !== undefined) nw.msgDown = String(n.msgDown);
        next.netwatch = nw;
    }

    return next;
}

// Nilai efektif template: pakai kustom bila ada isinya, jika kosong jatuh ke default bawaan.
function effectiveMsg(value, fallback) {
    return value && String(value).trim() ? String(value) : fallback;
}

/** Tampilan publik field esensial (untuk GET dan echo POST). */
function toPublicView(cfg) {
    const raw = cfg || {};
    const c = { ...DEFAULTS, ...raw };
    return {
        enabled: c.enabled === true,
        confirmationMinutes: c.confirmationMinutes,
        notifyRecovery: c.notifyRecovery !== false,
        messageDown: effectiveMsg(raw.messageDown, DEFAULTS.messageDown),
        messageUp: effectiveMsg(raw.messageUp, DEFAULTS.messageUp),
        massOutageThreshold: Number.isFinite(+c.massOutageThreshold) ? +c.massOutageThreshold : 0,
        massOutageAdminPhone: c.massOutageAdminPhone || '',
        messageMassOutage: effectiveMsg(raw.messageMassOutage, DEFAULTS.messageMassOutage),
        netwatch: toNetwatchView(raw.netwatch),
    };
}

// Tampilan publik sub-config netwatch (default terisi bila belum di-set).
function toNetwatchView(rawNw) {
    const nw = { ...DEFAULT_NETWATCH, ...(rawNw || {}) };
    return {
        botToken: nw.botToken || '',
        chatId: nw.chatId || '',
        interval: nw.interval || '5s',
        timeout: nw.timeout || '1s',
        msgUp: nw.msgUp || DEFAULT_NETWATCH.msgUp,
        msgDown: nw.msgDown || DEFAULT_NETWATCH.msgDown,
    };
}

module.exports = { buildCctvConfigPatch, toPublicView, WINDOW_MIN, WINDOW_MAX };
