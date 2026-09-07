/**
 * Header Doc
 * Purpose: Handler intent WhatsApp TEKNISI "cek redaman <nama/pppoe/hp>" & "cek redaman #<idtiket>"
 *   (RONDE 5 Fase 1, #b351). Diagnosa redaman DUA-SISI (Modem/GenieACS + OLT) realtime langsung dari
 *   WA — aplikasi yang teknisi pakai di lapangan (dulu NOL perintah redaman). READ-ONLY, STAF-ONLY
 *   (RX/PPPoE/slot boleh ke staf, JANGAN ke pelanggan). Reuse service fondasi #b350.
 * Caller: Dispatcher bot `message/raf.js` pada intent `CEK_REDAMAN` (via wifi-intents wrapper).
 * Deps: `../../services/redaman-diagnosis.service` (getRedamanDiagnosisService/formatDetailLines),
 *   `../telegram/customer-lookup` (findOneCustomer/findById — MURNI, read-only), `./template-helpers`
 *   (renderResponseTemplate). TIDAK require Baileys / global.raf / sendMessage mentah (guard wa-forbidden).
 * MainFuncs: `handleCekRedaman`.
 * SideEffects: via service — refresh+query GenieACS + snapshot OLT (ber-cache) + baca sesi PPPoE; balas WA via reply.
 */
"use strict";

const { getRedamanDiagnosisService, formatDetailLines } = require("../../services/redaman-diagnosis.service");
const { findOneCustomer, findById } = require("../telegram/customer-lookup");
const { renderResponseTemplate } = require("./template-helpers");
const { normalizeJidForMessage } = require("../../lib/jid-utils");
const watchStore = require("../../lib/redaman-watch-store");
const { primaryRx } = require("../../lib/redaman-watch-service");

function displayName(u) {
    return String((u && u.name) || "").split("|")[0].trim() || "(tanpa nama)";
}
function firstPart(v) {
    return String(v == null ? "" : v).split("|")[0].trim();
}

/**
 * Ambil user dari tiket by ticketId → id pelanggan → user penuh (butuh device_id/pppoe utk diagnosa).
 */
function resolveFromTicket(ticketId, users, globalScope) {
    const reports = (globalScope && globalScope.reports) || (typeof global !== "undefined" && global.reports) || [];
    const t = Array.isArray(reports) ? reports.find((r) => r && String(r.ticketId) === String(ticketId)) : null;
    if (!t) return { found: false };
    const uid = t.pelangganUserId != null ? t.pelangganUserId
        : (t.pelangganDataSystem && t.pelangganDataSystem.id != null ? t.pelangganDataSystem.id
            : (t.createdBy && t.createdBy.userId != null ? t.createdBy.userId : null));
    const user = uid != null ? findById(uid, users) : null;
    return { found: true, user };
}

/**
 * @param {object} p - { qAfterKeyword, args, matchedKeywordLength, isOwner, isTeknisi, users, reply, global, mess, msg, raf }
 */
