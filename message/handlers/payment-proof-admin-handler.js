/**
 * Header Doc
 * Purpose: Jalur ADMIN menyetujui/menolak bukti pembayaran pelanggan LANGSUNG DARI WHATSAPP — tanpa
 *   membuka portal web dan tanpa mengetik kode panjang. Bentuk perintah yang dikenali:
 *     (1) BALASAN ter-quote pada notif bukti → `ok` / `tolak <alasan>` (kode dibaca dari caption);
 *     (2) NOMOR antrian → `terima 1` / `tolak 2 <alasan>` (nomor dari perintah `bukti`);
 *     (3) KODE eksplisit → `terima BP-YYMMDD-XXXX` / `tolak BP-… <alasan>`;
 *     (4) POLOS → `ok` / `tolak` tanpa apa pun: bot menawarkan antrian (1 bukti → minta `ya`,
 *         banyak bukti → daftar bernomor). Bila antrian KOSONG, pesan dilepas (handled:false) supaya
 *         "ok" biasa dari admin tidak dibajak.
 *   Langkah `ya` dan pemilihan angka dilanjutkan oleh state domain `PAYPROOF_*`.
 *   Gate peran PRESISI (admin/owner/superadmin dari accounts.json). Non-admin → `handled:false`
 *   senyap (fitur tak bocor). NEVER-THROW.
 * Caller: message/raf.js (hook teks staf, sesudah routing state, sebelum resolusi intent);
 *   message/handlers/state-domains/payment-proof-admin.state.js (memakai helper eksekusi/daftar).
 * Deps: services/payment-proof.service (listPending/confirmProof/rejectProof),
 *   ./state-domains/wan-switch.state (resolveStaffRole), lib/response-template-helper,
 *   `setUserState` diinjeksi pemanggil (conversation-handler, key stateSender kanonik).
 * MainFuncs: handlePaymentProofAdminDecision, parseProofCommand, extractQuotedText, executeConfirm,
 *   executeReject, replyPendingList, promptDecision, resolvePendingByIndex, STEP_SELECT, STEP_CONFIRM.
 * SideEffects: Lewat service — menulis ledger pembayaran (lunas), reaktivasi MikroTik, kirim WA ke
 *   pelanggan (struk/penolakan). Balasan ke admin lewat `reply` yang diinjeksi; menulis conversation state.
 */
"use strict";

const { renderResponseTemplate } = require("../../lib/response-template-helper");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

const STEP_SELECT = "PAYPROOF_SELECT";
const STEP_CONFIRM = "PAYPROOF_CONFIRM";

// Format id bukti = BP-YYMMDD-XXXX (lib/id-generator.generatePaymentProofId).
const CODE = "BP-\\d{6}-[A-Z0-9]{4}";
const CODE_ANYWHERE = new RegExp(CODE, "i");

const CONFIRM_WORDS = "terima|konfirmasi|setuju|approve|acc|ok|oke|lunas";
const REJECT_WORDS = "tolak|reject|ditolak";
const YES_WORDS = ["ya", "y", "iya", "ok", "oke", "yes", "lanjut", "gas", "betul", "benar", "sip"];

const CMD_CONFIRM_CODE = new RegExp(`^(?:${CONFIRM_WORDS})\\s+(${CODE})\\s*$`, "i");
const CMD_REJECT_CODE = new RegExp(`^(?:${REJECT_WORDS})\\s+(${CODE})\\s*(.*)$`, "i");
const CMD_CONFIRM_NUM = new RegExp(`^(?:${CONFIRM_WORDS})\\s+(\\d{1,2})\\s*$`, "i");
const CMD_REJECT_NUM = new RegExp(`^(?:${REJECT_WORDS})\\s+(\\d{1,2})(?:\\s+(.*))?$`, "i");
const CMD_BARE_CONFIRM = new RegExp(`^(?:${CONFIRM_WORDS})\\s*$`, "i");
// Pada balasan ter-quote sasarannya sudah pasti, jadi teks di belakang = ALASAN.
const CMD_QUOTED_REJECT = new RegExp(`^(?:${REJECT_WORDS})\\s*(.*)$`, "i");
// Tanpa sasaran, "alasan" tak ada artinya — cocokkan PERSIS supaya "tolak angin" tetap lolos ke
// jalur intent biasa alih-alih dibaca sebagai perintah menolak bukti.
const CMD_BARE_REJECT = new RegExp(`^(?:${REJECT_WORDS})$`, "i");
const CMD_LIST = /^(?:bukti|bukti bayar|daftar bukti|antrian bukti|antrean bukti)$/i;

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

