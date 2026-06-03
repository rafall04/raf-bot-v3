/**
 * Header Doc
 * Purpose: Pre-warm pemetaan LID↔PN milik Baileys (LIDMappingStore) dari daftar nomor pelanggan via USync,
 *          supaya pesan pertama dari pelanggan berformat @lid bisa langsung di-resolve (getPNForLID) tanpa friksi.
 * Caller: `index.js` pada event koneksi WhatsApp 'open'.
 * Deps: `raf.signalRepository.lidMapping.getLIDsForPNs` (USync resmi Baileys yang juga mem-persist hasil).
 * MainFuncs: `prewarmLidMappings`, `collectCustomerPnJids`.
 * SideEffects: Memicu query USync ke server WhatsApp (ter-batch & ter-throttle) dan menulis ke store LID Baileys.
 */
"use strict";

let lastRunAt = 0;
const MIN_INTERVAL_MS = 30 * 60 * 1000; // jangan ulang < 30 menit (store Baileys sudah persisten + cache 7 hari)

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePhone(phone) {
    if (!phone) return null;
    let n = String(phone).replace(/[^0-9]/g, '');
    if (!n) return null;
    if (n.startsWith('0')) {
        n = '62' + n.slice(1);
    } else if (!n.startsWith('62')) {
        n = '62' + n;
    }
    return n;
}

/**
 * Kumpulkan PN JID unik (62xxx@s.whatsapp.net) dari daftar pelanggan.
 * Mendukung phone_number multi-nomor (dipisah '|') dan mengabaikan entri @lid.
 */
function collectCustomerPnJids(users) {
    const set = new Set();
    for (const user of users || []) {
        if (!user || !user.phone_number) continue;
        for (const part of String(user.phone_number).split('|')) {
            const trimmed = part.trim();
            if (!trimmed || trimmed.endsWith('@lid')) continue;
            const raw = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
            const norm = normalizePhone(raw);
            if (norm && norm.length >= 10 && norm.length <= 15) {
                set.add(`${norm}@s.whatsapp.net`);
            }
        }
    }
    return [...set];
}

/**
 * Pre-warm LID mapping dari daftar pelanggan.
 * @param {Object} raf - socket Baileys
 * @param {Array} users - daftar pelanggan (punya phone_number)
 * @param {Object} options - { batchSize, delayMs, force, logger }
 */
async function prewarmLidMappings(raf, users, options = {}) {
    const {
        batchSize = 20,
        delayMs = 1500,
        force = false,
        logger = console
    } = options;

    const now = Date.now();
    if (!force && now - lastRunAt < MIN_INTERVAL_MS) {
        return { skipped: true, reason: 'throttled' };
    }

    const store = raf && raf.signalRepository && raf.signalRepository.lidMapping;
    if (!store || typeof store.getLIDsForPNs !== 'function') {
        if (logger && logger.warn) logger.warn('[LID_PREWARM] lidMapping.getLIDsForPNs tidak tersedia, lewati');
        return { skipped: true, reason: 'unavailable' };
    }

    const pnJids = collectCustomerPnJids(users);
    if (pnJids.length === 0) {
        return { skipped: true, reason: 'no_customers' };
    }

    // Tandai sudah jalan SEBELUM proses async agar reconnect beruntun tidak menumpuk.
    lastRunAt = now;

    let mapped = 0;
    let batches = 0;
    for (let i = 0; i < pnJids.length; i += batchSize) {
        const batch = pnJids.slice(i, i + batchSize);
        batches += 1;
        try {
            const res = await store.getLIDsForPNs(batch);
            if (Array.isArray(res)) mapped += res.length;
        } catch (error) {
            if (logger && logger.warn) logger.warn(`[LID_PREWARM] batch ${batches} gagal: ${error.message}`);
        }
        if (i + batchSize < pnJids.length) {
            await sleep(delayMs);
        }
    }

    if (logger && logger.log) logger.log(`[LID_PREWARM] selesai: ${mapped}/${pnJids.length} nomor terpetakan (${batches} batch)`);
    return { skipped: false, attempted: pnJids.length, mapped, batches };
}

module.exports = {
    prewarmLidMappings,
    collectCustomerPnJids,
    _resetThrottleForTest: () => { lastRunAt = 0; }
};
