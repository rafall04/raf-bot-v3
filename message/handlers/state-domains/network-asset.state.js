/**
 * Header Doc
 * Purpose: State domain WA `#ODC` / `#ODP` — teknisi MEMETAKAN aset jaringan dari lapangan.
 *          Sebelum ini tak ada SATU pun jalur WA untuk aset, dan jalur web-nya admin-only (teknisi 403)
 *          → orang yang paling tahu di mana ODP-nya justru terkunci, dan peta jaringan tetap KOSONG.
 *
 *          RANCANGAN "buang keputusan" (teknisi gaptek, satu tangan, di atas tangga):
 *            - Yang WAJIB cuma DUA: nama + share lokasi. Sisanya bot yang urus.
 *            - Induk ODC untuk sebuah ODP DIPILIHKAN otomatis (ODC terdekat) — teknisi tinggal
 *              mengiyakan. Tak perlu hafal/ketik ID aset sama sekali.
 *            - Kapasitas punya default (config `networkAssets.defaultOdpCapacity`, 8) → boleh dilewati.
 *            - Foto box OPSIONAL (disimpan) — itu yang bikin ODP ini ketemu lagi setahun kemudian.
 *            - Bot MEMBUKTIKAN hasil (ID, koordinat, link peta, induk + jarak), bukan cuma bilang "sukses".
 *          Tak ada ODC di dekat titik → LANJUT TANPA INDUK, jangan menebak.
 * Caller: `conversation-state-router` (owner "network-asset", prefix step `ASSET_`) + trigger
 *         `startNetworkAssetSession` dari `message/raf.js`.
 * Deps (inject): `reply`/`downloadMedia` (delivery boundary), `setUserState`/`deleteUserState`
 *        (conversation-handler, key kanonik), `lib/network-assets-service` (SATU pemilik aturan aset —
 *        sama dgn route web), `lib/affirmative-parser` (JANGAN pakai daftar cocok-persis).
 * MainFuncs: `startNetworkAssetSession(context)`, `handleNetworkAssetConversationState(context)`.
 * SideEffects: Tulis `database/network_assets.json` (via service, di bawah lock) + foto ke
 *              `uploads/network-assets/...` + kirim WA. NEVER-THROW.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { isAffirmative } = require("../../../lib/affirmative-parser");

const STEP_COLLECT = "ASSET_COLLECT";
const STEP_CONFIRM = "ASSET_CONFIRM";
const STEP_PICK_PARENT = "ASSET_PICK_PARENT";
const ASSET_STEPS = new Set([STEP_COLLECT, STEP_CONFIRM, STEP_PICK_PARENT]);

// `#ODC Balen` / `#ODP Balen 2`. Wajib pakai `#` (sama seperti #PSB/#jadwal) supaya kata "odp" di
// kalimat biasa tak membuka wizard.
const TRIGGER_RE = /^\s*#(odc|odp)\b\s*(.*)$/i;
const CANCEL_RE = /^\s*(batal|cancel|ga\s*jadi|gajadi)\s*$/i;

function withDeps(context) {
    return {
        ...context,
        assetService: context.assetService || require("../../../lib/network-assets-service"),
        uploadsBaseDir: context.uploadsBaseDir || path.join(__dirname, "..", "..", "..", "uploads")
    };
}

async function safeReply(reply, text, logger) {
    try { if (reply) await reply(text); } catch (e) { logger?.error?.("[ASET] gagal balas:", e.message); }
}

function saveMedia(dir, filename, buffer) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const full = path.join(dir, filename);
        fs.writeFileSync(full, buffer);
        return full;
    } catch (_e) { return null; }
}

function extractLocation(type, msg) {
    const loc = type === "locationMessage"
        ? msg?.message?.locationMessage
        : (type === "liveLocationMessage" ? msg?.message?.liveLocationMessage : null);
    if (loc && loc.degreesLatitude && loc.degreesLongitude) {
        return { lat: loc.degreesLatitude, lng: loc.degreesLongitude };
    }
    return null;
}

function defaultCapacity(assetService) {
    try { return assetService.getAssetConfig().defaultOdpCapacity; } catch (_e) { return 8; }
}

function jarak(m) {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

/**
 * Cari induk ODC terdekat utk sebuah ODP. Tak ada yang masuk radius → null (JANGAN menebak induk jauh).
 * NEVER-THROW: data aset rusak / service gagal tak boleh menjatuhkan sesi teknisi di lapangan —
 * usulan induk itu kenyamanan, bukan syarat. Gagal → tanpa induk, dan dia tetap bisa menyimpan.
 */
