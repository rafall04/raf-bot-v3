/**
 * Header Doc
 * Purpose: State domain `PKGREQ_*` — lanjutan percakapan admin saat menyetujui/menolak/membatalkan
 *   REQUEST GANTI PAKET lewat WhatsApp. Dua langkah: `PKGREQ_SELECT` (antrian bernomor sudah ditampilkan
 *   oleh perintah `request paket`, menunggu admin membalas angka / `ok 1` / `tolak 2 <alasan>` /
 *   `batalkan 3`) dan `PKGREQ_CONFIRM` (satu request terpilih, menunggu `ya`; pada aksi tolak teks bebas
 *   dianggap ALASAN; aksi batalkan menutup request TANPA menyentuh pelanggan). Kata kunci eksplisit
 *   (`tolak`/`batalkan`/`ok`) boleh mengganti aksi di tengah jalan. Snapshot antrian disimpan di state
 *   supaya penomoran stabil walau ada request baru masuk.
 *   Kata batal universal (`batal`/`cancel`/`ga jadi`) SENGAJA tidak dipakai sebagai verb di sini — ia
 *   ditangkap guard universal di raf.js lebih dulu (= keluar dari alur). Verb batalkan-diam-diam memakai
 *   `batalkan`/`hapus` agar lolos guard itu.
 *   Gate peran diulang tiap langkah (accounts.json). Perintah global (`menu`, `lapor`, …) dilepas
 *   (`handled:false`) agar admin bisa keluar. NEVER-THROW.
 * Caller: message/handlers/conversation-state-router.js (owner "package-request", prefix `PKGREQ_`).
 * Deps: ../package-request-admin-handler (eksekusi/daftar/prompt + gate peran + actorCtx), lib/response-template-helper.
 *   `reply` / `setUserState` / `deleteUserState` diinjeksi router (conversation-handler, key stateSender).
 * MainFuncs: handlePackageRequestAdminState.
 * SideEffects: Lewat admin.service — update MikroTik + subscription DB, kirim WA ke pelanggan & teknisi.
 *   Menghapus/menulis conversation state. Balas admin lewat `reply`.
 */
"use strict";

const { renderResponseTemplate } = require("../../../lib/response-template-helper");
const {
    STEP_SELECT,
    STEP_CONFIRM,
    CMD_LIST,
    getService,
    isAdminActor,
    buildActorCtx,
    isYes,
    executeApprove,
    executeReject,
    executeCancel,
    replyPendingList,
    promptDecision,
    resolvePendingByIndex
} = require("../package-request-admin-handler");

const CODE = "req_pkg_\\d+_[a-z0-9]+";
const PICK_NUMBER = /^(\d{1,2})$/;
const PICK_CONFIRM = new RegExp(`^(?:ok|oke|setuju|setujui|approve|acc|terima)\\s+(\\d{1,2}|${CODE})\\s*$`, "i");
const PICK_REJECT = new RegExp(`^(?:tolak|reject)\\s+(\\d{1,2}|${CODE})(?:\\s+(.*))?$`, "i");
const PICK_CANCEL = new RegExp(`^(?:batalkan|batal|cancel|hapus)\\s+(\\d{1,2}|${CODE})(?:\\s+(.*))?$`, "i");
const BARE_REJECT = /^(?:tolak|reject)\s*(.*)$/i;
// batal/cancel bare ditangkap guard universal; batalkan/hapus lolos → itu yang jadi verb batalkan-diam-diam.
const BARE_CANCEL = /^(?:batalkan|hapus)\s*(.*)$/i;
const BARE_CONFIRM = /^(?:ok|oke|setuju|setujui|approve|acc|terima)\s*$/i;
const CODE_ONLY = new RegExp(`^${CODE}$`, "i");

/** Samakan aksi tersimpan ke salah satu dari approve/reject/cancel (default approve). */
function normalizeAction(action) {
    if (action === "reject") return "reject";
    if (action === "cancel") return "cancel";
    return "approve";
}

function clearState(ctx) {
    if (typeof ctx.deleteUserState === "function" && ctx.stateSender) ctx.deleteUserState(ctx.stateSender);
}

/** `1` → id lewat snapshot state; `req_pkg_…` → apa adanya. null bila di luar jangkauan. */
async function resolveToken(service, actorCtx, token, items) {
    const raw = String(token || "").trim();
    if (CODE_ONLY.test(raw)) return { id: raw.toLowerCase() };
    const index = parseInt(raw, 10);
    return resolvePendingByIndex(service, actorCtx, index, items);
}

function replyInvalidChoice(ctx, total) {
    return ctx.reply(renderResponseTemplate(
        "package_request_admin_invalid_choice",
        "Pilihan tidak valid. Balas angka *1*–*${total}*, atau *batal*.",
        { total }
    ), { skipDuplicateCheck: true });
}

function replyNeedYes(ctx) {
    return ctx.reply(renderResponseTemplate(
        "package_request_admin_need_yes",
        "Balas *ya* untuk lanjut, *tolak <alasan>* untuk menolak, *batalkan* untuk membatalkan diam-diam, atau *ga jadi* untuk keluar."
    ), { skipDuplicateCheck: true });
}

