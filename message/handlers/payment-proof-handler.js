/**
 * Header Doc
 * Purpose: Jembatan bot untuk menangkap FOTO/DOKUMEN bukti pembayaran pelanggan yang dikirim TANPA
 *   percakapan aktif (jalur yang dulu dibuang di guard chats-kosong `message/raf.js`). Mengunduh
 *   media lalu mendelegasikan ke payment-proof.service (simpan bukti + notif admin) dan membalas
 *   pelanggan lewat helper `reply` yang diinjeksi. TIDAK menyentuh runtime WA/socket mentah langsung.
 * Caller: message/raf.js (hook standalone media, sesudah routing state, sebelum drop chats kosong).
 * Deps: services/payment-proof.service (singleton), `downloadMedia` + `reply` diinjeksi pemanggil.
 * MainFuncs: handleIncomingPaymentProof.
 * SideEffects: Mengunduh media, memanggil service (tulis store/file + kirim WA admin), membalas pelanggan.
 */
"use strict";

const { getPaymentProofService } = require("../../services/payment-proof.service");

/**
 * @param {object} ctx
 * @param {object} ctx.msg - pesan Baileys mentah (untuk downloadMedia).
 * @param {object} ctx.user - record pelanggan terdaftar (canonicalContext.user).
 * @param {string} ctx.canonicalSender - JID kanonik pengirim (bukan @lid).
 * @param {string} ctx.pushname
 * @param {string} ctx.messageType - 'imageMessage' | 'documentMessage'.
 * @param {Function} ctx.reply - helper balas (mendukung { skipDuplicateCheck }).
 * @param {Function} ctx.downloadMedia - adapter unduh media.
 * @param {object} [ctx.service] - override service (untuk test).
 * @returns {Promise<{handled: boolean}>}
 */
async function handleIncomingPaymentProof({
    msg,
    user,
    canonicalSender,
    pushname,
    messageType,
    reply,
    downloadMedia,
    service
}) {
    try {
        if (!user) return { handled: false };

        const buffer = await downloadMedia(msg, "buffer", {});
        if (!buffer || !buffer.length) {
            return { handled: false };
        }

        const caption = (msg.message
            && msg.message[messageType]
            && msg.message[messageType].caption) || "";

        const svc = service || getPaymentProofService();
        const { ackText } = await svc.handleIncomingProof({
            user,
            canonicalSender,
            pushname,
            messageType,
            buffer,
            caption
        });

        if (ackText) {
            await reply(ackText, { skipDuplicateCheck: true });
        }
        return { handled: true };
    } catch (err) {
        console.error("[PAYMENT_PROOF_HANDLER_ERROR]", err.message);
        // Jangan biarkan foto pelanggan ditelan diam-diam — beri konfirmasi lembut.
        try {
            await reply(
                "Foto kamu sudah kami terima ✅. Admin akan segera mengeceknya ya 🙏",
                { skipDuplicateCheck: true }
            );
        } catch (_replyErr) {
            /* balasan best-effort — abaikan kegagalan */
        }
        return { handled: true };
    }
}

module.exports = { handleIncomingPaymentProof };
