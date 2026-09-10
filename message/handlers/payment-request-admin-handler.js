/**
 * Header Doc
 * Purpose: OTORISASI PEMBAYARAN via WhatsApp (BAGIAN 2) — admin menyetujui/menolak PENGAJUAN pembayaran
 *   teknisi/agen (database/requests.json, BELUM BAYAR→SUDAH BAYAR) langsung dari WA, tanpa buka panel.
 *   Setara halaman /pembayaran/otorisasi: satu-per-satu ATAU batch SEMUA tanpa batas 20. Bentuk perintah:
 *     (1) daftar: `otorisasi` / `pengajuan bayar` → antrian bernomor + snapshot state (PAYREQ_SELECT);
 *     (2) kode: `setujui RPQ-<id>` / `tolak RPQ-<id> <alasan>` (RPQ-<id> = token di notif pengajuan);
 *     (3) nomor: `setujui 1` / `tolak 2 <alasan>` (dari daftar);
 *     (4) balasan ter-quote pada notif pengajuan (RPQ-<id> dibaca dari teks quoted);
 *     (5) borongan: `setujui semua` → penegasan `ya` (PAYREQ_CONFIRM_ALL) → job latar / loop tanpa batas.
 *   Eksekutor = services/payment-approval.service.bulkApproveRequests (idempoten, fail-closed, plafon sisa)
 *   + services/bulk-approval-job.service (batch besar). Gate admin/owner/superadmin SESUDAH parsing
 *   (non-admin jatuh senyap). GATED config.paymentRequestWa.enabled. NEVER-THROW.
 * Caller: message/raf.js (hook teks staf pre-intent); state-domains/payment-request-admin.state.js.
 * Deps: ./payment-proof-admin-handler (extractQuotedText/resolve gate reuse), lib/database (loadJSON/saveJSON),
 *   lib/payment-finance-service (getEffectivePrice/normalizePaymentRequestScope), services/payment-approval.service,
 *   services/bulk-approval-job.service, lib/response-template-helper, lib/approval-logic (notif teknisi tolak — opsional).
 * MainFuncs: handlePaymentRequestAdminDecision, parsePayreqCommand, listPending, approveOne, rejectOne,
 *   approveAll, replyPendingList, promptConfirmAll, STEP_SELECT, STEP_CONFIRM_ALL.
 * SideEffects: Lewat service — tulis ledger + reaktivasi MikroTik + notif teknisi + requests.json; balas admin via reply.
 */
"use strict";

const { renderResponseTemplate } = require("../../lib/response-template-helper");
const { extractQuotedText } = require("./payment-proof-admin-handler");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];
const STEP_SELECT = "PAYREQ_SELECT";
const STEP_CONFIRM_ALL = "PAYREQ_CONFIRM_ALL";

// Token pengajuan bayar di notif = RPQ-<id numerik> (di-inject di routes/requests.js). Self-identifying
// supaya quote-reply tak bentrok dgn nomor antrian.
const CODE = "RPQ-\\d+";
const CODE_ANYWHERE = new RegExp(CODE, "i");
const CONFIRM_WORDS = "setujui|approve|acc|terima|ok|oke|lunas|konfirmasi";
const REJECT_WORDS = "tolak|reject|ditolak";
const YES_WORDS = ["ya", "y", "iya", "ok", "oke", "yes", "lanjut", "gas", "betul", "benar", "sip"];

const CMD_LIST = /^(?:otorisasi|pengajuan bayar|pengajuan pembayaran|daftar pengajuan|antrian bayar|antrean bayar)$/i;
const CMD_CONFIRM_ALL = new RegExp(`^(?:${CONFIRM_WORDS})\\s+(?:semua|semuanya|all)\\s*$`, "i");
const CMD_CONFIRM_CODE = new RegExp(`^(?:${CONFIRM_WORDS})\\s+(${CODE})\\s*$`, "i");
const CMD_REJECT_CODE = new RegExp(`^(?:${REJECT_WORDS})\\s+(${CODE})\\s*(.*)$`, "i");
const CMD_CONFIRM_NUM = new RegExp(`^(?:${CONFIRM_WORDS})\\s+(\\d{1,3})\\s*$`, "i");
const CMD_REJECT_NUM = new RegExp(`^(?:${REJECT_WORDS})\\s+(\\d{1,3})(?:\\s+(.*))?$`, "i");
const CMD_BARE_CONFIRM = new RegExp(`^(?:${CONFIRM_WORDS})\\s*$`, "i");
const CMD_QUOTED_REJECT = new RegExp(`^(?:${REJECT_WORDS})\\s*(.*)$`, "i");