function isYes(text) {
    return YES_WORDS.includes(String(text || "").toLowerCase().trim());
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
 * @returns {{action:'confirm'|'reject'|'list', code?:string, index?:number, reason?:string}|null}
 */
function parseProofCommand(text, quotedText = "") {
    const body = String(text || "").trim();
    if (!body) return null;

    // 1) Kode eksplisit — paling tegas, dipakai lebih dulu.
    const confirmCode = body.match(CMD_CONFIRM_CODE);
    if (confirmCode) return { action: "confirm", code: confirmCode[1].toUpperCase() };

    const rejectCode = body.match(CMD_REJECT_CODE);
    if (rejectCode) return { action: "reject", code: rejectCode[1].toUpperCase(), reason: (rejectCode[2] || "").trim() };

    // 2) Nomor antrian.
    const confirmNum = body.match(CMD_CONFIRM_NUM);
    if (confirmNum) return { action: "confirm", index: parseInt(confirmNum[1], 10) };

    const rejectNum = body.match(CMD_REJECT_NUM);
    if (rejectNum) return { action: "reject", index: parseInt(rejectNum[1], 10), reason: (rejectNum[2] || "").trim() };

    if (CMD_LIST.test(body)) return { action: "list" };

    // 3) Balasan ter-quote: hanya sah bila pesan yang dibalas memuat kode bukti — jadi "ok" ke pesan
    // bot lain tidak akan pernah mengonfirmasi pembayaran secara tak sengaja.
    const quotedCode = String(quotedText || "").match(CODE_ANYWHERE);
    if (quotedCode) {
        const code = quotedCode[0].toUpperCase();
        if (CMD_BARE_CONFIRM.test(body)) return { action: "confirm", code };
        const replyReject = body.match(CMD_QUOTED_REJECT);
        if (replyReject) return { action: "reject", code, reason: (replyReject[1] || "").trim() };
        return null;
    }

    // 4) Polos, tanpa sasaran. Pemanggil yang memutuskan (antrian kosong → lepaskan pesannya).
    if (CMD_BARE_CONFIRM.test(body)) return { action: "confirm" };
    if (CMD_BARE_REJECT.test(body)) return { action: "reject", reason: "" };

    return null;
}

function buildPendingListBody(items) {
    return items.map((r, i) => [
        `*${i + 1}.* ${r.userName} (${r.phone})`,
        `   Tagihan ${padPeriod(r.periodMonth, r.periodYear)}: ${formatRupiah(r.amountDue)}`,
        `   Masuk: ${formatSubmittedAt(r.submittedAt)}`,
        `   Kode: ${r.id}`
    ].join("\n")).join("\n\n");
}

function describeReactivation(reactivation) {
    if (!reactivation || !reactivation.attempted) return "";
    return reactivation.ok
        ? "\n🔌 Pelanggan terisolir → sudah diaktifkan kembali."
        : "\n⚠️ Reaktivasi MikroTik GAGAL — cek profil PPPoE-nya manual ya.";
}

function getService(ctx) {
    return ctx.service || require("../../services/payment-proof.service").getPaymentProofService();
}

function resolveRole(ctx) {
    if (typeof ctx.resolveStaffRole === "function") return ctx.resolveStaffRole(ctx);
    const { resolveStaffRole } = require("./state-domains/wan-switch.state");
    // `accounts` disuntik pemanggil (raf.js me-resolve-nya dari runtime, tak selalu ada di global
    // scope yang dioper). Bila kosong, resolveStaffRole jatuh ke `global.accounts` seperti biasa.
    const accounts = ctx.accounts || (ctx.global && ctx.global.accounts);
    return resolveStaffRole({ ...ctx, global: { accounts } });
}

function isAdminActor(ctx) {
    return ADMIN_ROLES.includes(String(resolveRole(ctx) || "").toLowerCase());
}

function adminNameOf(ctx) {
    return ctx.pushname || String(resolveRole(ctx) || "admin");
}

function snapshotOf(record) {
    return {
        id: record.id,
        userName: record.userName,
        phone: record.phone,
        amountDue: record.amountDue,
        periodMonth: record.periodMonth,
        periodYear: record.periodYear,
        submittedAt: record.submittedAt
    };
}

/** Nomor antrian → record. `items` = snapshot state bila ada, else daftar segar. */
function resolvePendingByIndex(service, index, items = null) {
    const list = Array.isArray(items) && items.length ? items : service.listPending();
    if (!Number.isInteger(index) || index < 1 || index > list.length) return null;
    return list[index - 1];
}

// ── Balasan ──

function replyEmptyQueue(ctx) {
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_list_empty",
        "🧾 Tidak ada bukti pembayaran yang menunggu konfirmasi. Bersih! ✅"
    ), { skipDuplicateCheck: true });
}

