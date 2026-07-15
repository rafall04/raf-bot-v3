/**
 * Header Doc
 * Purpose: Jembatan bot untuk FOTO/DOKUMEN pelanggan yang dikirim TANPA percakapan aktif (jalur yang
 *   dulu dibuang di guard chats-kosong `message/raf.js`). Tugasnya sekarang dua langkah, bukan satu:
 *     1) TANYA GERBANG dulu (`service.evaluateIntake`) — foto ini kandidat bukti bayar atau bukan?
 *     2) Baru bertindak: unduh media + simpan bukti HANYA bila keputusannya `capture`.
 *   Media sengaja TIDAK diunduh untuk keputusan non-capture (hemat + tak menyentuh apa pun).
 *
 *   Dulu handler ini menelan SEMUA foto pelanggan terdaftar lalu membalas "kalau ini bukti
 *   pembayaran, admin akan mengecek…" — bingkai yang menyesatkan ketika pelanggan sebenarnya sedang
 *   mengirim foto keluhan (insiden 14-07: koordinasi CCTV). Keputusannya kini bukan di sini, tapi di
 *   `lib/payment-proof-intake-policy` lewat service.
 * Caller: message/raf.js (hook standalone media, sesudah routing state, sebelum drop chats kosong).
 * Deps: services/payment-proof.service (singleton), lib/payment-proof-intake-policy (konstanta aksi),
 *   ./template-helpers (renderResponseTemplate), `downloadMedia` + `reply` diinjeksi pemanggil.
 * MainFuncs: handleIncomingPaymentProof.
 * SideEffects: Membaca snapshot tagihan (via service), mengunduh media & menyimpan bukti HANYA pada
 *   jalur `capture`, membalas pelanggan lewat `reply` yang diinjeksi. Tidak pernah throw.
 */
"use strict";

const { getPaymentProofService } = require("../../services/payment-proof.service");
const { ACTION } = require("../../lib/payment-proof-intake-policy");
const { renderResponseTemplate } = require("./template-helpers");

/**
 * @param {object} ctx
 * @param {object} ctx.msg - pesan Baileys mentah (untuk downloadMedia).
 * @param {object} ctx.user - record pelanggan terdaftar (canonicalContext.user).
 * @param {string} ctx.canonicalSender - JID kanonik pengirim (bukan @lid).
 * @param {string} ctx.pushname
 * @param {string} ctx.messageType - 'imageMessage' | 'documentMessage'.
 * @param {Function} ctx.reply - helper balas (mendukung { skipDuplicateCheck }).
 * @param {Function} ctx.downloadMedia - adapter unduh media.
 * @param {boolean} [ctx.adminActive] - admin sedang membalas manual di chat ini (jejak durabel).
 * @param {boolean} [ctx.signalReady] - jejak chat sudah pulih dari disk? false = bot buta → fail-closed.
 * @param {boolean} [ctx.recentComplaint] - pelanggan baru mengeluh koneksi (jejak durabel).
 * @param {object} [ctx.service] - override service (untuk test).
 * @returns {Promise<{handled: boolean, action?: string, reason?: string}>}
 */
async function handleIncomingPaymentProof({
    msg,
    user,
    canonicalSender,
    pushname,
    messageType,
    reply,
    downloadMedia,
    adminActive = false,
    signalReady = true,
    recentComplaint = false,
    service
}) {
    try {
        if (!user) return { handled: false };

        const caption = (msg
            && msg.message
            && msg.message[messageType]
            && msg.message[messageType].caption) || "";

        const svc = service || getPaymentProofService();

        const decision = await svc.evaluateIntake({
            user,
            caption,
            adminActive,
            signalReady,
            recentComplaint
        });

        // Admin sedang menangani chat ini → jangan bersuara & jangan menandai handled: biarkan pesan
        // jatuh persis seperti sebelum fitur ini ada (guard chats-kosong di raf.js yang membuangnya).
        if (decision.action === ACTION.SILENT) {
            console.log(`[PAYMENT_PROOF] Intake dilewati — ${decision.reason}.`);
            return { handled: false, action: decision.action, reason: decision.reason };
        }

        // Bukan kandidat bukti bayar: balas TANPA bingkai pembayaran, jangan simpan apa pun,
        // jangan ganggu admin. Pelanggan tetap dapat respons (bug lama "foto ditelan diam-diam"
        // tidak kembali), dan fotonya tetap terlihat admin di chat WhatsApp seperti biasa.
        if (decision.action !== ACTION.CAPTURE) {
            console.log(`[PAYMENT_PROOF] Foto TIDAK dianggap bukti bayar — ${decision.reason} (aksi: ${decision.action}).`);
            if (decision.ackText) {
                await reply(decision.ackText, { skipDuplicateCheck: true });
            }
            return { handled: true, action: decision.action, reason: decision.reason };
        }

        const buffer = await downloadMedia(msg, "buffer", {});
        if (!buffer || !buffer.length) {
            return { handled: false };
        }

        console.log(`[PAYMENT_PROOF] Foto ditangkap sebagai kandidat bukti bayar — ${decision.reason}.`);
        const { ackText } = await svc.handleIncomingProof({
            user,
            canonicalSender,
            pushname,
            messageType,
            buffer,
            caption,
            billing: decision.billing,
            intakeReason: decision.reason,
            advance: decision.advance
        });

        if (ackText) {
            await reply(ackText, { skipDuplicateCheck: true });
        }
        return { handled: true, action: decision.action, reason: decision.reason };
    } catch (err) {
        console.error("[PAYMENT_PROOF_HANDLER_ERROR]", err.message);
        // Jangan biarkan foto pelanggan ditelan diam-diam — beri konfirmasi lembut. Teks ini sengaja
        // NETRAL (tak menyebut pembayaran): saat gerbang gagal, kita tidak tahu ini foto apa.
        try {
            await reply(
                renderResponseTemplate(
                    "payment_proof_error_ack",
                    "Foto kamu sudah kami terima ✅. Admin akan segera mengeceknya ya 🙏",
                    {}
                ),
                { skipDuplicateCheck: true }
            );
        } catch (_replyErr) {
            /* balasan best-effort — abaikan kegagalan */
        }
        return { handled: true };
    }
}

module.exports = { handleIncomingPaymentProof };