function isYes(text) { return YES_WORDS.includes(String(text || "").toLowerCase().trim()); }
function idFromCode(code) { const m = String(code || "").match(/RPQ-(\d+)/i); return m ? m[1] : null; }
function formatRupiah(v) { return `Rp ${Number(v || 0).toLocaleString("id-ID")}`; }
function padPeriod(m, y) { return `${String(m).padStart(2, "0")}/${y}`; }

/**
 * Kenali perintah otorisasi bayar. Murni.
 * @returns {{action:'approve'|'reject'|'list'|'approve_all', id?:string, index?:number, reason?:string}|null}
 */
function parsePayreqCommand(text, quotedText = "") {
    const body = String(text || "").trim();
    if (!body) return null;

    if (CMD_LIST.test(body)) return { action: "list" };
    if (CMD_CONFIRM_ALL.test(body)) return { action: "approve_all" };

    let m = body.match(CMD_CONFIRM_CODE);
    if (m) return { action: "approve", id: idFromCode(m[1]) };
    m = body.match(CMD_REJECT_CODE);
    if (m) return { action: "reject", id: idFromCode(m[1]), reason: (m[2] || "").trim() };
    m = body.match(CMD_CONFIRM_NUM);
    if (m) return { action: "approve", index: parseInt(m[1], 10) };
    m = body.match(CMD_REJECT_NUM);
    if (m) return { action: "reject", index: parseInt(m[1], 10), reason: (m[2] || "").trim() };

    // Balasan ter-quote pada notif pengajuan (RPQ-<id> di teks quoted) → sasaran pasti.
    const quotedCode = String(quotedText || "").match(CODE_ANYWHERE);
    if (quotedCode) {
        const id = idFromCode(quotedCode[0]);
        const rj = body.match(CMD_QUOTED_REJECT);
        if (rj && new RegExp(`^(?:${REJECT_WORDS})`, "i").test(body)) return { action: "reject", id, reason: (rj[1] || "").trim() };
        if (CMD_BARE_CONFIRM.test(body)) return { action: "approve", id };
        return null;
    }
    return null;
}

// ── Store & gate ──
function loadPending(ctx) {
    const { loadJSON } = ctx.db || require("../../lib/database");
    const { normalizePaymentRequestScope } = require("../../lib/payment-finance-service");
    const all = (loadJSON("database/requests.json") || []).map(normalizePaymentRequestScope);
    return all.filter((r) => r && r.status === "pending");
}

function resolveRole(ctx) {
    if (typeof ctx.resolveStaffRole === "function") return ctx.resolveStaffRole(ctx);
    const { resolveStaffRole } = require("./state-domains/wan-switch.state");
    const accounts = ctx.accounts || (ctx.global && ctx.global.accounts);
    return resolveStaffRole({ ...ctx, global: { accounts } });
}
function isAdminActor(ctx) { return ADMIN_ROLES.includes(String(resolveRole(ctx) || "").toLowerCase()); }
function adminActor(ctx) {
    const role = String(resolveRole(ctx) || "admin");
    return { username: ctx.pushname || role, id: null, role };
}

function getApprovalService(ctx) {
    return ctx.approvalService || require("../../services/payment-approval.service").createPaymentApprovalService();
}
function getJobService(ctx) {
    return ctx.jobService || require("../../services/bulk-approval-job.service");
}

function amountOf(r) {
    if (Number(r.amount_due) > 0) return Number(r.amount_due);
    try {
        const { getEffectivePrice } = require("../../lib/payment-finance-service");
        const user = (global.users || []).find((u) => String(u.id) === String(r.userId));
        return user ? getEffectivePrice(user) : 0;
    } catch (_e) { return 0; }
}

function buildListBody(items) {
    return items.map((r, i) => [
        `*${i + 1}.* ${r.userName || "-"}`,
        `   ${r.newStatus ? "→ SUDAH BAYAR" : "→ BELUM BAYAR"} • ${padPeriod(r.period_month, r.period_year)} • ${formatRupiah(amountOf(r))}`,
        `   Kode: RPQ-${r.id}`
    ].join("\n")).join("\n\n");
}

async function replyPendingList(ctx, items) {
    if (typeof ctx.setUserState === "function" && ctx.stateSender) {
        ctx.setUserState(ctx.stateSender, { step: STEP_SELECT, items: items.map((r) => ({ id: r.id, userName: r.userName })) });
    }
    return ctx.reply(renderResponseTemplate(
        "payment_request_admin_list",
        "🧾 *ANTRIAN OTORISASI BAYAR* (${total})\n\n${daftar}\n\nBalas: *setujui 1* / *tolak 2 <alasan>* / *setujui semua*.",
        { total: items.length, daftar: buildListBody(items) }
    ), { skipDuplicateCheck: true });
}

