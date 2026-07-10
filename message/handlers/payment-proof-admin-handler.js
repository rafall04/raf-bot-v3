/**
 * Header Doc
 * Purpose: Jalur ADMIN menyetujui/menolak bukti pembayaran pelanggan LANGSUNG DARI WHATSAPP — tanpa
 *   harus membuka portal web. Dua bentuk perintah: (1) eksplisit berkode, `terima BP-YYMMDD-XXXX` /
 *   `tolak BP-YYMMDD-XXXX <alasan>` / `bukti` (daftar antrian); (2) BALASAN ter-quote pada notif bukti
 *   — cukup `ok` atau `tolak <alasan>`, kode diambil dari caption pesan yang dibalas. Gate peran PRESISI
 *   (admin/owner/superadmin dari accounts.json), bukan `isOwner` placeholder / `isTeknisi` longgar.
 *   Non-admin selalu `handled:false` (senyap, tak membocorkan fitur). NEVER-THROW.
 * Caller: message/raf.js (hook teks staf, sesudah routing state, sebelum resolusi intent).
 * Deps: services/payment-proof.service (confirmProof/rejectProof/listPending),
 *   ./state-domains/wan-switch.state (resolveStaffRole), lib/response-template-helper.
 * MainFuncs: handlePaymentProofAdminDecision, parseProofCommand, extractQuotedText.
 * SideEffects: Lewat service — menulis ledger pembayaran (lunas), reaktivasi MikroTik, kirim WA ke
 *   pelanggan (struk/penolakan). Balasan ke admin lewat `reply` yang diinjeksi.
 */
"use strict";

const { renderResponseTemplate } = require("../../lib/response-template-helper");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

// Format id bukti = BP-YYMMDD-XXXX (lib/id-generator.generatePaymentProofId).
const CODE = "BP-\\d{6}-[A-Z0-9]{4}";
const CODE_ANYWHERE = new RegExp(CODE, "i");

const CONFIRM_WORDS = "terima|konfirmasi|setuju|approve|acc|ok|oke|lunas";
const REJECT_WORDS = "tolak|reject|ditolak";

// Bentuk 1 — kode disebut eksplisit di teks.
const CMD_CONFIRM = new RegExp(`^(?:${CONFIRM_WORDS})\\s+(${CODE})\\s*$`, "i");
const CMD_REJECT = new RegExp(`^(?:${REJECT_WORDS})\\s+(${CODE})\\s*(.*)$`, "i");
const CMD_LIST = /^(?:bukti|bukti bayar|daftar bukti|antrian bukti|antrean bukti)$/i;

// Bentuk 2 — balasan ter-quote; kode diambil dari pesan yang dibalas.
const REPLY_CONFIRM = new RegExp(`^(?:${CONFIRM_WORDS})\\s*$`, "i");
const REPLY_REJECT = new RegExp(`^(?:${REJECT_WORDS})\\s*(.*)$`, "i");

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function padPeriod(month, year) {
    return `${String(month).padStart(2, "0")}/${year}`;
}