async function handleSelect(ctx, userState) {
    const service = getService(ctx);
    const actorCtx = buildActorCtx(ctx);
    const items = userState.items || [];
    const body = String(ctx.chats || "").trim();

    // Pesan tanpa teks (mis. admin mengirim foto) bukan urusan kami — jangan dibajak.
    if (!body) return { handled: false };

    // Muat ulang antrian.
    if (CMD_LIST.test(body)) {
        await replyPendingList(ctx, service, actorCtx, userState.action || "approve");
        return { handled: true };
    }

    const confirmPick = body.match(PICK_CONFIRM);
    if (confirmPick) {
        const target = await resolveToken(service, actorCtx, confirmPick[1], items);
        if (!target) { await replyInvalidChoice(ctx, items.length); return { handled: true }; }
        clearState(ctx);
        await executeApprove(ctx, service, actorCtx, target.id);
        return { handled: true };
    }

    const rejectPick = body.match(PICK_REJECT);
    if (rejectPick) {
        const target = await resolveToken(service, actorCtx, rejectPick[1], items);
        if (!target) { await replyInvalidChoice(ctx, items.length); return { handled: true }; }
        clearState(ctx);
        await executeReject(ctx, service, actorCtx, target.id, (rejectPick[2] || "").trim());
        return { handled: true };
    }

    const cancelPick = body.match(PICK_CANCEL);
    if (cancelPick) {
        const target = await resolveToken(service, actorCtx, cancelPick[1], items);
        if (!target) { await replyInvalidChoice(ctx, items.length); return { handled: true }; }
        clearState(ctx);
        await executeCancel(ctx, service, actorCtx, target.id, (cancelPick[2] || "").trim());
        return { handled: true };
    }

    // Angka polos → tegaskan dulu (`ya`), sesuai aksi yang membuka daftar ini.
    const picked = body.match(PICK_NUMBER);
    if (picked) {
        const target = await resolvePendingByIndex(service, actorCtx, parseInt(picked[1], 10), items);
        if (!target) { await replyInvalidChoice(ctx, items.length); return { handled: true }; }
        await promptDecision(ctx, target, normalizeAction(userState.action));
        return { handled: true };
    }

    // Bukan token kami: biarkan perintah global (menu/lapor/…) menembus alur ini.
    if (ctx.isGlobalCommand) return { handled: false };
    await replyInvalidChoice(ctx, items.length);
    return { handled: true };
}

async function handleConfirm(ctx, userState) {
    const service = getService(ctx);
    const actorCtx = buildActorCtx(ctx);
    const body = String(ctx.chats || "").trim();
    const action = normalizeAction(userState.action);

    // Pesan tanpa teks (mis. admin mengirim foto) bukan urusan kami — dan pada alur TOLAK jangan
    // sampai media kosong terbaca sebagai "alasan".
    if (!body) return { handled: false };

    if (isYes(body)) {
        clearState(ctx);
        if (action === "reject") await executeReject(ctx, service, actorCtx, userState.id, "");
        else if (action === "cancel") await executeCancel(ctx, service, actorCtx, userState.id, "");
        else await executeApprove(ctx, service, actorCtx, userState.id);
        return { handled: true };
    }

    // Kata kunci eksplisit boleh mengganti aksi di tengah jalan (mis. buka prompt setujui lalu sadar
    // teknisi salah input → ketik "batalkan").
    const reject = body.match(BARE_REJECT);
    if (reject) {
        clearState(ctx);
        await executeReject(ctx, service, actorCtx, userState.id, (reject[1] || "").trim());
        return { handled: true };
    }

    const cancel = body.match(BARE_CANCEL);
    if (cancel) {
        clearState(ctx);
        await executeCancel(ctx, service, actorCtx, userState.id, (cancel[1] || "").trim());
        return { handled: true };
    }

    if (BARE_CONFIRM.test(body)) {
        clearState(ctx);
        await executeApprove(ctx, service, actorCtx, userState.id);
        return { handled: true };
    }

    // Pada alur TOLAK, teks bebas = alasan (kita memang menyuruh "ketik alasannya langsung").
    // Perintah global tetap diprioritaskan supaya admin bisa kabur dari alur.
    if (action === "reject" && !ctx.isGlobalCommand) {
        clearState(ctx);
        await executeReject(ctx, service, actorCtx, userState.id, body);
        return { handled: true };
    }

    if (ctx.isGlobalCommand) return { handled: false };
    await replyNeedYes(ctx);
    return { handled: true };
}

/**
 * Router state PKGREQ_*. NEVER-THROW.
 */
async function handlePackageRequestAdminState(ctx) {
    const userState = ctx.userState || (ctx.getUserState && ctx.getUserState(ctx.stateSender));
    const step = (userState && userState.step) || ctx.stateStep;
    try {
        // Gate ulang tiap langkah — state hanya milik admin; kalau peran berubah, hentikan senyap.
        if (!isAdminActor(ctx)) return { handled: false };
        if (step === STEP_SELECT) return await handleSelect(ctx, userState || {});
        if (step === STEP_CONFIRM) return await handleConfirm(ctx, userState || {});
        return { handled: false };
    } catch (err) {
        console.warn(`[PKGREQ_STATE] gagal: ${err && err.message ? err.message : err}`);
        try {
            clearState(ctx);
            await ctx.reply(renderResponseTemplate(
                "package_request_admin_error",
                "⚠️ Gagal memproses request *${kode}*: ${pesan}.\nRequest tetap menunggu — coba lagi atau proses lewat panel admin.",
                { kode: (userState && userState.id) || "-", pesan: (err && err.message) || "kesalahan sistem" }
            ), { skipDuplicateCheck: true });
        } catch (_e) { /* balasan best-effort */ }
        return { handled: true };
    }
}

module.exports = { handlePackageRequestAdminState, STEP_SELECT, STEP_CONFIRM };