/** Tampilkan antrian bernomor + simpan snapshot ke state supaya balasan angka polos bermakna. */
async function replyPendingList(ctx, service, action = "confirm") {
    const items = service.listPending();
    if (!items.length) return replyEmptyQueue(ctx);

    if (typeof ctx.setUserState === "function" && ctx.stateSender) {
        ctx.setUserState(ctx.stateSender, {
            step: STEP_SELECT,
            action,
            items: items.map(snapshotOf)
        });
    }

    const text = renderResponseTemplate(
        "payment_proof_admin_list",
        "🧾 *ANTRIAN BUKTI BAYAR* (${total})\n\n${daftar}\n\nBalas *angka* untuk memilih (mis. *1*), atau langsung *terima 1* / *tolak 2 <alasan>*.",
        { total: items.length, daftar: buildPendingListBody(items) }
    );
    return ctx.reply(text, { skipDuplicateCheck: true });
}

/** Minta penegasan `ya` untuk satu bukti (dipakai saat perintah polos / pilih nomor). */
async function promptDecision(ctx, record, action) {
    if (typeof ctx.setUserState === "function" && ctx.stateSender) {
        ctx.setUserState(ctx.stateSender, { step: STEP_CONFIRM, action, ...snapshotOf(record) });
    }
    const data = {
        nama: record.userName || "-",
        periode: padPeriod(record.periodMonth, record.periodYear),
        jumlah: formatRupiah(record.amountDue),
        kode: record.id
    };
    const text = action === "reject"
        ? renderResponseTemplate(
            "payment_proof_admin_reject_prompt",
            "🚫 *Tolak bukti*\n\n${nama} — tagihan ${periode} ${jumlah}\n\nBalas *ya* untuk menolak, atau ketik *alasannya* langsung (mis. nominal kurang).",
            data)
        : renderResponseTemplate(
            "payment_proof_admin_confirm_prompt",
            "💰 *Konfirmasi pembayaran*\n\n${nama}\nTagihan ${periode}: ${jumlah}\n\nBalas *ya* untuk tandai LUNAS, atau *tolak <alasan>*.",
            data);
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

// ── Eksekusi ──

async function executeConfirm(ctx, service, code, adminName) {
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

async function executeReject(ctx, service, code, reason, adminName) {
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
 * Hook utama (pesan TANPA state aktif). Selalu `{handled}` — tidak pernah melempar.
 *
 * @param {object} ctx
 * @param {string} ctx.chats - teks pesan masuk.
 * @param {object} ctx.msg - pesan Baileys mentah (untuk membaca quote).
 * @param {string} ctx.sender - JID pengirim apa adanya (bisa @lid; dipakai cocokkan accounts.lid).
 * @param {string} ctx.plainSenderNumber - nomor polos hasil resolusi kanonik.
 * @param {string} ctx.stateSender - JID KANONIK; key conversation state.
 * @param {Array} ctx.accounts - accounts.json runtime (sumber peran staf).
 * @param {string} [ctx.pushname]
 * @param {Function} ctx.reply - helper balas (mendukung { skipDuplicateCheck }).
 * @param {Function} ctx.setUserState - conversation-handler.setUserState.
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
        if (!isAdminActor(ctx)) return { handled: false };

        const service = getService(ctx);
        const adminName = adminNameOf(ctx);

        if (command.action === "list") {
            await replyPendingList(ctx, service, "confirm");
            return { handled: true };
        }

        // Sasaran eksplisit (kode / nomor) → langsung eksekusi.
        if (command.code) {
            if (command.action === "confirm") await executeConfirm(ctx, service, command.code, adminName);
            else await executeReject(ctx, service, command.code, command.reason, adminName);
            return { handled: true };
        }

        if (command.index) {
            const target = resolvePendingByIndex(service, command.index);
            if (!target) {
                const pending = service.listPending();
                if (!pending.length) await replyEmptyQueue(ctx);
                else await ctx.reply(renderResponseTemplate(
                    "payment_proof_admin_invalid_choice",
                    "Pilihan tidak valid. Balas angka *1*–*${total}*, atau *batal*.",
                    { total: pending.length }
                ), { skipDuplicateCheck: true });
                return { handled: true };
            }
            if (command.action === "confirm") await executeConfirm(ctx, service, target.id, adminName);
            else await executeReject(ctx, service, target.id, command.reason, adminName);
            return { handled: true };
        }

        // Perintah POLOS ("ok" / "tolak"). Antrian kosong → lepaskan pesannya: admin mungkin sedang
        // mengetik "ok" untuk hal lain, jangan dibajak.
        const pending = service.listPending();
        if (!pending.length) return { handled: false };

        if (pending.length === 1) {
            await promptDecision(ctx, pending[0], command.action);
        } else {
            await replyPendingList(ctx, service, command.action);
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
    extractQuotedText,
    // dipakai state domain PAYPROOF_*
    STEP_SELECT,
    STEP_CONFIRM,
    CMD_LIST,
    getService,
    isAdminActor,
    adminNameOf,
    isYes,
    executeConfirm,
    executeReject,
    replyPendingList,
    replyEmptyQueue,
    promptDecision,
    resolvePendingByIndex
};
