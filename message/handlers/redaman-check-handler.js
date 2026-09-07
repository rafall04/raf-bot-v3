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

module.exports = { handleCekRedaman, resolveFromTicket };