function formatSubmittedAt(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Teks pesan yang di-quote (caption gambar/dokumen atau teks biasa). "" bila bukan balasan.
 */
function extractQuotedText(msg) {
    const inner = (msg && msg.message) || {};
    for (const key of Object.keys(inner)) {
        const quoted = inner[key] && inner[key].contextInfo && inner[key].contextInfo.quotedMessage;
        if (!quoted) continue;
        return (quoted.imageMessage && quoted.imageMessage.caption)
            || (quoted.documentMessage && quoted.documentMessage.caption)
            || (quoted.extendedTextMessage && quoted.extendedTextMessage.text)
            || quoted.conversation
            || "";
    }
    return "";
}

/**
 * Kenali perintah bukti bayar dari teks (+ konteks quote). Murni, tanpa efek samping.
 * @returns {{action:'confirm'|'reject'|'list', code?:string, reason?:string}|null}
 */
function parseProofCommand(text, quotedText = "") {
    const body = String(text || "").trim();
    if (!body) return null;

    const confirm = body.match(CMD_CONFIRM);
    if (confirm) return { action: "confirm", code: confirm[1].toUpperCase() };

    const reject = body.match(CMD_REJECT);
    if (reject) return { action: "reject", code: reject[1].toUpperCase(), reason: (reject[2] || "").trim() };

    if (CMD_LIST.test(body)) return { action: "list" };

    // Balasan ter-quote: hanya sah bila pesan yang dibalas memuat kode bukti — jadi "ok" ke pesan
    // bot lain tidak akan pernah mengonfirmasi pembayaran secara tak sengaja.
    const quotedCode = String(quotedText || "").match(CODE_ANYWHERE);
    if (!quotedCode) return null;
    const code = quotedCode[0].toUpperCase();

    if (REPLY_CONFIRM.test(body)) return { action: "confirm", code };

    const replyReject = body.match(REPLY_REJECT);
    if (replyReject) return { action: "reject", code, reason: (replyReject[1] || "").trim() };

    return null;
}

function buildPendingListBody(items) {
    return items.map((r, i) => [
        `*${i + 1}.* ${r.userName} (${r.phone})`,
        `   Kode: *${r.id}*`,
        `   Tagihan ${padPeriod(r.periodMonth, r.periodYear)}: ${formatRupiah(r.amountDue)}`,
        `   Masuk: ${formatSubmittedAt(r.submittedAt)}`
    ].join("\n")).join("\n\n");
}

function describeReactivation(reactivation) {
    if (!reactivation || !reactivation.attempted) return "";
    return reactivation.ok
        ? "\n🔌 Pelanggan terisolir → sudah diaktifkan kembali."
        : "\n⚠️ Reaktivasi MikroTik GAGAL — cek profil PPPoE-nya manual ya.";
}

function resolveRole(ctx) {
    if (typeof ctx.resolveStaffRole === "function") return ctx.resolveStaffRole(ctx);
    const { resolveStaffRole } = require("./state-domains/wan-switch.state");
    // `accounts` disuntik pemanggil (raf.js me-resolve-nya dari runtime, tak selalu ada di global
    // scope yang dioper). Bila kosong, resolveStaffRole jatuh ke `global.accounts` seperti biasa.
    const accounts = ctx.accounts || (ctx.global && ctx.global.accounts);
    return resolveStaffRole({ ...ctx, global: { accounts } });
}

async function replyList(ctx, service) {
    const items = service.listPending();
    if (!items.length) {
        return ctx.reply(renderResponseTemplate(
            "payment_proof_admin_list_empty",
            "🧾 Tidak ada bukti pembayaran yang menunggu konfirmasi. Bersih! ✅"
        ), { skipDuplicateCheck: true });
    }
    const text = renderResponseTemplate(
        "payment_proof_admin_list",
        "🧾 *ANTRIAN BUKTI BAYAR* (${total})\n\n${daftar}\n\nBalas *terima <kode>* untuk mengonfirmasi, atau *tolak <kode> <alasan>*.",
        { total: items.length, daftar: buildPendingListBody(items) }
    );
    return ctx.reply(text, { skipDuplicateCheck: true });
}

function replyFailure(ctx, code, result) {
    if (result.reason === "not_found") {
        return ctx.reply(renderResponseTemplate(
            "payment_proof_admin_not_found",
            "❌ Bukti *${kode}* tidak ditemukan. Ketik *bukti* untuk melihat antrian.",
            { kode: code }
        ), { skipDuplicateCheck: true });
    }
    if (result.reason === "already_processed") {
        return ctx.reply(renderResponseTemplate(
            "payment_proof_admin_already_processed",
            "ℹ️ Bukti *${kode}* sudah diproses sebelumnya (status: ${status}).",
            { kode: code, status: result.status || "-" }
        ), { skipDuplicateCheck: true });
    }
    const pesan = result.reason === "user_not_found"
        ? "data pelanggan tidak ditemukan"
        : (result.error || "kesalahan sistem");
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_error",
        "⚠️ Gagal memproses bukti *${kode}*: ${pesan}.\nBukti TETAP menunggu — coba lagi atau proses lewat portal admin.",
        { kode: code, pesan }
    ), { skipDuplicateCheck: true });
}

