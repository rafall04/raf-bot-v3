/**
 * Header Doc
 * Purpose: State domain WA `#jadwal` — teknisi/admin DAFTAR calon PSB (belum kepasang) via slot-filling,
 *          dengan 3 BUKTI WAJIB (foto KTP + foto rumah + share lokasi) agar installer tahu rumahnya.
 *          Kumpulkan Identitas (Nama/HP/Dusun/Paket) + 3 bukti + catatan opsional, urutan bebas → buat
 *          record papan (`lib/psb-schedule-service` status menunggu) → notif grup. Fase A/1 + S1.
 *          Kontrak intake SAMA dgn wizard #PSB (identitas + 3 bukti); jadwal berhenti di menunggu.
 * Caller: `conversation-state-router` (owner "psb-schedule", prefix step `PSBJADWAL_`) + trigger
 *         `startPsbScheduleSession` dari `message/raf.js`.
 * Deps (inject/patuh [[raf-invariants]]): `reply`/`downloadMedia` (delivery boundary/adapter),
 *        `setUserState/deleteUserState` (conversation-handler, key kanonik), `scheduleService`
 *        (createRequest), `sendGroupSummary` (reply-runtime), `getConfig`, `packages`, `uploadsBaseDir`.
 * MainFuncs: `startPsbScheduleSession(context)`, `handlePsbScheduleConversationState(context)`.
 * SideEffects: Tulis foto KTP/rumah ke `uploads/psb-jadwal/...`, papan `psb_schedule`, kirim WA. NEVER-THROW.
 */
"use strict";

const fs = require("fs");
const path = require("path");
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
        botAreaLabel: context.botAreaLabel || ((global.config && global.config.nama) || null),
        uploadsBaseDir: context.uploadsBaseDir || path.join(__dirname, "..", "..", "..", "uploads")
    };
}

async function safeReply(reply, text, logger) {
    try { if (reply) await reply(text); } catch (e) { logger?.error?.("[PSB_JADWAL] gagal balas:", e.message); }
}

function saveMedia(dir, filename, buffer) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const full = path.join(dir, filename);
        fs.writeFileSync(full, buffer);
        return full;
    } catch (_e) { return null; }
}

// Validasi identitas jadwal (nama/hp/dusun/paket) + resolve paket. Bukti dicek terpisah di gate.
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

// Lengkap = identitas valid + 3 bukti (KTP + rumah + lokasi).
function isComplete(ctx, v) {
    return v.ok && !!ctx.ktpPath && !!ctx.rumahPath && !!ctx.lokasi;
}

