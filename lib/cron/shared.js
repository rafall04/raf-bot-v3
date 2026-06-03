/**
 * Header Doc
 * Purpose: Shared helper untuk seluruh job cron (reminder, isolir, kompensasi, speed-revert, redaman, telegram-backup). Berisi `delay`, `isValidCron`, `loadCronConfig`, `safeSendMessage`, `getNestedValue`, dan `replacer` yang dipakai cross-job. Dipisah agar setiap job file hanya berurusan dengan logic spesifik domainnya.
 * Caller: `lib/cron/jobs/*.js`, `lib/cron.js` (composer).
 * Deps: `node-cron` (validator-only via cron-validator), `whatsapp-delivery-service` (sendMessage), `whatsapp-gateway` (state probe).
 * MainFuncs: `delay`, `isValidCron`, `replacer`, `getNestedValue`, `loadCronConfig`, `safeSendMessage`.
 * SideEffects: `safeSendMessage` mengirim payload WhatsApp via gateway facade. Lainnya pure.
 */
"use strict";

const fs = require('fs');
const path = require('path');
const cronValidator = require('cron-validator');

const { sendMessage } = require('../whatsapp-delivery-service');
const { getConnectionState, isReady } = require('../whatsapp-gateway');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidCron(cronExpression) {
    // If starts with #, it's commented out (disabled) - consider it valid
    if (cronExpression && cronExpression.trim().startsWith('#')) {
        return false; // Valid format but disabled
    }
    return cronValidator.isValidCron(cronExpression, { alias: true, allowBlankDay: true });
}

// Helper function to safely get nested property value (adapted from lib/wifi.js)
const getNestedValue = (obj, path) => {
    if (!path) return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
            current = current[part];
        } else {
            return undefined;
        }
    }
    return current;
};

function replacer(str, dataMsg = {}) {
    for (let msg in dataMsg) {
        str = str.replaceAll(`%${msg}`, dataMsg[msg]);
    }
    return str;
}

function loadCronConfig() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'cron.json'), 'utf8'));
    } catch (e) {
        console.error("[CRON_CONFIG_ERROR] Gagal memuat cron.json:", e);
        // Return a default config to prevent crashes
        return {};
    }
}

/**
 * Helper function untuk mengirim pesan WhatsApp dengan pengecekan koneksi yang aman
 * Mencegah error saat runtime WA sudah tidak siap tetapi loop scheduler masih berjalan
 * @param {string} jid - WhatsApp JID (nomor@s.whatsapp.net)
 * @param {object} message - Pesan yang akan dikirim
 * @param {object} options - Opsi tambahan untuk sendMessage
 * @returns {Promise<{success: boolean, error?: string, shouldStop?: boolean}>}
 */
async function safeSendMessage(jid, message, options = {}) {
    // Cek connection state terlebih dahulu
    const runtimeState = getConnectionState();
    if (runtimeState !== 'open') {
        return {
            success: false,
            error: `WhatsApp not connected (state: ${runtimeState})`,
            shouldStop: true // Indikator untuk stop loop pengiriman
        };
    }

    // Cek apakah runtime socket tersedia
    if (!isReady()) {
        return {
            success: false,
            error: 'WhatsApp connection object not available',
            shouldStop: true
        };
    }

    try {
        const delivery = await sendMessage(jid, message, options);
        return {
            success: delivery.sent === true,
            error: delivery.sent ? null : delivery.warning || delivery.errorCode || 'SEND_FAILED'
        };
    } catch (error) {
        const errorMsg = error.message || 'Unknown error';

        // Deteksi error koneksi yang memerlukan stop pengiriman
        const isConnectionError =
            errorMsg.includes('Connection') ||
            errorMsg.includes('closed') ||
            errorMsg.includes('socket') ||
            errorMsg.includes('Stream Errored') ||
            errorMsg.includes('timed out') ||
            errorMsg.includes('ECONNREFUSED');

        return {
            success: false,
            error: errorMsg,
            shouldStop: isConnectionError
        };
    }
}

module.exports = {
    delay,
    isValidCron,
    replacer,
    getNestedValue,
    loadCronConfig,
    safeSendMessage
};