async function replyConfirm(ctx, service, code, adminName) {
    const result = await service.confirmProof(code, { adminName });
    if (!result.ok) return replyFailure(ctx, code, result);

    const record = result.record || {};
    const periode = padPeriod(record.periodMonth, record.periodYear);

    if (result.alreadyPaid) {
        return ctx.reply(renderResponseTemplate(
            "payment_proof_admin_confirm_already_paid",
            "✅ Bukti *${kode}* ditandai terkonfirmasi.\n\nTagihan ${periode} milik ${nama} memang SUDAH tercatat lunas sebelumnya, jadi tidak ada struk ganda yang dikirim.",
            { kode: code, periode, nama: record.userName || "-" }
        ), { skipDuplicateCheck: true });
    }

    const sisa = service.listPending().length;
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_confirm_ok",
        "✅ *Pembayaran dikonfirmasi*\n\n${nama} — tagihan ${periode} ${jumlah} tercatat LUNAS.\nStruk sudah dikirim ke pelanggan.${reaktivasi}\n\nSisa antrian: ${sisa} bukti.",
        {
            nama: record.userName || "-",
            periode,
            jumlah: formatRupiah(record.amountDue),
            reaktivasi: describeReactivation(result.settlement && result.settlement.reactivation),
            sisa
        }
    ), { skipDuplicateCheck: true });
}

async function replyReject(ctx, service, code, reason, adminName) {
    const result = await service.rejectProof(code, { adminName, reason });
    if (!result.ok) return replyFailure(ctx, code, result);

    const record = result.record || {};
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_reject_ok",
        "🚫 Bukti *${kode}* dari ${nama} ditolak.\nAlasan: ${alasan}\n\nPelanggan sudah diberi tahu untuk mengirim ulang.",
        { kode: code, nama: record.userName || "-", alasan: reason || "-" }
    ), { skipDuplicateCheck: true });
}

/**
 * Hook utama. Selalu mengembalikan `{handled}` — tidak pernah melempar.
 *
 * @param {object} ctx
 * @param {string} ctx.chats - teks pesan masuk.
 * @param {object} ctx.msg - pesan Baileys mentah (untuk membaca quote).
 * @param {string} ctx.sender - JID pengirim apa adanya (bisa @lid; dipakai cocokkan accounts.lid).
 * @param {string} ctx.plainSenderNumber - nomor polos hasil resolusi kanonik.
 * @param {Array} ctx.accounts - accounts.json runtime (sumber peran staf).
 * @param {string} [ctx.pushname]
 * @param {Function} ctx.reply - helper balas (mendukung { skipDuplicateCheck }).
 * @param {object} [ctx.service] - override service (untuk test).
 * @param {Function} [ctx.resolveStaffRole] - override gate peran (untuk test).
 * @returns {Promise<{handled: boolean}>}
 */
async function handlePaymentProofAdminDecision(ctx) {
    try {
        const command = parseProofCommand(ctx.chats, extractQuotedText(ctx.msg));
        if (!command) return { handled: false };

        // Gate peran SESUDAH parsing: pelanggan yang kebetulan mengetik "ok" tak pernah sampai sini,
        // dan non-admin yang menebak formatnya jatuh senyap ke jalur intent biasa (fitur tak bocor).
        const role = String(resolveRole(ctx) || "").toLowerCase();
        if (!ADMIN_ROLES.includes(role)) return { handled: false };

        const service = ctx.service || require("../../services/payment-proof.service").getPaymentProofService();
        const adminName = ctx.pushname || role;

        if (command.action === "list") {
            await replyList(ctx, service);
        } else if (command.action === "confirm") {
            await replyConfirm(ctx, service, command.code, adminName);
        } else {
            await replyReject(ctx, service, command.code, command.reason, adminName);
        }
        return { handled: true };
    } catch (err) {
        console.error("[PAYMENT_PROOF_ADMIN_ERROR]", err && err.message ? err.message : err);
        // Sudah kadung mengklaim pesan ini — beri tahu admin, jangan diam.
        try {
            await ctx.reply(renderResponseTemplate(
                "payment_proof_admin_error",
                "⚠️ Gagal memproses bukti *${kode}*: ${pesan}.\nBukti TETAP menunggu — coba lagi atau proses lewat portal admin.",
                { kode: "-", pesan: (err && err.message) || "kesalahan sistem" }
            ), { skipDuplicateCheck: true });
        } catch (_replyErr) {
            /* balasan best-effort */
        }
        return { handled: true };
    }
}

module.exports = {
    handlePaymentProofAdminDecision,
    parseProofCommand,
    extractQuotedText
};
