/**
 * Header Doc
 * Purpose: State domain `PAYPROOF_*` — lanjutan percakapan admin saat mengonfirmasi/menolak/menghapus
 *   bukti pembayaran lewat WhatsApp. Tiga langkah: `PAYPROOF_SELECT` (antrian bernomor sudah ditampilkan,
 *   menunggu admin membalas angka / `terima 1` / `tolak 2 <alasan>` / `hapus 3`), `PAYPROOF_CONFIRM`
 *   (satu bukti terpilih, menunggu `ya`; pada aksi tolak, teks bebas dianggap sebagai ALASAN; aksi hapus
 *   membuang entri TANPA menyentuh pelanggan), dan `PAYPROOF_CONFIRM_ALL` (borongan "terima semua",
 *   menunggu satu `ya` untuk melunasi seluruh antrian yang masih punya tagihan). Penegasan `ya`
 *   menerima afirmasi alami ("ok mas", "sip") lewat isConsentYes (kecuali jalur tolak yang tetap
 *   cocok-persis agar teks alasannya tak tertelan). Kata kunci eksplisit (`tolak`/`hapus`/`terima`)
 *   boleh mengganti aksi di tengah jalan. Snapshot antrian disimpan di state supaya penomoran stabil
 *   walau ada bukti baru masuk di tengah jalan.
 *   Gate peran diulang tiap langkah (accounts.json). Perintah global (`menu`, `lapor`, …) SENGAJA
 *   dilepas (`handled:false`) agar admin tetap bisa keluar dari alur ini. NEVER-THROW.
 * Caller: message/handlers/conversation-state-router.js (owner "payment-proof", prefix `PAYPROOF_`).
 * Deps: ../payment-proof-admin-handler (eksekusi/daftar/prompt + gate peran), lib/response-template-helper.
 *   `reply` / `setUserState` / `deleteUserState` diinjeksi router (conversation-handler, key stateSender).
 * MainFuncs: handlePaymentProofAdminState.
 * SideEffects: Lewat service — menulis ledger pembayaran (lunas), reaktivasi MikroTik, kirim WA ke
 *   pelanggan. Menghapus/menulis conversation state. Balas admin lewat `reply`.
 */
"use strict";

const { renderResponseTemplate } = require("../../../lib/response-template-helper");
const {
    STEP_SELECT,
    STEP_CONFIRM,
    STEP_CONFIRM_ALL,
    CMD_LIST,
    getService,
    isAdminActor,
    adminNameOf,
    isYes,
    isConsentYes,
    executeConfirm,
    executeReject,
    executeDelete,
    executeConfirmAll,
    replyPendingList,
    promptDecision,
    resolvePendingByIndex
} = require("../payment-proof-admin-handler");

const CODE = "BP-\\d{6}-[A-Z0-9]{4}";
const PICK_NUMBER = /^(\d{1,2})$/;
const PICK_CONFIRM = new RegExp(`^(?:terima|konfirmasi|setuju|approve|acc|lunas)\\s+(\\d{1,2}|${CODE})\\s*$`, "i");
const PICK_REJECT = new RegExp(`^(?:tolak|reject)\\s+(\\d{1,2}|${CODE})(?:\\s+(.*))?$`, "i");
const PICK_DELETE = new RegExp(`^(?:hapus|delete)\\s+(\\d{1,2}|${CODE})(?:\\s+(.*))?$`, "i");
const BARE_REJECT = /^(?:tolak|reject)\s*(.*)$/i;
const BARE_DELETE = /^(?:hapus|delete)\s*(.*)$/i;
const BARE_CONFIRM = /^(?:terima|konfirmasi|setuju|lunas)\s*$/i;
const CODE_ONLY = new RegExp(`^${CODE}$`, "i");

/** Samakan aksi tersimpan ke salah satu dari confirm/reject/delete (default confirm). */
function normalizeAction(action) {
    if (action === "reject") return "reject";
    if (action === "delete") return "delete";
    return "confirm";
}