function resolveParent(context, ctx) {
    const { assetService, logger = console } = context;
    if (ctx.type !== "ODP" || !ctx.lokasi) return null;

    try {
        let maxMeters = 2000;
        try { maxMeters = assetService.getAssetConfig().odcSuggestMaxMeters; } catch (_e) { /* pakai default */ }

        const near = assetService.findNearest(ctx.lokasi.lat, ctx.lokasi.lng, "ODC", { limit: 5, maxMeters }) || [];
        ctx.parentChoices = near.map((n) => ({ id: n.asset.id, name: n.asset.name, meters: n.meters }));
        return ctx.parentChoices[0] || null;
    } catch (e) {
        logger?.error?.("[ASET] gagal cari induk ODC:", e.message);
        ctx.parentChoices = [];
        return null;
    }
}

function checklistText(ctx, assetService) {
    const cap = ctx.capacity || defaultCapacity(assetService);
    return [
        `🗺️ *Petakan ${ctx.type}* — cuma butuh 2 hal:`,
        `${ctx.name ? "✅" : "⬜"} Nama${ctx.name ? `: ${ctx.name}` : " (balas namanya)"}`,
        `${ctx.lokasi ? "✅" : "⬜"} Share lokasi (berdiri di depan ${ctx.type}-nya)`,
        ``,
        `Opsional: kirim *foto box* (biar gampang dicari lagi nanti) · balas *angka* untuk ubah kapasitas (sekarang ${cap} port).`,
        `Ketik *BATAL* untuk batal.`
    ].join("\n");
}

function summaryText(ctx, assetService) {
    const cap = ctx.capacity || defaultCapacity(assetService);
    const lines = [
        `📍 *Cek dulu sebelum disimpan:*`,
        ``,
        `*${ctx.type}*: ${ctx.name}`,
        `Lokasi: ${ctx.lokasi.lat.toFixed(6)}, ${ctx.lokasi.lng.toFixed(6)}`,
        `Kapasitas: ${cap} port`,
        ctx.photoPath ? `Foto box: ✅ tersimpan` : `Foto box: — (opsional)`
    ];

    if (ctx.type === "ODP") {
        if (ctx.parent) {
            lines.push(`Induk ODC: *${ctx.parent.name}* (${jarak(ctx.parent.meters)}) — dipilih otomatis`);
        } else if ((ctx.parentChoices || []).length === 0) {
            lines.push(`Induk ODC: — belum ada ODC terdaftar di sekitar sini (boleh lanjut tanpa induk)`);
        } else {
            lines.push(`Induk ODC: — (tanpa induk)`);
        }
    }

    lines.push(``);
    const gantiHint = ctx.type === "ODP" && (ctx.parentChoices || []).length > 0
        ? ` · *GANTI* untuk pilih induk lain`
        : "";
    lines.push(`Balas *YA* untuk simpan${gantiHint} · *BATAL* untuk batal.`);
    return lines.join("\n");
}

function parentPickerText(ctx) {
    const lines = [`🔗 Pilih induk ODC untuk *${ctx.name}*:`, ``];
    (ctx.parentChoices || []).forEach((p, i) => {
        lines.push(`*${i + 1}.* ${p.name} — ${jarak(p.meters)}`);
    });
    lines.push(``, `Balas *angka*-nya, atau *0* untuk tanpa induk.`);
    return lines.join("\n");
}

/** Simpan + BUKTIKAN (ID, koordinat, link peta, induk + jarak). NEVER-THROW. */
async function finalizeAsset(context, ctx) {
    const { reply, deleteUserState, stateSender, assetService, logger = console } = context;

    let asset = null;
    try {
        asset = await assetService.createAsset({
            type: ctx.type,
            name: ctx.name,
            latitude: ctx.lokasi.lat,
            longitude: ctx.lokasi.lng,
            capacity_ports: ctx.capacity || defaultCapacity(assetService),
            parent_odc_id: ctx.parent ? ctx.parent.id : null,
            photo_path: ctx.photoPath || "",
            created_by: ctx.staff?.name || ctx.staff?.username || "",
            source: "wa"
        });
    } catch (e) {
        logger?.error?.("[ASET] gagal simpan:", e.message);
        await safeReply(reply, `❌ Gagal menyimpan: ${e.message}`, logger);
        return { handled: true };
    }

    deleteUserState(stateSender);

    const bukti = [
        `✅ *${asset.name}* tersimpan.`,
        ``,
        `🆔 ${asset.id}`,
        `🔌 Kapasitas ${asset.capacity_ports} port (terpakai ${asset.ports_used})`,
        ctx.parent ? `🔗 Induk: ${ctx.parent.name} (${jarak(ctx.parent.meters)})` : null,
        `📍 ${assetService.mapsUrl(asset.latitude, asset.longitude)}`,
        ``,
        asset.type === "ODC"
            ? `Lanjut petakan ODP-nya: ketik *#ODP <nama>*`
            : `Pelanggan baru di dekat sini akan otomatis diusulkan ke ODP ini saat *#PSB*.`
    ].filter(Boolean).join("\n");

    await safeReply(reply, bukti, logger);
    return { handled: true };
}

