/**
 * Header Doc
 * Purpose: Otak pemantauan redaman live (RONDE 5 Fase 4, #b353). `decideNotify` (MURNI) memutuskan
 *   kapan mem-push ke WA teknisi — SMART: hanya saat RX berubah berarti, status flip, TARGET BAIK
 *   tercapai (🎉), atau heartbeat berkala — supaya tak membanjiri. `runWatchTick` menjalankan satu
 *   siklus (baca watch aktif → diagnosa → putuskan → kirim → finalisasi kedaluwarsa + log tiket
 *   sebelum/sesudah). Deps diinjeksi (testable), NEVER-THROW per watch.
 * Caller: `lib/cron/jobs/redaman-watch.js`.
 * Deps: `./redaman-diagnosis.service` (formatDetailLines) — sisanya diinjeksi.
 * MainFuncs: `primaryRx`, `decideNotify`, `runWatchTick`.
 * SideEffects: via deps (kirim WA, tulis tiket, tulis store).
 */
"use strict";

const { formatDetailLines } = require("../services/redaman-diagnosis.service");

const DEF_CHANGE_DB = 1.5;      // ambang perubahan RX yang dianggap "berarti"
const DEF_HEARTBEAT_MS = 300000; // 5 menit

function isOnline(status) {
    return String(status || "").toLowerCase() === "online";
}

/** RX utama utk keputusan: prioritas OLT valid (paling andal), fallback modem. */
function primaryRx(diag) {
    if (diag && diag.olt && diag.olt.matched && diag.olt.rxPowerValid && diag.oltVerdict) {
        return { rx: diag.oltVerdict.value, label: diag.oltVerdict.label, status: diag.olt.status, source: "OLT" };
    }
    if (diag && diag.modem && diag.modem.reachable && diag.modem.verdict && diag.modem.verdict.value !== null) {
        return { rx: diag.modem.verdict.value, label: diag.modem.verdict.label, status: diag.olt && diag.olt.matched ? diag.olt.status : "Online", source: "Modem" };
    }
    // Tak ada RX valid (mis. ONU LOS) — status dari OLT bila ada.
    return { rx: null, label: null, status: (diag && diag.olt && diag.olt.status) || null, source: null };
}

/**
 * Keputusan MURNI: apakah push sekarang, dan kenapa.
 * @returns {{notify:boolean, kind:'target'|'status'|'change'|'heartbeat'|null}}
 */
function decideNotify(watch, diag, now, cfg = {}) {
    // Override PRIBADI (#b356 prefs.pantau) menang atas config global, lalu default.
    const changeDb = Number.isFinite(watch.changeThresholdDb) ? watch.changeThresholdDb
        : (Number.isFinite(cfg.changeThresholdDb) ? cfg.changeThresholdDb : DEF_CHANGE_DB);
    const heartbeatMs = Number.isFinite(cfg.heartbeatMs) ? cfg.heartbeatMs : DEF_HEARTBEAT_MS;
    const cur = primaryRx(diag);

    // TARGET tercapai (prioritas tertinggi, tujuan perbaikan). Target PRIBADI dBm (watch.targetDbm)
    // bila diset: RX ≥ target (dBm makin besar makin baik, mis. -22 ≥ -25). Selain itu: band BAIK.
    if (!watch.targetAnnounced) {
        const hitTarget = Number.isFinite(watch.targetDbm)
            ? (cur.rx !== null && cur.rx >= watch.targetDbm)
            : cur.label === "BAIK";
        if (hitTarget) return { notify: true, kind: "target" };
    }

    // Status flip (LOS/offline ↔ online) — kejadian penting.
    if (isOnline(cur.status) !== isOnline(watch.lastStatus)) return { notify: true, kind: "status" };

    // Perubahan RX berarti.
    if (cur.rx !== null && watch.lastRx !== null && Math.abs(cur.rx - watch.lastRx) >= changeDb) {
        return { notify: true, kind: "change" };
    }

    // Heartbeat berkala (biar teknisi tahu masih dipantau).
    if (now - new Date(watch.lastHeartbeatAt).getTime() >= heartbeatMs) return { notify: true, kind: "heartbeat" };

    return { notify: false, kind: null };
}