function replyEmpty(ctx) {
    return ctx.reply(renderResponseTemplate(
        "payment_request_admin_empty",
        "🧾 Tidak ada pengajuan pembayaran yang menunggu otorisasi. Bersih! ✅"
    ), { skipDuplicateCheck: true });
}

// ── Eksekusi ──
async function approveOne(ctx, id) {
    const service = getApprovalService(ctx);
    const out = await service.bulkApproveRequests({ requestIds: [id], actor: adminActor(ctx) });
    const r = (out && out.results) || {};
    if ((r.approved || []).length) {
        const sisa = loadPending(ctx).length;
        const nama = r.approved[0].userName || "-";
        return ctx.reply(renderResponseTemplate(
            "payment_request_admin_approve_ok",
            "✅ Pengajuan *RPQ-${id}* (${nama}) disetujui & tercatat LUNAS.\nStruk dikirim ke pelanggan.\n\nSisa antrian: ${sisa}.",
            { id, nama, sisa }
        ), { skipDuplicateCheck: true });
    }
    const reason = (r.failed || [])[0]?.reason || (r.notFound || []).length ? "pengajuan tidak ditemukan / sudah diproses" : "tidak ada perubahan";
    return ctx.reply(renderResponseTemplate(
        "payment_request_admin_approve_fail",
        "⚠️ Gagal menyetujui *RPQ-${id}*: ${reason}.",
        { id, reason }
    ), { skipDuplicateCheck: true });
}

async function rejectOne(ctx, id, reason) {
    // Tolak = tidak ada perubahan uang; set status 'rejected'. withLock per-request (anti balapan web).
    const { loadJSON, saveJSON } = ctx.db || require("../../lib/database");
    const { withLock } = require("../../lib/request-lock");
    const { normalizePaymentRequestScope } = require("../../lib/payment-finance-service");
    return withLock(`request-${id}`, async () => {
        const all = (loadJSON("database/requests.json") || []).map(normalizePaymentRequestScope);
        const idx = all.findIndex((r) => String(r.id) === String(id) && r.status === "pending");
        if (idx === -1) {
            return ctx.reply(renderResponseTemplate(
                "payment_request_admin_not_found",
                "❌ Pengajuan *RPQ-${id}* tidak ditemukan / sudah diproses.",
                { id }
            ), { skipDuplicateCheck: true });
        }
        all[idx] = { ...all[idx], status: "rejected", updated_at: new Date().toISOString(), updated_by: adminActor(ctx).username, reject_reason: reason || "" };
        saveJSON("database/requests.json", all);
        const sisa = all.filter((r) => r.status === "pending").length;
        return ctx.reply(renderResponseTemplate(
            "payment_request_admin_reject_ok",
            "🚫 Pengajuan *RPQ-${id}* (${nama}) DITOLAK.${alasan}\n\nSisa antrian: ${sisa}.",
            { id, nama: all[idx].userName || "-", alasan: reason ? `\nAlasan: ${reason}` : "", sisa }
        ), { skipDuplicateCheck: true });
    });
}

async function promptConfirmAll(ctx, items) {
    if (typeof ctx.setUserState === "function" && ctx.stateSender) {
        ctx.setUserState(ctx.stateSender, { step: STEP_CONFIRM_ALL });
    }
    return ctx.reply(renderResponseTemplate(
        "payment_request_admin_confirm_all_prompt",
        "💰 *Setujui SEMUA pengajuan* (${total})\n\n${daftar}\n\nBalas *ya* untuk menyetujui semuanya (tanpa batas), atau *batal*.",
        { total: items.length, daftar: buildListBody(items) }
    ), { skipDuplicateCheck: true });
}

/**
 * Borongan tanpa batas. Bila job latar aktif → antre (hasil menyusul di log + notif WA gagal).
 * Bila tidak → loop bulkApproveRequests (chunk 20) sampai habis (idempoten; aman thd restart).
 */
