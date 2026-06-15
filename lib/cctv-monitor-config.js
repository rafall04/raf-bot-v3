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
    };
}

module.exports = { buildCctvConfigPatch, toPublicView, WINDOW_MIN, WINDOW_MAX };