function buildUpdateText(watch, diag, kind) {
    const head = kind === "target"
        ? `🎉 *TARGET REDAMAN TERCAPAI — ${diag.nama}*\nRedaman sudah BAIK — sudah bagus, boleh tutup. ✅`
        : kind === "status"
            ? `🔔 *Perubahan status — ${diag.nama}*`
            : kind === "heartbeat"
                ? `⏳ *Pantau redaman — ${diag.nama}* (masih dipantau)`
                : `📶 *Update redaman — ${diag.nama}*`;
    const lines = [head, `PPPoE: ${diag.pppoe || "-"}`, "", ...formatDetailLines(diag)];
    if (watch.baseline && watch.baseline.rx !== null && watch.baseline.rx !== undefined) {
        lines.push("", `Awal pantau: ${watch.baseline.rx} dBm`);
    }
    lines.push("", "_ketik *stop pantau* untuk berhenti_");
    return lines.join("\n");
}

/**
 * Satu siklus tick. NEVER-THROW per watch.
 * @param {object} deps - {
 *   loadActiveAll:()=>Array (semua status active, termasuk yg kedaluwarsa),
 *   diagnoseWatch:(watch)=>Promise<diag>, sendMessage:(jid,{text})=>Promise,
 *   logToTicket:(ticketId,{before,after,by})=>Promise, updateWatch:(id,patch)=>void,
 *   removeWatch:(id)=>void, now:()=>number, cfg:{} }
 * @returns {Promise<{processed,notified,finalized}>}
 */
async function runWatchTick(deps) {
    const now = (deps.now || Date.now)();
    const cfg = deps.cfg || {};
    const watches = deps.loadActiveAll() || [];
    let processed = 0, notified = 0, finalized = 0;

    for (const w of watches) {
        if (!w || w.status !== "active") continue;
        try {
            // ---- Kedaluwarsa → finalisasi: kirim ringkasan + log tiket sebelum/sesudah + tutup ----
            if (new Date(w.expiresAt).getTime() <= now) {
                finalized++;
                let after = null;
                try {
                    const diag = await deps.diagnoseWatch(w);
                    const cur = primaryRx(diag);
                    after = cur.rx;
                    const before = w.baseline ? w.baseline.rx : null;
                    const txt = [
                        `🏁 *Pantau redaman selesai — ${w.name || "-"}* (30 menit)`,
                        before !== null || after !== null ? `Redaman: ${before ?? "?"} → ${after ?? "?"} dBm` : "",
                    ].filter(Boolean).join("\n");
                    await deps.sendMessage(w.requesterJid, { text: txt });
                    if (w.ticketId && deps.logToTicket) {
                        await deps.logToTicket(w.ticketId, { before, after, by: w.requesterJid }).catch(() => {});
                    }
                } catch (_e) { /* best-effort finalisasi */ }
                deps.removeWatch(w.id);
                continue;
            }

            // ---- Belum jatuh tempo interval → lewati ----
            if (now - new Date(w.lastReportAt).getTime() < (w.intervalMs || 60000)) continue;
            processed++;

            const diag = await deps.diagnoseWatch(w);
            const cur = primaryRx(diag);
            const decision = decideNotify(w, diag, now, cfg);

            const patch = { lastReportAt: new Date(now).toISOString(), lastRx: cur.rx, lastStatus: cur.status };
            if (decision.notify) {
                await deps.sendMessage(w.requesterJid, { text: buildUpdateText(w, diag, decision.kind) });
                notified++;
                patch.lastHeartbeatAt = new Date(now).toISOString();
                if (decision.kind === "target") patch.targetAnnounced = true;
            }
            deps.updateWatch(w.id, patch);
        } catch (_e) {
            // Never-throw: satu watch gagal tak menghentikan sisanya.
            try { deps.updateWatch(w.id, { lastReportAt: new Date(now).toISOString() }); } catch (_e2) { /* abaikan */ }
        }
    }
    return { processed, notified, finalized };
}

module.exports = { primaryRx, decideNotify, buildUpdateText, runWatchTick, DEF_CHANGE_DB, DEF_HEARTBEAT_MS };