async function handleCekRedaman(p) {
    const { isOwner, isTeknisi, users, reply, mess } = p;
    const globalScope = p.global || (typeof global !== "undefined" ? global : {});

    // STAF-ONLY: RX/PPPoE/slot adalah data internal — pelanggan ditolak (bukan diam) agar jelas.
    if (!isTeknisi && !isOwner) {
        return reply((mess && mess.teknisiOrOwnerOnly) || "⛔ Fitur ini khusus teknisi/admin.");
    }

    let arg = String(p.qAfterKeyword || "").trim();
    if (!arg && Array.isArray(p.args)) {
        arg = p.args.slice(p.matchedKeywordLength || 2).join(" ").trim();
    }
    if (!arg) {
        return reply(renderResponseTemplate(
            "redaman_check_help",
            "📶 *Cek Redaman*\nKetik:\n• *cek redaman <nama / pppoe / no HP>*\n• *cek redaman #<id tiket>*",
            {}
        ));
    }

    // ---- Resolve pelanggan (cabang tiket vs katakunci) ----
    let user = null;
    if (arg.startsWith("#")) {
        const ticketId = arg.slice(1).trim();
        const r = resolveFromTicket(ticketId, users, globalScope);
        if (!r.found) {
            return reply(renderResponseTemplate(
                "redaman_check_ticket_not_found",
                `🔍 Tiket #${ticketId} tidak ditemukan.`,
                { idtiket: ticketId }
            ));
        }
        user = r.user;
    } else {
        const res = findOneCustomer(arg, users);
        if (res && res.user) {
            user = res.user;
        } else if (res && res.candidates && res.candidates.length) {
            const lines = res.candidates.slice(0, 8).map((u, i) => `${i + 1}. ${displayName(u)} — ${firstPart(u.pppoe_username) || "-"}`);
            return reply(renderResponseTemplate(
                "redaman_check_ambiguous",
                `🔎 Ditemukan beberapa pelanggan. Perjelas kata kunci:\n\n${lines.join("\n")}`,
                { daftar: lines.join("\n") }
            ));
        }
    }

    if (!user) {
        return reply(renderResponseTemplate(
            "redaman_check_not_found",
            `🔍 Pelanggan "${arg}" tidak ditemukan. Coba nama / PPPoE / no HP, atau #<id tiket>.`,
            { query: arg }
        ));
    }

    // ---- Diagnosa dua-sisi (never-throw) ----
    await reply(renderResponseTemplate("redaman_check_loading", "⏳ Sedang cek redaman (modem + OLT), mohon tunggu…", {}));

    let diag;
    try {
        diag = await getRedamanDiagnosisService().diagnoseCustomer(user, { caller: "wa.cek-redaman" });
    } catch (_e) {
        // Service never-throw, tapi jaga-jaga: jangan biarkan gagal menjatuhkan handler.
        return reply("⚠️ Gagal mengukur redaman saat ini. Coba lagi sebentar lagi ya.");
    }

    // Badan diagnostik dinamis (staf) — string langsung, seperti hasil `cek wifi`.
    const out = [
        `📶 *REDAMAN — ${diag.nama}*`,
        `PPPoE: ${diag.pppoe || "-"}`,
        "",
        ...formatDetailLines(diag),
    ];
    if (diag.kesimpulan) out.push("", diag.kesimpulan);
    return reply(out.join("\n"));
}

/**
 * #b352 (Fase 3): daftar pelanggan TERDAMPAK berperingkat (redaman terburuk dulu) dari SATU snapshot
 * OLT bersama — AMAN (tanpa fan-out force-refresh ACS, #b251). GATED config.redamanTerdampak.enabled
 * (default OFF). "redaman terdampak" → semua ONU bermasalah lintas-OLT; "redaman olt <nama>" → 1 OLT.
 * @param {object} p - { qAfterKeyword, isOwner, isTeknisi, reply, global, mess }
 */
