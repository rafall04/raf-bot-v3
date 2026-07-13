/**
 * Header Doc
 * Purpose: State domain "oper koneksi per SEGMEN" via WhatsApp untuk OWNER/ADMIN. Alur:
 *          `oper <segmen> ke <jalur>` → pratinjau (dry-run + jumlah pelanggan + langkah) →
 *          balas *ya* → eksekusi via `lib/customer-steering-service.applySegmentMove`
 *          (tulis address-list + VERIFY + rollback otomatis). Segmen = pool/subnet (STABIL,
 *          IP pelanggan dinamis); jalur v1 = mni/gmdp (freedns↔lokaldns). Gate peran PRESISI
 *          (accounts.json via resolveStaffRole), tulis router HANYA setelah *ya*.
 * Caller: `message/handlers/conversation-state-router.js` (owner "oper-jalur") + trigger
 *         `startOperJalur` dari `raf-intent-dispatch/owner-admin-intents.js` (intent OPER_JALUR).
 * Deps (via context/inject, patuh [[raf-invariants]]): `reply` (delivery boundary),
 *        `setUserState/deleteUserState/getUserState` (conversation-handler, key stateSender kanonik).
 *        Require: `../../../lib/customer-steering-service`, `../../../lib/affirmative-parser`,
 *        `./wan-switch.state` (resolveStaffRole), `../template-helpers` (renderResponseTemplate).
 * MainFuncs: `startOperJalur(context)`, `handleOperJalurConversationState(context)`.
 * SideEffects: Mengubah address-list router (HANYA di langkah konfirmasi via service); menulis
 *              state percakapan; kirim WA. NEVER-THROW.
 */
"use strict";

const { resolveStaffRole } = require("./wan-switch.state");
const { isAffirmative } = require("../../../lib/affirmative-parser");

const STEP_CONFIRM = "OPERJALUR_CONFIRM";
const ADMIN_ROLES = ["admin", "owner", "superadmin"];

function getService(context) {
    return context.customerSteeringService || require("../../../lib/customer-steering-service");
}

// Render template editable admin (response_templates.json). Direct require agar konsisten di jalur
// DISPATCH maupun STATE (jalur STATE tak menyuntik renderResponseTemplate). Fallback string aman.
function renderTpl(key, fallback, data) {
    try {
        const { renderResponseTemplate } = require("../template-helpers");
        const r = renderResponseTemplate(key, fallback, data || {});
        if (r && String(r).trim()) return r;
    } catch (_e) { /* fall through */ }
    return fallback;
}

function isAdminOwner(context) {
    return ADMIN_ROLES.includes((resolveStaffRole(context) || "").toLowerCase());
}

function actorFromContext(context) {
    const role = (resolveStaffRole(context) || "admin").toLowerCase();
    return { label: `${role}:${context.pushname || "-"}`, role };
}

/** Parse "free ke gmdp" / "110k mni" → { segmen, jalur }. Kata sambung (ke/jadi) diabaikan. */
function parseOper(qAfterKeyword, segmentIds) {
    const words = String(qAfterKeyword || "").toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
    const segAlias = { regular: "reguler", biasa: "reguler", "110": "110k", "125": "125k", gratis: "free" };
    const jalurAlias = { mni: "mni", gmdp: "gmdp", utama: "gmdp", ih: "ih", sf: "sf", backup: "sf" };
    let segmen = null;
    let jalur = null;
    for (const w of words) {
        if (!segmen) {
            if (segmentIds.includes(w)) { segmen = w; continue; }
            if (segAlias[w]) { segmen = segAlias[w]; continue; }
        }
        if (!jalur && jalurAlias[w]) jalur = jalurAlias[w];
    }
    return { segmen, jalur };
}

/**
 * Trigger `oper <segmen> ke <jalur>`. Pratinjau + set state OPERJALUR_CONFIRM. NEVER-THROW.
 * Return { handled:true } bila menangani; { handled:false } bila bukan admin (jangan bocorkan).
 */
