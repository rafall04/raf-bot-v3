/**
 * Header Doc
 * Purpose: State domain WA `#jadwal` — teknisi/admin DAFTAR calon PSB (belum kepasang) via slot-filling.
 *          Kumpulkan Nama/HP/Dusun/Paket (wajib) + lokasi & catatan (opsional), urutan bebas → buat
 *          record papan (`lib/psb-schedule-service` status menunggu) → notif grup "siapa yang pasang?".
 *          Fase A [[psb-audit-golden-path]]. Data RINGAN (tanpa KTP/modem/WiFi — itu saat pasang #PSB).
 * Caller: `conversation-state-router` (owner "psb-schedule", prefix step `PSBJADWAL_`) + trigger
 *         `startPsbScheduleSession` dari `message/raf.js`.
 * Deps (inject/patuh [[raf-invariants]]): `reply` (delivery boundary), `setUserState/deleteUserState`
 *        (conversation-handler, key kanonik), `scheduleService` (createRequest), `sendGroupSummary`
 *        (reply-runtime), `getConfig`, `packages`, `botAreaLabel`. Require: `../psb-caption-parser`.
 * MainFuncs: `startPsbScheduleSession(context)`, `handlePsbScheduleConversationState(context)`.
 * SideEffects: Tulis papan `psb_schedule` + kirim WA (balas teknisi + notif grup). NEVER-THROW.
 */
"use strict";

const { extractPsbFields, resolvePackage } = require("../psb-caption-parser");

const STEP_COLLECT = "PSBJADWAL_COLLECT";
const PSBJADWAL_STEPS = new Set([STEP_COLLECT]);

const REQ_FIELDS = [
    { key: "nama", label: "Nama" },
    { key: "hp", label: "HP" },
    { key: "dusun", label: "Dusun" },
    { key: "paket", label: "Paket" }
];
const FIELD_HINT = { dusun: "(lokasi pasang)", hp: "(nomor WA; >1 pisah |)", paket: "" };

function defaultSendGroupSummary(groupId, text) {
    try {
        const { sendReply } = require("../reply-runtime");
        return sendReply({ recipient: groupId, text });
    } catch (_e) { return null; }
}

function withDeps(context) {
    return {
        ...context,
        scheduleService: context.scheduleService || require("../../../lib/psb-schedule-service"),
        getConfig: context.getConfig || (() => global.config || {}),
        packages: context.packages || global.packages || [],
        sendGroupSummary: context.sendGroupSummary || defaultSendGroupSummary,
        botAreaLabel: context.botAreaLabel || ((global.config && global.config.nama) || null)
    };
}

async function safeReply(reply, text, logger) {
    try { if (reply) await reply(text); } catch (e) { logger?.error?.("[PSB_JADWAL] gagal balas:", e.message); }
}

// Validasi field jadwal (nama/hp/dusun/paket) + resolve paket. Ringan (tanpa wifi).
function validateSchedule(data, packages) {
    const status = {};
    status.nama = data.nama ? "ok" : "missing";
    if (!data.hp) {
        status.hp = "missing";
    } else {
        const parts = String(data.hp).split("|").map((s) => s.trim()).filter(Boolean);
        const bad = parts.filter((p) => { const d = p.replace(/[^0-9]/g, ""); return d.length < 9 || d.length > 15; });
        status.hp = parts.length && !bad.length ? "ok" : (bad.length ? "invalid" : "missing");
        if (status.hp === "ok") data.hp = parts.join("|");
    }
    status.dusun = data.dusun ? "ok" : "missing";
    let resolved = null;
    if (!data.paket) status.paket = "missing";
    else { resolved = resolvePackage(data.paket, packages); status.paket = resolved ? "ok" : "unknown"; }
    const ok = REQ_FIELDS.every((f) => status[f.key] === "ok");
    return { ok, status, paket: resolved || data.paket };
}

function mark(status) {
    if (status === "ok") return "✅";
    if (status === "invalid" || status === "unknown") return "⚠️";
    return "⬜";
}

function checklistText(data, v) {
    const s = v.status;
    const lines = REQ_FIELDS.map((f) => {
        const val = data[f.key];
        let tail = "";
        if (val) {
            tail = `: ${val}`;
            if (s[f.key] === "unknown") tail += " ⚠️ tak dikenal";
            else if (s[f.key] === "invalid") tail += " ⚠️ tak valid";
        } else if (FIELD_HINT[f.key]) {
            tail = ` ${FIELD_HINT[f.key]}`;
        }
        return `${mark(s[f.key])} ${f.label}${tail}`;
    });
    return [
        `📋 *Jadwal PSB* — lengkapi (urutan bebas):`,
        ...lines,
        `${data.lokasi ? "✅" : "⬜"} Lokasi (share lokasi, opsional)`,
        data.catatan ? `📝 Catatan: ${data.catatan}` : "⬜ Catatan (opsional, ketik `Catatan: …`)",
        ``,
        `➡️ Kirim yang masih ⬜. Boleh dicicil. *BATAL* untuk batal.`
    ].join("\n");
}

