/**
 * Header Doc
 * Purpose: State domain "oper koneksi" via WhatsApp untuk OWNER/ADMIN — SATU verb, DUA sasaran:
 *          (a) per-SEGMEN (pool/subnet) via `applySegmentMove` (freedns↔lokaldns, jalur mni/gmdp),
 *          (b) per-PELANGGAN (/32 override) via `steerCustomer` (jalur gmdp/mni/ih/sf; butuh
 *          reconciler `customerSteering.enabled` karena IP dinamis). Alur: `oper <sasaran> ke
 *          <jalur>` → jika <sasaran> cocok nama segmen ⇒ mode SEGMEN, else cari PELANGGAN ⇒ mode
 *          pelanggan → pratinjau → balas *ya* → eksekusi (segmen: verify+rollback; pelanggan:
 *          intent+reconcile). Gate peran PRESISI (accounts.json), tulis router HANYA setelah *ya*.
 * Caller: `message/handlers/conversation-state-router.js` (owner "oper-jalur") + trigger
 *         `startOperJalur` dari `raf-intent-dispatch/owner-admin-intents.js` (intent OPER_JALUR).
 * Deps (via context/inject, patuh [[raf-invariants]]): `reply`, `setUserState/deleteUserState/
 *        getUserState`. Require: `../../../lib/customer-steering-service`,
 *        `../../../lib/affirmative-parser`, `./wan-switch.state` (resolveStaffRole),
 *        `../template-helpers` (renderResponseTemplate).
 * MainFuncs: `startOperJalur(context)`, `handleOperJalurConversationState(context)`.
 * SideEffects: Ubah address-list router HANYA di langkah konfirmasi via service; tulis state
 *              percakapan; kirim WA. NEVER-THROW.
 */
"use strict";

const { resolveStaffRole } = require("./wan-switch.state");
const { isAffirmative } = require("../../../lib/affirmative-parser");

const STEP_CONFIRM = "OPERJALUR_CONFIRM";
const ADMIN_ROLES = ["admin", "owner", "superadmin"];
const JALUR_ALIAS = { mni: "mni", gmdp: "gmdp", utama: "gmdp", ih: "ih", sf: "sf", backup: "sf" };
const SEG_ALIAS = { regular: "reguler", biasa: "reguler", "110": "110k", "125": "125k", gratis: "free" };
const CONNECTIVE = ["ke", "jadi", "ganti", "pindah", "di", "jalur", "koneksi", "pelanggan"];

function getService(context) {
    return context.customerSteeringService || require("../../../lib/customer-steering-service");
}
function getUsers(context) {
    if (context.global && Array.isArray(context.global.users)) return context.global.users;
    return Array.isArray(global.users) ? global.users : [];
}
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

/** Parse "<sasaran> ke <jalur>" → { target, jalur }. jalur = token jalur TERAKHIR; sisanya target. */
function parseOperTarget(qAfterKeyword) {
    const words = String(qAfterKeyword || "").toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
    let jalur = null;
    for (let i = words.length - 1; i >= 0; i--) {
        if (JALUR_ALIAS[words[i]]) { jalur = JALUR_ALIAS[words[i]]; words.splice(i, 1); break; }
    }
    const target = words.filter((w) => !CONNECTIVE.includes(w)).join(" ").trim();
    return { target, jalur };
}
/** target → id segmen bila cocok id/alias; else null. */
function matchSegment(target, segmentIds) {
    const t = String(target || "").toLowerCase().trim();
    if (segmentIds.includes(t)) return t;
    if (SEG_ALIAS[t]) return SEG_ALIAS[t];
    return null;
}
/** Resolusi pelanggan: id/pppoe eksak dulu, lalu contains nama/pppoe. */
function resolveCustomers(query, users) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const byId = users.filter((u) => String(u.id) === q);
    if (byId.length) return byId;
    const byPppoe = users.filter((u) => String(u.pppoe_username || "").toLowerCase() === q);
    if (byPppoe.length) return byPppoe;
    return users.filter((u) => String(u.name || "").toLowerCase().includes(q) || String(u.pppoe_username || "").toLowerCase().includes(q));
}

async function startSegment(context, svc, segmen, jalur, segmentIds) {
    const { reply, stateSender, setUserState } = context;
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
    setUserState(stateSender, { step: STEP_CONFIRM, mode: "segment", segmen: preview.segment, label: preview.label, jalur, from: preview.from });
    await reply(renderTpl("oper_segment_preview",
        `🔀 *Oper Segmen — Pratinjau*\n\nSegmen: *${preview.label}* (${aktif} pelanggan aktif)\nJalur: *${from}* → *${to}*\n\nLangkah yang akan dijalankan di router:\n${opsText}\n\nBalas *ya* untuk lanjut, atau *batal*.`,
        { segmen: preview.label, aktif, from, to, ops: opsText }), { skipDuplicateCheck: true });
    return { handled: true };
}