// ── Trigger: staf ketik `#ODC <nama>` / `#ODP <nama>`. Dipanggil dari raf.js. ──
async function startNetworkAssetSession(context) {
    context = withDeps(context);
    const { chats, staff, stateSender, reply, setUserState, assetService, uploadsBaseDir, nowMs = Date.now(), logger = console } = context;

    const m = TRIGGER_RE.exec(String(chats || ""));
    if (!m) return { started: false };

    const now = new Date(nowMs);
    const tempId = `ASET_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
    const ctx = {
        type: m[1].toUpperCase(),
        name: String(m[2] || "").trim(),
        lokasi: null,
        capacity: null,
        photoPath: null,
        parent: null,
        parentChoices: [],
        staff,
        tempId,
        dir: path.join(uploadsBaseDir, "network-assets", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), tempId)
    };

    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
    await safeReply(reply, checklistText(ctx, assetService), logger);
    return { started: true };
}

// ── Router state (owner "network-asset") ──
async function handleNetworkAssetConversationState(context) {
    context = withDeps(context);
    const {
        stateStep, teknisiState, userState, type, msg, chats, reply, downloadMedia,
        setUserState, deleteUserState, stateSender, assetService, logger = console
    } = context;

    if (!ASSET_STEPS.has(stateStep)) return { handled: false };

    const state = teknisiState || userState || null;
    const ctx = (state && state.context) || null;
    if (!ctx || !ctx.type) { deleteUserState(stateSender); return { handled: true }; }

    const text = String(chats || "").trim();
    if (CANCEL_RE.test(text)) {
        deleteUserState(stateSender);
        await safeReply(reply, `❌ Dibatalkan. ${ctx.type} tidak disimpan.`, logger);
        return { handled: true };
    }

    // ── Pilih induk ODC (dari daftar bernomor) ──
    if (stateStep === STEP_PICK_PARENT) {
        const n = parseInt(text, 10);
        if (Number.isFinite(n) && n >= 0 && n <= (ctx.parentChoices || []).length) {
            ctx.parent = n === 0 ? null : ctx.parentChoices[n - 1];
            setUserState(stateSender, { step: STEP_CONFIRM, _scope: "teknisi", context: ctx });
            await safeReply(reply, summaryText(ctx, assetService), logger);
            return { handled: true };
        }
        await safeReply(reply, parentPickerText(ctx), logger);
        return { handled: true };
    }

    // ── Konfirmasi simpan ──
    if (stateStep === STEP_CONFIRM) {
        if (/^\s*(ganti|induk|pilih)\b/i.test(text) && (ctx.parentChoices || []).length > 0) {
            setUserState(stateSender, { step: STEP_PICK_PARENT, _scope: "teknisi", context: ctx });
            await safeReply(reply, parentPickerText(ctx), logger);
            return { handled: true };
        }
        if (isAffirmative(text)) {
            return finalizeAsset(context, ctx);
        }
        await safeReply(reply, summaryText(ctx, assetService), logger);
        return { handled: true };
    }

    // ── Kumpulkan (urutan bebas) ──
    if (type === "imageMessage") {
        let saved = null;
        try {
            const buffer = await downloadMedia(msg, "buffer", {});
            if (buffer && buffer.length > 0) saved = saveMedia(ctx.dir, "box.jpg", buffer);
        } catch (e) { logger?.error?.("[ASET] gagal simpan foto:", e.message); }
        if (saved) ctx.photoPath = saved;
        else await safeReply(reply, "⚠️ Foto gagal diunduh — kirim ulang (foto segar dari kamera).", logger);
    } else {
        const loc = extractLocation(type, msg);
        if (loc) {
            ctx.lokasi = loc;
        } else if (/^\d{1,3}$/.test(text)) {
            // Angka polos = kapasitas port (8/16/24 — tertulis di box-nya).
            ctx.capacity = parseInt(text, 10);
        } else if (text) {
            ctx.name = text;
        }
    }

    if (ctx.name && ctx.lokasi) {
        ctx.parent = resolveParent(context, ctx);
        setUserState(stateSender, { step: STEP_CONFIRM, _scope: "teknisi", context: ctx });
        await safeReply(reply, summaryText(ctx, assetService), logger);
        return { handled: true };
    }

    setUserState(stateSender, { step: STEP_COLLECT, _scope: "teknisi", context: ctx });
    await safeReply(reply, checklistText(ctx, assetService), logger);
    return { handled: true };
}

module.exports = {
    startNetworkAssetSession,
    handleNetworkAssetConversationState,
    TRIGGER_RE,
    ASSET_STEPS,
    STEP_COLLECT,
    STEP_CONFIRM,
    STEP_PICK_PARENT
};
