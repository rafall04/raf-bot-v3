/**
 * Header Doc
 * Purpose: Notifikasi otomatis ke GRUP PERBAIKAN (terpisah dari grup PSB) saat tiket baru masuk &
 *          saat tiket selesai — "papan pengumuman" perbaikan untuk tim/admin. Bagian automasi perbaikan.
 * Caller: `lib/report-notification-service.js` (hook tiket baru di `notifyNewReport`) dan
 *         `message/handlers/teknisi-workflow-handler.js` (hook selesai di `handleSelesaiTicket`).
 * Deps: `./whatsapp-delivery-service` (delivery boundary — BUKAN Baileys mentah), `./whatsapp-gateway`.
 * MainFuncs: `notifyRepairGroupNewTicket(ticket)`, `notifyRepairGroupCompleted(ticket, meta)`.
 * SideEffects: Kirim 1 pesan WhatsApp ke grup. NEVER-THROW & guarded — bug/koneksi mati tak boleh
 *              menjatuhkan alur tiket. Feature-flag `config.repairNotif.enabled` (default OFF).
 */
"use strict";

function getCfg() {
    return (global.config && global.config.repairNotif) || {};
}

function pick(...vals) {
    for (const v of vals) {
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return null;
}

// Kirim ke grup perbaikan lewat delivery boundary. Guarded + never-throw.
async function postToRepairGroup(text, ticketId) {
    const cfg = getCfg();
    if (cfg.enabled !== true || !cfg.groupId) return { sent: false, reason: "disabled_or_no_group" };
    try {
        const { isReady } = require("./whatsapp-gateway");
        if (!isReady()) return { sent: false, reason: "wa_offline" };
        const { sendMessage } = require("./whatsapp-delivery-service");
        const result = await sendMessage(cfg.groupId, { text }, { skipDuplicateCheck: true });
        return { sent: !!(result && result.sent !== false) };
    } catch (e) {
        console.error("[REPAIR_GROUP_NOTIF_ERROR]", { ticketId, error: e && e.message });
        return { sent: false, reason: e && e.message };
    }
}

async function notifyRepairGroupNewTicket(ticket) {
    try {
        const cfg = getCfg();
        if (cfg.enabled !== true) return;
        if (cfg.notifyNewTicket === false) return;
        if (!ticket) return;

        const nama = pick(ticket.pelangganName, ticket.pelangganPushName, ticket.customerName) || "—";
        const alamat = pick(ticket.pelangganAddress, ticket.address);
        const gangguan = pick(ticket.issueType, ticket.jenisGangguan, ticket.category) || "Gangguan";
        const prioritas = pick(ticket.priority);
        const lines = [
            `🔧 *TIKET PERBAIKAN BARU*`,
            `ID: *${pick(ticket.ticketId) || "-"}*`,
            `Pelanggan: ${nama}`,
            alamat ? `Alamat: ${alamat}` : null,
            `Gangguan: ${gangguan}${prioritas ? ` (${prioritas})` : ""}`,
            ``,
            `Ambil tiket: ketik *proses ${pick(ticket.ticketId) || "[ID]"}*`
        ].filter((l) => l !== null);
        await postToRepairGroup(lines.join("\n"), ticket.ticketId);
    } catch (e) {
        console.error("[REPAIR_GROUP_NOTIF_NEW_ERROR]", e && e.message);
    }
}

async function notifyRepairGroupCompleted(ticket, meta = {}) {
    try {
        const cfg = getCfg();
        if (cfg.enabled !== true) return;
        if (cfg.notifyCompleted === false) return;
        if (!ticket) return;

        const nama = pick(ticket.pelangganName, ticket.pelangganPushName, ticket.customerName) || "—";
        const teknisi = pick(meta.teknisiName, ticket.teknisiName, ticket.handledBy) || "—";
        const durasi = Number.isFinite(meta.durationMinutes) ? `${meta.durationMinutes} mnt` : null;
        const catatan = pick(meta.resolutionNotes, ticket.resolutionNotes);
        const lines = [
            `✅ *TIKET SELESAI*`,
            `ID: *${pick(ticket.ticketId) || "-"}*`,
            `Pelanggan: ${nama}`,
            `Teknisi: ${teknisi}`,
            durasi ? `Durasi: ${durasi}` : null,
            catatan ? `Catatan: ${catatan}` : null
        ].filter((l) => l !== null);
        await postToRepairGroup(lines.join("\n"), ticket.ticketId);
    } catch (e) {
        console.error("[REPAIR_GROUP_NOTIF_DONE_ERROR]", e && e.message);
    }
}

module.exports = { notifyRepairGroupNewTicket, notifyRepairGroupCompleted, postToRepairGroup };