async function startCustomer(context, svc, query, jalur) {
    const { reply, stateSender, setUserState } = context;
    const matches = resolveCustomers(query, getUsers(context));
    if (matches.length === 0) {
        await reply(renderTpl("oper_customer_notfound",
            `⚠️ Pelanggan "${query}" tidak ditemukan. Coba nama lengkap / pppoe / id.`, { query }), { skipDuplicateCheck: true });
        return { handled: true };
    }
    if (matches.length > 1) {
        const daftar = matches.slice(0, 8).map((u) => `• ${u.name || "-"} (${u.pppoe_username || "?"}, id ${u.id})`).join("\n");
        await reply(renderTpl("oper_customer_multiple",
            `⚠️ Beberapa pelanggan cocok "${query}":\n${daftar}\n\nSebutkan lebih spesifik (pppoe / id).`, { query, daftar }), { skipDuplicateCheck: true });
        return { handled: true };
    }
    const u = matches[0];
    if (!u.pppoe_username) {
        await reply(renderTpl("oper_customer_failed", `❌ ${u.name || "Pelanggan"} tanpa pppoe_username — tak bisa di-oper.`,
            { error: "tanpa pppoe_username" }), { skipDuplicateCheck: true });
        return { handled: true };
    }
    setUserState(stateSender, { step: STEP_CONFIRM, mode: "customer", userId: u.id, nama: u.name || u.pppoe_username, pppoe: u.pppoe_username, jalur });
    await reply(renderTpl("oper_customer_preview",
        `🔀 *Oper Pelanggan — Pratinjau*\n\nPelanggan: *${u.name || u.pppoe_username}* (${u.pppoe_username})\nAkan diarahkan ke jalur: *${String(jalur).toUpperCase()}*\n(Override per-pelanggan; entri /32 mengikuti IP-nya otomatis.)\n\nBalas *ya* untuk lanjut, atau *batal*.`,
        { nama: u.name || u.pppoe_username, pppoe: u.pppoe_username, jalur: String(jalur).toUpperCase() }), { skipDuplicateCheck: true });
    return { handled: true };
}

/**
 * Trigger `oper <sasaran> ke <jalur>`. Deteksi segmen vs pelanggan, pratinjau, set state konfirmasi.
 * NEVER-THROW. { handled:false } bila bukan admin (jangan bocorkan).
 */
async function startOperJalur(context) {
    const { reply, qAfterKeyword } = context;
    try {
        if (!isAdminOwner(context)) return { handled: false };
        const svc = getService(context);
        const segmentIds = svc.getSegments().map((s) => s.id);
        const { target, jalur } = parseOperTarget(qAfterKeyword);
        if (!target || !jalur) {
            await reply(renderTpl("oper_segment_invalid",
                "⚠️ Format: *oper <segmen/pelanggan> ke <jalur>*. Contoh: *oper free ke gmdp* atau *oper budi ke sf*.",
                { error: "Format kurang lengkap — sebutkan sasaran dan jalur.", daftar_segmen: segmentIds.join(", ") }),
                { skipDuplicateCheck: true });
            return { handled: true };
        }
        const seg = matchSegment(target, segmentIds);
        if (seg) return await startSegment(context, svc, seg, jalur, segmentIds);
        return await startCustomer(context, svc, target, jalur);
    } catch (err) {
        console.warn(`[OPERJALUR] start gagal: ${err.message}`);
        try { await reply("Maaf, gagal menyiapkan oper. Coba lagi ya."); } catch (_e) { /* abaikan */ }
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
    if (userState.mode === "customer") {
        const result = await svc.steerCustomer({ userId: userState.userId, path: userState.jalur, actor: actor.label });
        if (!result || !result.ok) {
            return reply(renderTpl("oper_customer_failed", `❌ Gagal oper pelanggan: ${(result && result.error) || "tidak diketahui"}`,
                { error: (result && result.error) || "tidak diketahui" }), { skipDuplicateCheck: true });
        }
        return reply(renderTpl("oper_customer_applied", `✅ ${result.message}`,
            { message: result.message, nama: userState.nama, jalur: String(userState.jalur).toUpperCase() }), { skipDuplicateCheck: true });
    }
    // mode segmen
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
            await context.reply("Maaf, terjadi kendala. Proses oper dibatalkan.");
        } catch (_e) { /* abaikan */ }
        return { handled: true };
    }
}

module.exports = {
    startOperJalur,
    handleOperJalurConversationState,
    _internal: { parseOperTarget, matchSegment, resolveCustomers, isAdminOwner, STEP_CONFIRM }
};