async function handleRedamanTerdampak(p) {
    const { isOwner, isTeknisi, reply, mess } = p;
    const globalScope = p.global || (typeof global !== "undefined" ? global : {});
    if (!isTeknisi && !isOwner) {
        return reply((mess && mess.teknisiOrOwnerOnly) || "⛔ Fitur ini khusus teknisi/admin.");
    }
    const cfg = (globalScope && globalScope.config) || (typeof global !== "undefined" && global.config) || {};
    if (!cfg.redamanTerdampak || cfg.redamanTerdampak.enabled !== true) {
        return reply(renderResponseTemplate(
            "redaman_terdampak_disabled",
            "ℹ️ Fitur 'redaman terdampak' belum diaktifkan (config.redamanTerdampak.enabled).",
            {}
        ));
    }
    const arg = String(p.qAfterKeyword || "").trim(); // non-kosong → filter OLT by nama

    await reply(renderResponseTemplate("redaman_terdampak_loading", "⏳ Mengumpulkan redaman pelanggan terdampak (baca OLT)…", {}));

    let res;
    try {
        res = await getRedamanDiagnosisService().getAffectedRedaman({ oltName: arg || null, onlyBad: !arg, limit: 30 });
    } catch (_e) {
        return reply("⚠️ Gagal mengambil data OLT saat ini. Coba lagi sebentar lagi ya.");
    }
    if (!res || !res.rows || res.rows.length === 0) {
        return reply(arg
            ? `✅ Tidak ada ONU bermasalah di OLT "${arg}" (atau OLT tak ditemukan).`
            : "✅ Tidak ada pelanggan terdampak (semua ONU Online & RX wajar).");
    }

    const shown = res.truncated ? `, tampil ${res.rows.length}` : "";
    const header = arg
        ? `📶 *Redaman OLT ${arg}* (${res.total} ONU${shown}) — terburuk dulu`
        : `🚨 *Pelanggan Terdampak* (${res.total}${shown}) — terburuk dulu`;
    const lines = res.rows.map((r, i) => {
        const rx = r.rxValid
            ? `${r.verdict ? r.verdict.emoji + " " : ""}${r.rx} dBm${r.verdict ? " " + r.verdict.label : ""}`
            : `${r.status}${r.isLos ? " (LOS)" : r.isDyingGasp ? " (DG)" : ""} — RX belum valid`;
        const loc = [r.oltName, r.pon, r.onuId != null ? `ONU ${r.onuId}` : null].filter(Boolean).join("/");
        return `${i + 1}. ${r.label} — ${rx}${loc ? ` [${loc}]` : ""}`;
    });
    if (res.truncated) lines.push(`…dan ${res.total - res.rows.length} lainnya.`);
    return reply([header, "", ...lines].join("\n"));
}

// ---- Fase 4 (#b353): PANTAU redaman live saat perbaikan (durabel + smart + auto-log tiket) ----

async function resolveRequesterJid(p) {
    let jid = p.sender;
    try {
        const n = await normalizeJidForMessage(p.sender, { users: p.users, msg: p.msg, raf: p.raf });
        if (n) jid = n;
    } catch (_e) { /* pakai sender apa adanya */ }
    return jid;
}

/**
 * `pantau redaman <nama/pppoe/hp>` / `pantau redaman #<idtiket>` — mulai pemantauan durabel.
 * Kirim pembacaan awal + daftarkan watch; cron 1-menit yang push update pintar berikutnya.
 */