function checklistText(ctx, v) {
    const s = v.status;
    const dataLines = REQ_FIELDS.map((f) => {
        const val = ctx.data[f.key];
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
    const nextPhoto = !ctx.ktpPath ? " (kirim foto KTP dulu)" : (!ctx.rumahPath ? " (lalu foto rumah)" : "");
    return [
        `📋 *Jadwal PSB* — lengkapi (urutan bebas):`,
        ...dataLines,
        `${ctx.ktpPath ? "✅" : "⬜"} Foto KTP`,
        `${ctx.rumahPath ? "✅" : "⬜"} Foto rumah`,
        `${ctx.lokasi ? "✅" : "⬜"} Share lokasi`,
        ctx.data.catatan ? `📝 Catatan: ${ctx.data.catatan}` : null,
        ``,
        `➡️ Kirim yang masih ⬜${nextPhoto}. Boleh dicicil. *BATAL* untuk batal.`
    ].filter((x) => x !== null).join("\n");
}

// Data + bukti lengkap → buat record papan (menunggu) + balas + notif grup. NEVER-THROW.
async function finalizeSchedule(context, ctx, v) {
    const { reply, deleteUserState, stateSender, scheduleService, sendGroupSummary, botAreaLabel, getConfig, nowMs = Date.now(), logger = console } = context;

    let record = null;
    try {
        record = await scheduleService.createRequest({
            nama: ctx.data.nama,
            hp: ctx.data.hp,
            dusun: ctx.data.dusun,
            paket: v.paket,
            latitude: ctx.lokasi ? ctx.lokasi.lat : null,
            longitude: ctx.lokasi ? ctx.lokasi.lng : null,
            catatan: ctx.data.catatan || "",
            ktpPhotoPath: ctx.ktpPath || null,
            housePhotoPath: ctx.rumahPath || null,
            requestedById: ctx.staff?.id,
            requestedByName: ctx.staff?.name || ctx.staff?.username,
            area: ctx.area || botAreaLabel,
            nowIso: new Date(nowMs).toISOString()
        });
    } catch (e) {
        logger?.error?.("[PSB_JADWAL] gagal buat record:", e.message);
        await safeReply(reply, `❌ Gagal menyimpan jadwal: ${e.message}. Coba lagi.`, logger);
        return false;
    }

    deleteUserState(stateSender);
    await safeReply(reply, `✅ Terjadwal *${record.ref}* — ${record.name} · ${ctx.data.dusun} · ${v.paket}.\nBukti lengkap (KTP + rumah + lokasi). Sudah diumumkan ke grup untuk pemasangan.`, logger);

    try {
        const cfg = ((getConfig && getConfig()) || global.config || {});
        const psbCfg = cfg.psbIntake || {};
        const groupId = psbCfg.summaryGroupId || psbCfg.groupId;
        if (sendGroupSummary && groupId) {
            await sendGroupSummary(groupId, [
                `📥 *PSB BARU — belum kepasang* · ${record.ref}`,
                `👤 ${record.name} · Dusun ${ctx.data.dusun}`,
                `📦 ${v.paket} · 📱 ${ctx.data.hp}`,
                `📎 Bukti: KTP ✅ · Rumah ✅ · Lokasi ✅`,
                ctx.data.catatan ? `📝 ${ctx.data.catatan}` : null,
                ``,
                `👉 Belum kepasang — koordinasikan siapa yang pasang. _(klaim/tugaskan otomatis menyusul)_`,
                `Diminta oleh: ${ctx.staff?.name || ctx.staff?.username || "-"}`
            ].filter((x) => x !== null).join("\n"));
        }
    } catch (e) { logger?.error?.("[PSB_JADWAL] notif grup gagal:", e.message); }

    return true;
}

// ── Trigger: teknisi/admin ketik `#jadwal` (teks) → buka sesi. Dipanggil dari raf.js. ──
async function startPsbScheduleSession(context) {
    context = withDeps(context);
    const { chats, staff, stateSender, reply, packages, setUserState, area, uploadsBaseDir, nowMs = Date.now(), logger = console } = context;

    const now = new Date(nowMs);
    const tempId = `PSBJDW_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
    const dir = path.join(uploadsBaseDir, "psb-jadwal", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), tempId);
    const seed = { nama: "", hp: "", dusun: "", paket: "", catatan: "", ...extractPsbFields(String(chats || "").replace(/^\s*#?jadwal\b|^\s*psb\s+baru\b/i, "")) };
    const ctx = { data: seed, staff, area: area || null, tempId, dir, ktpPath: null, rumahPath: null, lokasi: null };
    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });

    const v = validateSchedule(ctx.data, packages);
    await safeReply(reply, `📝 Daftar PSB baru (belum kepasang) — butuh *3 bukti*: foto KTP, foto rumah, share lokasi.\n\n${checklistText(ctx, v)}`, logger);
    return { started: true };
}

// ── Router state (owner "psb-schedule") ──
async function handlePsbScheduleConversationState(context) {
    context = withDeps(context);
    const { stateStep, teknisiState, type, msg, chats, reply, downloadMedia, setUserState, deleteUserState, stateSender, packages, logger = console } = context;

    if (!PSBJADWAL_STEPS.has(stateStep)) return { handled: false };
    const ctx = (teknisiState && teknisiState.context) || null;
    if (!ctx || !ctx.data) { deleteUserState(stateSender); return { handled: true }; }

    const text = String(chats || "").trim();
    if (["batal", "cancel", "ga jadi", "gajadi"].includes(text.toLowerCase())) {
        deleteUserState(stateSender);
        await safeReply(reply, "❌ Jadwal PSB dibatalkan. Tidak ada yang disimpan.", logger);
        return { handled: true };
    }

    if (type === "imageMessage") {
        // Foto pertama = KTP, kedua = rumah (checklist memandu urutan).
        const target = !ctx.ktpPath ? "ktp_photo.jpg" : (!ctx.rumahPath ? "rumah_photo.jpg" : null);
        if (!target) {
            await safeReply(reply, "Foto KTP & rumah sudah diterima. Kirim yang masih kurang.", logger);
            return { handled: true };
        }
        let saved = null;
        try {
            const buffer = await downloadMedia(msg, "buffer", {});
            if (buffer && buffer.length > 0) saved = saveMedia(ctx.dir, target, buffer);
        } catch (e) { logger?.error?.("[PSB_JADWAL] gagal simpan foto:", e.message); }
        if (!saved) { await safeReply(reply, "⚠️ Foto gagal diunduh — kirim ulang (foto segar dari galeri/kamera).", logger); return { handled: true }; }
        if (target === "ktp_photo.jpg") ctx.ktpPath = saved; else ctx.rumahPath = saved;
    } else if (type === "locationMessage" || type === "liveLocationMessage") {
        const loc = type === "locationMessage" ? msg?.message?.locationMessage : msg?.message?.liveLocationMessage;
        if (loc && loc.degreesLatitude && loc.degreesLongitude) ctx.lokasi = { lat: loc.degreesLatitude, lng: loc.degreesLongitude };
    } else {
        const fields = extractPsbFields(text);
        for (const [k, val] of Object.entries(fields)) { if (val) ctx.data[k] = val; }
    }

    const v = validateSchedule(ctx.data, packages);
    if (isComplete(ctx, v)) { await finalizeSchedule(context, ctx, v); return { handled: true }; }

    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
    await safeReply(reply, checklistText(ctx, v), logger);
    return { handled: true };
}

module.exports = {
    startPsbScheduleSession,
    handlePsbScheduleConversationState,
    validateSchedule,
    isComplete,
    PSBJADWAL_STEPS,
    STEP_COLLECT
};