async function approveAll(ctx) {
    const items = loadPending(ctx);
    if (!items.length) return replyEmpty(ctx);
    const actor = adminActor(ctx);
    const ids = items.map((r) => r.id);
    const jobService = getJobService(ctx);

    if (typeof jobService.aktif === "function" && jobService.aktif()) {
        const antre = await jobService.enqueueBulkApproval({ requestIds: ids, actor });
        if (!antre.ok) {
            const msg = antre.reason === "sedang_berjalan" ? "Masih ada proses otorisasi berjalan. Tunggu selesai." : "Tak ada pengajuan yang bisa diproses.";
            return ctx.reply(msg, { skipDuplicateCheck: true });
        }
        return ctx.reply(renderResponseTemplate(
            "payment_request_admin_batch_queued",
            "⏳ ${antre} pengajuan diproses di latar (tanpa batas). Hasil menyusul; yang GAGAL akan diberitahukan ke admin lewat WA.",
            { antre: antre.antre }
        ), { skipDuplicateCheck: true });
    }

    // Fallback sinkron: loop chunk 20 sampai remaining habis (cap keamanan 500).
    const service = getApprovalService(ctx);
    let approved = 0, failed = 0, guard = 0;
    let remainingIds = ids;
    while (remainingIds.length && guard < 25) {
        guard += 1;
        const out = await service.bulkApproveRequests({ requestIds: remainingIds, actor });
        const r = (out && out.results) || {};
        approved += (r.approved || []).length;
        failed += (r.failed || []).length;
        remainingIds = loadPending(ctx).map((x) => x.id); // sisa pending yang masih ada
        if ((r.approved || []).length === 0 && (r.failed || []).length === 0 && (r.notFound || []).length === 0) break;
    }
    return ctx.reply(renderResponseTemplate(
        "payment_request_admin_batch_done",
        "💰 *Otorisasi borongan selesai*\n✅ ${approved} disetujui${failedLine}\nSisa antrian: ${sisa}.",
        { approved, failedLine: failed ? ` • ⚠️ ${failed} gagal` : "", sisa: loadPending(ctx).length }
    ), { skipDuplicateCheck: true });
}

/** Nomor antrian → id (snapshot state bila ada, else daftar segar). */
function resolveIndex(ctx, index, snapshot) {
    const list = Array.isArray(snapshot) && snapshot.length ? snapshot : loadPending(ctx);
    if (!Number.isInteger(index) || index < 1 || index > list.length) return null;
    return list[index - 1].id;
}

/**
 * Hook utama (pesan TANPA state aktif). Selalu {handled}. NEVER-THROW.
 * @returns {Promise<{handled:boolean}>}
 */
async function handlePaymentRequestAdminDecision(ctx) {
    try {
        const command = parsePayreqCommand(ctx.chats, extractQuotedText(ctx.msg));
        if (!command) return { handled: false };
        if (!isAdminActor(ctx)) return { handled: false }; // gate sesudah parse (fitur tak bocor)

        if (command.action === "list") {
            const items = loadPending(ctx);
            if (!items.length) { await replyEmpty(ctx); return { handled: true }; }
            await replyPendingList(ctx, items);
            return { handled: true };
        }
        if (command.action === "approve_all") {
            const items = loadPending(ctx);
            if (!items.length) { await replyEmpty(ctx); return { handled: true }; }
            await promptConfirmAll(ctx, items);
            return { handled: true };
        }
        if (command.id) {
            if (command.action === "reject") await rejectOne(ctx, command.id, command.reason);
            else await approveOne(ctx, command.id);
            return { handled: true };
        }
        if (command.index) {
            const id = resolveIndex(ctx, command.index);
            if (!id) {
                const pend = loadPending(ctx);
                if (!pend.length) await replyEmpty(ctx);
                else await ctx.reply(`Pilihan tidak valid. Balas angka 1–${pend.length}.`, { skipDuplicateCheck: true });
                return { handled: true };
            }
            if (command.action === "reject") await rejectOne(ctx, id, command.reason);
            else await approveOne(ctx, id);
            return { handled: true };
        }
        // Perintah polos (setujui/tolak tanpa sasaran) → tawarkan daftar bila ada; kosong = lepaskan.
        const pend = loadPending(ctx);
        if (!pend.length) return { handled: false };
        await replyPendingList(ctx, pend);
        return { handled: true };
    } catch (err) {
        console.error("[PAYMENT_REQUEST_ADMIN_ERROR]", err && err.message ? err.message : err);
        try { await ctx.reply("⚠️ Gagal memproses otorisasi. Coba lagi atau buka panel admin.", { skipDuplicateCheck: true }); } catch (_e) { /* best-effort */ }
        return { handled: true };
    }
}

module.exports = {
    handlePaymentRequestAdminDecision,
    parsePayreqCommand,
    loadPending,
    approveOne,
    rejectOne,
    approveAll,
    promptConfirmAll,
    replyPendingList,
    replyEmpty,
    resolveIndex,
    isAdminActor,
    adminActor,
    isYes,
    STEP_SELECT,
    STEP_CONFIRM_ALL
};