function clearState(ctx) {
    if (typeof ctx.deleteUserState === "function" && ctx.stateSender) ctx.deleteUserState(ctx.stateSender);
}

/** `1` → id lewat snapshot state; `BP-…` → apa adanya. null bila di luar jangkauan. */
function resolveToken(service, token, items) {
    const raw = String(token || "").trim();
    if (CODE_ONLY.test(raw)) return { id: raw.toUpperCase() };
    const index = parseInt(raw, 10);
    return resolvePendingByIndex(service, index, items);
}

function replyInvalidChoice(ctx, total) {
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_invalid_choice",
        "Pilihan tidak valid. Balas angka *1*–*${total}*, atau *batal*.",
        { total }
    ), { skipDuplicateCheck: true });
}

function replyNeedYes(ctx) {
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_need_yes",
        "Balas *ya* untuk lanjut, *tolak <alasan>* untuk menolak, atau *batal*."
    ), { skipDuplicateCheck: true });
}

async function handleSelect(ctx, userState) {
    const service = getService(ctx);
    const adminName = adminNameOf(ctx);
    const items = userState.items || [];
    const body = String(ctx.chats || "").trim();

    // Pesan tanpa teks (mis. admin mengirim foto) bukan urusan kami — jangan dibajak.
    if (!body) return { handled: false };

    // Muat ulang antrian.
    if (CMD_LIST.test(body)) {
        await replyPendingList(ctx, service, userState.action || "confirm");
        return { handled: true };
    }

    const confirmPick = body.match(PICK_CONFIRM);
    if (confirmPick) {
        const target = resolveToken(service, confirmPick[1], items);
        if (!target) { await replyInvalidChoice(ctx, items.length); return { handled: true }; }
        clearState(ctx);
        await executeConfirm(ctx, service, target.id, adminName);
        return { handled: true };
    }

    const rejectPick = body.match(PICK_REJECT);
    if (rejectPick) {
        const target = resolveToken(service, rejectPick[1], items);
        if (!target) { await replyInvalidChoice(ctx, items.length); return { handled: true }; }
        clearState(ctx);
        await executeReject(ctx, service, target.id, (rejectPick[2] || "").trim(), adminName);
        return { handled: true };
    }

    const deletePick = body.match(PICK_DELETE);
    if (deletePick) {
        const target = resolveToken(service, deletePick[1], items);
        if (!target) { await replyInvalidChoice(ctx, items.length); return { handled: true }; }
        clearState(ctx);
        await executeDelete(ctx, service, target.id, (deletePick[2] || "").trim(), adminName);
        return { handled: true };
    }

    // Angka polos → tegaskan dulu (`ya`), sesuai aksi yang membuka daftar ini.
    const picked = body.match(PICK_NUMBER);
    if (picked) {
        const target = resolvePendingByIndex(service, parseInt(picked[1], 10), items);
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
    const adminName = adminNameOf(ctx);
    const body = String(ctx.chats || "").trim();
    const action = normalizeAction(userState.action);

    // Pesan tanpa teks (mis. admin mengirim foto) bukan urusan kami — dan pada alur TOLAK jangan
    // sampai media kosong terbaca sebagai "alasan".
    if (!body) return { handled: false };

    // Afirmasi alami ("ok mas", "sip") hanya untuk confirm/delete. Pada alur TOLAK tetap cocok-persis
    // (isYes): kalau tidak, "ok nominal kurang" akan terbaca sebagai "ya, tolak tanpa alasan" dan
    // alasannya HILANG — padahal di alur tolak teks bebas memang dimaksud sebagai alasan.
    const isProceedYes = action === "reject" ? isYes(body) : isConsentYes(body);
    if (isProceedYes) {
        clearState(ctx);
        if (action === "reject") await executeReject(ctx, service, userState.id, "", adminName);
        else if (action === "delete") await executeDelete(ctx, service, userState.id, "", adminName);
        else await executeConfirm(ctx, service, userState.id, adminName);
        return { handled: true };
    }

    // Kata kunci eksplisit boleh mengganti aksi di tengah jalan (mis. buka prompt konfirmasi lalu
    // sadar ini keluhan → ketik "hapus").
    const reject = body.match(BARE_REJECT);
    if (reject) {
        clearState(ctx);
        await executeReject(ctx, service, userState.id, (reject[1] || "").trim(), adminName);
        return { handled: true };
    }

    const del = body.match(BARE_DELETE);
    if (del) {
        clearState(ctx);
        await executeDelete(ctx, service, userState.id, (del[1] || "").trim(), adminName);
        return { handled: true };
    }

    if (BARE_CONFIRM.test(body)) {
        clearState(ctx);
        await executeConfirm(ctx, service, userState.id, adminName);
        return { handled: true };
    }

    // Pada alur TOLAK, teks bebas = alasan (kita memang menyuruh "ketik alasannya langsung").
    // Perintah global tetap diprioritaskan supaya admin bisa kabur dari alur.
    if (action === "reject" && !ctx.isGlobalCommand) {
        clearState(ctx);
        await executeReject(ctx, service, userState.id, body, adminName);
        return { handled: true };
    }

    if (ctx.isGlobalCommand) return { handled: false };
    await replyNeedYes(ctx);
    return { handled: true };
}

/**
 * Penegasan borongan "terima semua": `ya` → lunasi seluruh antrian (executeConfirmAll, gerbang uang
 * per-bukti tetap berlaku). Bukan afirmasi → minta penegasan; perintah global tetap bisa kabur.
 */
async function handleConfirmAll(ctx) {
    const service = getService(ctx);
    const adminName = adminNameOf(ctx);
    const body = String(ctx.chats || "").trim();

    if (!body) return { handled: false };

    if (isConsentYes(body)) {
        clearState(ctx);
        await executeConfirmAll(ctx, service, adminName);
        return { handled: true };
    }

    if (ctx.isGlobalCommand) return { handled: false };
    await ctx.reply(renderResponseTemplate(
        "payment_proof_admin_need_yes",
        "Balas *ya* untuk lanjut, *tolak <alasan>* untuk menolak, atau *batal*."
    ), { skipDuplicateCheck: true });
    return { handled: true };
}

/**
 * Router state PAYPROOF_*. NEVER-THROW.
 */
async function handlePaymentProofAdminState(ctx) {
    const userState = ctx.userState || (ctx.getUserState && ctx.getUserState(ctx.stateSender));
    const step = (userState && userState.step) || ctx.stateStep;
    try {
        // Gate ulang tiap langkah — state hanya milik admin; kalau peran berubah, hentikan senyap.
        if (!isAdminActor(ctx)) return { handled: false };
        if (step === STEP_SELECT) return await handleSelect(ctx, userState || {});
        if (step === STEP_CONFIRM) return await handleConfirm(ctx, userState || {});
        if (step === STEP_CONFIRM_ALL) return await handleConfirmAll(ctx);
        return { handled: false };
    } catch (err) {
        console.warn(`[PAYPROOF_STATE] gagal: ${err && err.message ? err.message : err}`);
        try {
            clearState(ctx);
            await ctx.reply(renderResponseTemplate(
                "payment_proof_admin_error",
                "⚠️ Gagal memproses bukti *${kode}*: ${pesan}.\nBukti TETAP menunggu — coba lagi atau proses lewat portal admin.",
                { kode: (userState && userState.id) || "-", pesan: (err && err.message) || "kesalahan sistem" }
            ), { skipDuplicateCheck: true });
        } catch (_e) { /* balasan best-effort */ }
        return { handled: true };
    }
}

module.exports = { handlePaymentProofAdminState, STEP_SELECT, STEP_CONFIRM, STEP_CONFIRM_ALL };