async function startOperJalur(context) {
    const { reply, stateSender, setUserState, qAfterKeyword } = context;
    try {
        if (!isAdminOwner(context)) return { handled: false };
        const svc = getService(context);
        const segmentIds = svc.getSegments().map((s) => s.id);
        const { segmen, jalur } = parseOper(qAfterKeyword, segmentIds);
        if (!segmen || !jalur) {
            await reply(renderTpl("oper_segment_invalid",
                "⚠️ Format: *oper <segmen> ke <jalur>*. Contoh: *oper free ke gmdp*.",
                { error: "Format kurang lengkap — sebutkan segmen dan jalur.", daftar_segmen: segmentIds.join(", ") }),
                { skipDuplicateCheck: true });
            return { handled: true };
        }
        const preview = await svc.previewSegmentMove({ segment: segmen, path: jalur });
        if (!preview.ok) {
            await reply(renderTpl("oper_segment_invalid", `⚠️ ${preview.error}`,
                { error: preview.error, daftar_segmen: segmentIds.join(", ") }), { skipDuplicateCheck: true });
            return { handled: true };
        }
        if (preview.noop) {
            await reply(renderTpl("oper_segment_noop",
                `ℹ️ Segmen *${preview.label}* sudah di *${String(jalur).toUpperCase()}*. Tidak ada perubahan.`,
                { segmen: preview.label, to: String(jalur).toUpperCase() }), { skipDuplicateCheck: true });
            return { handled: true };
        }
        let aktif = "?";
        try {
            const map = await svc.buildSegmentMap();
            const s = map.ok && map.segments.find((x) => x.id === preview.segment);
            if (s) aktif = String(s.activeCount);
        } catch (_e) { /* aktif tetap '?' */ }
        const opsText = preview.ops.map((o, i) => `${i + 1}. ${o.desc}`).join("\n");
        const from = String(preview.from).toUpperCase();
        const to = String(jalur).toUpperCase();
        setUserState(stateSender, { step: STEP_CONFIRM, segmen: preview.segment, label: preview.label, jalur, from: preview.from });
        await reply(renderTpl("oper_segment_preview",
            `🔀 *Oper Segmen — Pratinjau*\n\nSegmen: *${preview.label}* (${aktif} pelanggan aktif)\nJalur: *${from}* → *${to}*\n\nLangkah yang akan dijalankan di router:\n${opsText}\n\nBalas *ya* untuk lanjut, atau *batal*.`,
            { segmen: preview.label, aktif, from, to, ops: opsText }), { skipDuplicateCheck: true });
        return { handled: true };
    } catch (err) {
        console.warn(`[OPERJALUR] start gagal: ${err.message}`);
        try { await reply("Maaf, gagal menyiapkan oper segmen. Coba lagi ya."); } catch (_e) { /* abaikan */ }
        return { handled: true };
    }
}

async function handleConfirm(context, userState) {
    const { reply, stateSender, deleteUserState, chats } = context;
    if (!isAffirmative(chats)) {
        return reply(renderTpl("oper_segment_need_yes",
            "Balas *ya* untuk lanjut, atau *batal* untuk membatalkan."), { skipDuplicateCheck: true });
    }
    deleteUserState(stateSender); // bersihkan SEBELUM eksekusi (pola wan-switch)
    const svc = getService(context);
    const actor = actorFromContext(context);
    const result = await svc.applySegmentMove({ segment: userState.segmen, path: userState.jalur, confirm: true, actor: actor.label });
    if (!result || !result.ok) {
        return reply(renderTpl("oper_segment_failed", `❌ Gagal oper segmen: ${(result && result.error) || "tidak diketahui"}`,
            { error: (result && result.error) || "tidak diketahui" }), { skipDuplicateCheck: true });
    }
    const from = String(result.from || userState.from || "").toUpperCase();
    const to = String(userState.jalur).toUpperCase();
    return reply(renderTpl("oper_segment_applied",
        `✅ Segmen *${result.label || userState.label}* dipindah *${from}* → *${to}* (terverifikasi di router).`,
        { segmen: result.label || userState.label, from, to }), { skipDuplicateCheck: true });
}

/** Router state OPERJALUR_*. Gate ulang tiap langkah. NEVER-THROW. */
async function handleOperJalurConversationState(context) {
    const userState = context.userState || (context.getUserState && context.getUserState(context.stateSender));
    const step = (userState && userState.step) || context.stateStep;
    try {
        if (!isAdminOwner(context)) return { handled: false };
        if (step === STEP_CONFIRM) {
            await handleConfirm(context, userState);
            return { handled: true };
        }
        return { handled: false };
    } catch (err) {
        console.warn(`[OPERJALUR] state gagal: ${err.message}`);
        try {
            if (context.deleteUserState) context.deleteUserState(context.stateSender);
            await context.reply("Maaf, terjadi kendala. Proses oper segmen dibatalkan.");
        } catch (_e) { /* abaikan */ }
        return { handled: true };
    }
}

module.exports = {
    startOperJalur,
    handleOperJalurConversationState,
    _internal: { parseOper, isAdminOwner, STEP_CONFIRM }
};
