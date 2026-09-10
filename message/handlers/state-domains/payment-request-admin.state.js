/**
 * Header Doc
 * Purpose: State domain `PAYREQ_*` — lanjutan percakapan otorisasi pembayaran teknisi/agen via WA
 *   (BAGIAN 2). `PAYREQ_SELECT`: daftar bernomor sudah tampil, menunggu `setujui N` / `tolak N <alasan>`
 *   / angka polos (→ setujui N). `PAYREQ_CONFIRM_ALL`: borongan "setujui semua", menunggu satu `ya`
 *   untuk menyetujui seluruh antrian tanpa batas. Gate peran diulang tiap langkah. Perintah global
 *   dilepas (handled:false) agar admin bisa keluar. NEVER-THROW.
 * Caller: message/handlers/conversation-state-router.js (owner "payment-request", prefix `PAYREQ_`).
 * Deps: ../payment-request-admin-handler (approveOne/rejectOne/approveAll/gate + resolveIndex), lib/response-template-helper.
 * MainFuncs: handlePaymentRequestAdminState.
 * SideEffects: Lewat handler → service (ledger + MikroTik + notif) + requests.json; tulis/hapus state; balas admin.
 */
"use strict";

const {
    STEP_SELECT,
    STEP_CONFIRM_ALL,
    isAdminActor,
    approveOne,
    rejectOne,
    approveAll,
    loadPending
} = require("../payment-request-admin-handler");

const YES = /^(?:ya|y|iya|ok|oke|yes|lanjut|gas|betul|benar|sip)\s*$/i;
const PICK_CONFIRM = /^(?:setujui|approve|acc|terima|ok|oke|lunas|konfirmasi)\s+(\d{1,3})\s*$/i;
const PICK_REJECT = /^(?:tolak|reject)\s+(\d{1,3})(?:\s+(.*))?$/i;
const PICK_NUMBER = /^(\d{1,3})$/;

function clearState(ctx) {
    if (typeof ctx.deleteUserState === "function" && ctx.stateSender) ctx.deleteUserState(ctx.stateSender);
}

function resolveFromSnapshot(ctx, index, items) {
    const list = Array.isArray(items) && items.length ? items : loadPending(ctx);
    if (!Number.isInteger(index) || index < 1 || index > list.length) return null;
    return list[index - 1].id;
}

async function handleSelect(ctx, userState) {
    const body = String(ctx.chats || "").trim();
    if (!body) return { handled: false };
    const items = userState.items || [];

    let m = body.match(PICK_CONFIRM);
    if (m) {
        const id = resolveFromSnapshot(ctx, parseInt(m[1], 10), items);
        if (!id) { await ctx.reply(`Pilihan tidak valid. Balas angka 1–${items.length}.`, { skipDuplicateCheck: true }); return { handled: true }; }
        clearState(ctx);
        await approveOne(ctx, id);
        return { handled: true };
    }
    m = body.match(PICK_REJECT);
    if (m) {
        const id = resolveFromSnapshot(ctx, parseInt(m[1], 10), items);
        if (!id) { await ctx.reply(`Pilihan tidak valid. Balas angka 1–${items.length}.`, { skipDuplicateCheck: true }); return { handled: true }; }
        clearState(ctx);
        await rejectOne(ctx, id, (m[2] || "").trim());
        return { handled: true };
    }
    m = body.match(PICK_NUMBER);
    if (m) {
        const id = resolveFromSnapshot(ctx, parseInt(m[1], 10), items);
        if (!id) { await ctx.reply(`Pilihan tidak valid. Balas angka 1–${items.length}.`, { skipDuplicateCheck: true }); return { handled: true }; }
        clearState(ctx);
        await approveOne(ctx, id);
        return { handled: true };
    }
    if (ctx.isGlobalCommand) return { handled: false };
    await ctx.reply(`Balas *setujui <no>* / *tolak <no> <alasan>*, atau angka untuk menyetujui. (1–${items.length})`, { skipDuplicateCheck: true });
    return { handled: true };
}

async function handleConfirmAll(ctx) {
    const body = String(ctx.chats || "").trim();
    if (!body) return { handled: false };
    if (YES.test(body)) {
        clearState(ctx);
        await approveAll(ctx);
        return { handled: true };
    }
    if (ctx.isGlobalCommand) return { handled: false };
    await ctx.reply("Balas *ya* untuk menyetujui SEMUA, atau *batal*.", { skipDuplicateCheck: true });
    return { handled: true };
}

async function handlePaymentRequestAdminState(ctx) {
    const userState = ctx.userState || (ctx.getUserState && ctx.getUserState(ctx.stateSender));
    const step = (userState && userState.step) || ctx.stateStep;
    try {
        if (!isAdminActor(ctx)) return { handled: false };
        if (step === STEP_SELECT) return await handleSelect(ctx, userState || {});
        if (step === STEP_CONFIRM_ALL) return await handleConfirmAll(ctx);
        return { handled: false };
    } catch (err) {
        console.warn(`[PAYREQ_STATE] gagal: ${err && err.message ? err.message : err}`);
        try { clearState(ctx); await ctx.reply("⚠️ Gagal memproses otorisasi. Coba lagi atau buka panel admin.", { skipDuplicateCheck: true }); } catch (_e) { /* best-effort */ }
        return { handled: true };
    }
}

module.exports = { handlePaymentRequestAdminState, STEP_SELECT, STEP_CONFIRM_ALL };