// Data lengkap → buat record papan (menunggu) + balas + notif grup. NEVER-THROW. Return true bila sukses.
async function finalizeSchedule(context, ctx, v) {
    const { reply, deleteUserState, stateSender, scheduleService, sendGroupSummary, botAreaLabel, getConfig, nowMs = Date.now(), logger = console } = context;

    let record = null;
    try {
        record = await scheduleService.createRequest({
            nama: ctx.data.nama,
            hp: ctx.data.hp,
            dusun: ctx.data.dusun,
            paket: v.paket,
            latitude: ctx.data.lokasi ? ctx.data.lokasi.lat : null,
            longitude: ctx.data.lokasi ? ctx.data.lokasi.lng : null,
            catatan: ctx.data.catatan || "",
            requestedById: ctx.staff?.id,
            requestedByName: ctx.staff?.name || ctx.staff?.username,
            area: ctx.area || botAreaLabel,
            nowIso: new Date(nowMs).toISOString()
        });
    } catch (e) {
        logger?.error?.("[PSB_JADWAL] gagal buat record:", e.message);
        await safeReply(reply, `❌ Gagal menyimpan jadwal: ${e.message}. Coba lagi.`, logger);
        return false; // state dibiarkan → teknisi bisa ulang
    }

    deleteUserState(stateSender);
    await safeReply(reply, `✅ Terjadwal *${record.ref}* — ${record.name} · ${ctx.data.dusun} · ${v.paket}.\nSudah diumumkan ke grup untuk pemasangan.`, logger);

    try {
        const cfg = ((getConfig && getConfig()) || global.config || {});
        const psbCfg = cfg.psbIntake || {};
        const groupId = psbCfg.summaryGroupId || psbCfg.groupId;
        if (sendGroupSummary && groupId) {
            await sendGroupSummary(groupId, [
                `📥 *PSB BARU — belum kepasang* · ${record.ref}`,
                `👤 ${record.name} · Dusun ${ctx.data.dusun}`,
                `📦 ${v.paket} · 📱 ${ctx.data.hp}`,
                ctx.data.catatan ? `📝 ${ctx.data.catatan}` : null,
                ``,
                `👉 Belum kepasang — koordinasikan siapa yang pasang. _(klaim/tugaskan otomatis menyusul)_`,
                `Diminta oleh: ${ctx.staff?.name || ctx.staff?.username || "-"}`
            ].filter(Boolean).join("\n"));
        }
    } catch (e) { logger?.error?.("[PSB_JADWAL] notif grup gagal:", e.message); }

    return true;
}

// ── Trigger: teknisi/admin ketik `#jadwal` (teks) → buka sesi. Dipanggil dari raf.js. ──
async function startPsbScheduleSession(context) {
    context = withDeps(context);
    const { chats, staff, stateSender, reply, packages, setUserState, area, logger = console } = context;

    const seed = { nama: "", hp: "", dusun: "", paket: "", catatan: "", lokasi: null, ...extractPsbFields(String(chats || "").replace(/^\s*#?jadwal\b|^\s*psb\s+baru\b/i, "")) };
    const ctx = { data: seed, staff, area: area || null };
    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });

    const v = validateSchedule(ctx.data, packages);
    if (v.ok) { await finalizeSchedule(context, ctx, v); return { started: true }; } // one-shot: data lengkap di caption
    await safeReply(reply, `📝 Daftar PSB baru (belum kepasang).\n\n${checklistText(ctx.data, v)}`, logger);
    return { started: true };
}

// ── Router state (owner "psb-schedule") ──
async function handlePsbScheduleConversationState(context) {
    context = withDeps(context);
    const { stateStep, teknisiState, type, msg, chats, reply, setUserState, deleteUserState, stateSender, packages, logger = console } = context;

    if (!PSBJADWAL_STEPS.has(stateStep)) return { handled: false };
    const ctx = (teknisiState && teknisiState.context) || null;
    if (!ctx || !ctx.data) { deleteUserState(stateSender); return { handled: true }; }

    const text = String(chats || "").trim();
    if (["batal", "cancel", "ga jadi", "gajadi"].includes(text.toLowerCase())) {
        deleteUserState(stateSender);
        await safeReply(reply, "❌ Jadwal PSB dibatalkan. Tidak ada yang disimpan.", logger);
        return { handled: true };
    }

    if (type === "locationMessage" || type === "liveLocationMessage") {
        const loc = type === "locationMessage" ? msg?.message?.locationMessage : msg?.message?.liveLocationMessage;
        if (loc && loc.degreesLatitude && loc.degreesLongitude) ctx.data.lokasi = { lat: loc.degreesLatitude, lng: loc.degreesLongitude };
    } else {
        const fields = extractPsbFields(text);
        for (const [k, val] of Object.entries(fields)) { if (val) ctx.data[k] = val; }
    }

    const v = validateSchedule(ctx.data, packages);
    if (v.ok) { await finalizeSchedule(context, ctx, v); return { handled: true }; }

    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
    await safeReply(reply, checklistText(ctx.data, v), logger);
    return { handled: true };
}

module.exports = {
    startPsbScheduleSession,
    handlePsbScheduleConversationState,
    validateSchedule,
    PSBJADWAL_STEPS,
    STEP_COLLECT
};