async function handlePantauRedaman(p) {
    const { isOwner, isTeknisi, users, reply, mess } = p;
    const globalScope = p.global || (typeof global !== "undefined" ? global : {});
    if (!isTeknisi && !isOwner) return reply((mess && mess.teknisiOrOwnerOnly) || "⛔ Fitur ini khusus teknisi/admin.");

    const cfg = (globalScope && globalScope.config) || (typeof global !== "undefined" && global.config) || {};
    const wcfg = cfg.redamanWatch || {};
    if (wcfg.enabled !== true) {
        return reply(renderResponseTemplate("redaman_pantau_disabled", "ℹ️ Fitur pantau redaman belum diaktifkan (config.redamanWatch.enabled).", {}));
    }

    const arg = String(p.qAfterKeyword || "").trim();
    if (!arg) {
        return reply(renderResponseTemplate("redaman_pantau_help", "📶 *Pantau Redaman*\nKetik:\n• *pantau redaman <nama / pppoe / no HP>*\n• *pantau redaman #<id tiket>*\nBerhenti kapan saja: *stop pantau*", {}));
    }

    // Resolve pelanggan (sama seperti cek redaman).
    let user = null;
    let ticketId = null;
    if (arg.startsWith("#")) {
        ticketId = arg.slice(1).trim();
        const r = resolveFromTicket(ticketId, users, globalScope);
        if (!r.found) return reply(renderResponseTemplate("redaman_check_ticket_not_found", `🔍 Tiket #${ticketId} tidak ditemukan.`, { idtiket: ticketId }));
        user = r.user;
    } else {
        const res = findOneCustomer(arg, users);
        if (res && res.user) {
            user = res.user;
        } else if (res && res.candidates && res.candidates.length) {
            const lines = res.candidates.slice(0, 8).map((u, i) => `${i + 1}. ${displayName(u)} — ${firstPart(u.pppoe_username) || "-"}`);
            return reply(renderResponseTemplate("redaman_check_ambiguous", `🔎 Ditemukan beberapa pelanggan. Perjelas kata kunci:\n\n${lines.join("\n")}`, { daftar: lines.join("\n") }));
        }
    }
    if (!user) return reply(renderResponseTemplate("redaman_check_not_found", `🔍 Pelanggan "${arg}" tidak ditemukan.`, { query: arg }));

    // Batas jumlah watch aktif (anti badai).
    const maxActive = Number.isFinite(wcfg.maxActive) ? wcfg.maxActive : 10;
    if (watchStore.countActive() >= maxActive) {
        return reply(renderResponseTemplate("redaman_pantau_penuh", `⚠️ Batas ${maxActive} pemantauan aktif tercapai. Coba lagi setelah ada yang selesai.`, { max: maxActive }));
    }

    // JID requester WAJIB kanonik (invarian: cron tak boleh sendMessage ke @lid).
    const requesterJid = await resolveRequesterJid(p);
    if (!requesterJid || String(requesterJid).endsWith("@lid")) {
        return reply("⚠️ Nomormu belum bisa dipetakan (masih @lid) — hubungi admin agar update pemantauan bisa dikirim.");
    }

    // Pembacaan awal (baseline).
    let diag;
    try {
        diag = await getRedamanDiagnosisService().diagnoseCustomer(user, { caller: "wa.pantau-redaman" });
    } catch (_e) {
        return reply("⚠️ Gagal membaca redaman awal. Coba lagi sebentar lagi ya.");
    }
    const cur = primaryRx(diag);
    const intervalMs = Number.isFinite(wcfg.intervalMs) ? wcfg.intervalMs : 60000;
    const durationMs = Number.isFinite(wcfg.durationMs) ? wcfg.durationMs : 30 * 60000;
    const rec = watchStore.addWatch({
        requesterJid, userId: user.id, name: diag.nama, pppoe: diag.pppoe, deviceId: user.device_id || null,
        ticketId, intervalMs, expiresAt: new Date(Date.now() + durationMs).toISOString(),
        baseline: { rx: cur.rx, status: cur.status, at: new Date().toISOString() },
    });
    if (!rec) return reply("⚠️ Gagal memulai pemantauan.");

    const out = [
        `📶 *Mulai pantau redaman — ${diag.nama}*`,
        `PPPoE: ${diag.pppoe || "-"}`,
        "",
        ...formatDetailLines(diag),
        "",
        `Saya pantau ~${Math.round(durationMs / 60000)} menit — dikabari saat berubah / status flip / target BAIK tercapai 🎉.`,
        "_ketik *stop pantau* untuk berhenti_",
    ];
    return reply(out.join("\n"));
}

/** `stop pantau` — hentikan semua pemantauan aktif milik teknisi ini. */
async function handleStopPantau(p) {
    const { isOwner, isTeknisi, reply, mess } = p;
    if (!isTeknisi && !isOwner) return reply((mess && mess.teknisiOrOwnerOnly) || "⛔ Fitur ini khusus teknisi/admin.");
    const requesterJid = await resolveRequesterJid(p);
    const n = watchStore.removeByRequester(requesterJid);
    return reply(n > 0
        ? renderResponseTemplate("redaman_pantau_stop", `🛑 Pemantauan redaman dihentikan (${n}).`, { jumlah: n })
        : renderResponseTemplate("redaman_pantau_stop_none", "Tak ada pemantauan redaman aktif dari kamu.", {}));
}

module.exports = { handleCekRedaman, handleRedamanTerdampak, handlePantauRedaman, handleStopPantau, resolveFromTicket };
