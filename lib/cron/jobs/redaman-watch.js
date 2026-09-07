/**
 * Header Doc
 * Purpose: Cron 1-menit pemantauan redaman live saat perbaikan (RONDE 5 Fase 4, #b353). Membaca
 *   watch aktif (redaman-watch-store), mendiagnosa dua-sisi (service fondasi #b350), lalu push
 *   update PINTAR ke WA teknisi (hanya saat berubah/status flip/target BAIK/heartbeat) — logika di
 *   redaman-watch-service.runWatchTick. Saat watch kedaluwarsa: kirim ringkasan + log redaman
 *   SEBELUM/SESUDAH ke tiket. GATED config.redamanWatch.enabled (default OFF) → cron INERT bila off
 *   atau tak ada watch. Re-entrancy guard (pola 14 cron saudara).
 * Caller: `lib/cron.js` (initRedamanWatchTask).
 * Deps: node-cron, ../shared (safeSendMessage), ../../redaman-watch-store, ../../redaman-watch-service,
 *   ../../services/redaman-diagnosis.service, ../../repositories/ticket.repository (log tiket atomik).
 * MainFuncs: initRedamanWatchTask(config).
 * SideEffects: Jadwalkan job; baca/tulis redaman-watches.json; kirim WA; tulis reports.json (log tiket).
 */
"use strict";

const cron = require("node-cron");
const { safeSendMessage } = require("../shared");
const watchStore = require("../../redaman-watch-store");
const { runWatchTick } = require("../../redaman-watch-service");
const { getRedamanDiagnosisService } = require("../../../services/redaman-diagnosis.service");

let cronTaskRedamanWatch = null;
let redamanWatchRunning = false;

function buildUserForWatch(w) {
    const users = (typeof global !== "undefined" && Array.isArray(global.users)) ? global.users : [];
    const live = users.find((u) => u && String(u.id) === String(w.userId));
    if (live) return live; // pakai data live (device_id/pppoe terbaru)
    return { id: w.userId, name: w.name, pppoe_username: w.pppoe, device_id: w.deviceId };
}

// Log redaman sebelum/sesudah ke tiket (atomik via ticket repository). Best-effort, never-throw.
async function logToTicket(ticketId, info) {
    try {
        const reports = (typeof global !== "undefined" && Array.isArray(global.reports)) ? global.reports : null;
        if (!reports) return;
        const r = reports.find((x) => x && String(x.ticketId) === String(ticketId));
        if (!r) return;
        r.redamanWatch = { before: info.before, after: info.after, at: new Date().toISOString(), by: info.by };
        const { createTicketRepository } = require("../../../repositories/ticket.repository");
        createTicketRepository().saveReportDraft(reports);
    } catch (e) {
        console.warn(`[CRON_REDAMAN_WATCH] Gagal log tiket ${ticketId}: ${e.message}`);
    }
}

function initRedamanWatchTask(_config) {
    if (cronTaskRedamanWatch) cronTaskRedamanWatch.stop();

    cronTaskRedamanWatch = cron.schedule("* * * * *", async () => {
        // GATE: fitur OFF → inert (tak sentuh store/WA). Dibaca tiap tick agar bisa on/off tanpa restart.
        const cfg = (typeof global !== "undefined" && global.config && global.config.redamanWatch) || {};
        if (cfg.enabled !== true) return;

        if (redamanWatchRunning) {
            console.warn("[CRON_REDAMAN_WATCH_SKIPPED] tick sebelumnya masih jalan — dilewati.");
            return;
        }
        redamanWatchRunning = true;
        try {
            const diagnosis = getRedamanDiagnosisService();
            const res = await runWatchTick({
                loadActiveAll: () => watchStore.loadWatches().filter((w) => w && w.status === "active"),
                diagnoseWatch: (w) => diagnosis.diagnoseCustomer(buildUserForWatch(w), { caller: "cron.redaman-watch" }),
                sendMessage: async (jid, payload) => { await safeSendMessage(jid, payload); },
                logToTicket,
                updateWatch: (id, patch) => watchStore.updateWatch(id, patch),
                removeWatch: (id) => watchStore.removeWatch(id),
                now: Date.now,
                cfg,
            });
            if (res && (res.notified || res.finalized)) {
                console.log(`[CRON_REDAMAN_WATCH] proses=${res.processed} notif=${res.notified} selesai=${res.finalized}`);
            }
        } catch (error) {
            console.error(`[CRON_REDAMAN_WATCH_ERROR] ${error.message}`);
        } finally {
            redamanWatchRunning = false;
        }
    }, { scheduled: true, timezone: "Asia/Jakarta" });

    cronTaskRedamanWatch.start();
    return { started: true, task: cronTaskRedamanWatch };
}

module.exports = { initRedamanWatchTask };
