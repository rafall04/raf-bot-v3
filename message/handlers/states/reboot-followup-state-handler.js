/**
 * Header Doc
 * Purpose: Dua langkah percakapan alur reboot-berbantu: (1) `REBOOTFU_OFFER` meminta IZIN pelanggan
 *          sebelum modem dinyalakan ulang, (2) `REBOOTFU_ASK` menerima jawaban pelanggan setelah bot
 *          MEMBUKTIKAN modem kembali online. Jawaban dibaca dengan parser toleran-sapaan, bukan
 *          exact-match, karena korpus chat nyata memakai "Ok mas" / "Sudah stabil kk".
 * Caller: `message/handlers/conversation-state-handler.js` (case REBOOTFU_OFFER / REBOOTFU_ASK).
 * Deps: `../conversation-handler` (deleteUserState), `../template-helpers` (renderResponseTemplate),
 *       `../../../lib/reboot-followup-service`, `../../../lib/reboot-followup-store`,
 *       `../../../lib/affirmative-parser`.
 * MainFuncs: `handleRebootOffer`, `handleRebootFollowupAnswer`.
 * SideEffects: Memicu reboot GenieACS, menulis store follow-up, menghapus conversation state,
 *              mengirim balasan WhatsApp (via `reply` yang disuntikkan).
 */
"use strict";

const { deleteUserState } = require("../conversation-handler");
const { renderResponseTemplate } = require("../template-helpers");
const { isAffirmative, isCleanRebootConsent, isDecline, isResolvedAnswer, isUnresolvedAnswer } = require("../../../lib/affirmative-parser");

/**
 * Step REBOOTFU_OFFER — pelanggan menjawab tawaran "boleh saya nyalakan ulang modemnya?".
 * Keputusan produk: bot TIDAK PERNAH reboot tanpa izin, karena memutus koneksi seisi rumah.
 */
async function handleRebootOffer(userState, userReply, reply, sender) {
    const { executeRebootAndSchedule } = require("../../../lib/reboot-followup-service");

    // Reboot HANYA pada persetujuan BERSIH (isCleanRebootConsent) — bukan sekadar mengandung kata
    // afirmatif. Ini menutup akar "ketik siap malah reboot": pesan seperti "bisa cek tagihan?" atau
    // "siap kak makasih" kebetulan lolos isAffirmative lama, padahal BUKAN jawaban tawaran reboot.
    if (!isCleanRebootConsent(userReply)) {
        deleteUserState(sender);
        // Afirmasi ambigu (ada kata afirmatif tapi juga muatan lain) → jangan reboot, arahkan.
        if (!isDecline(userReply) && isAffirmative(userReply)) {
            return reply(
                renderResponseTemplate(
                    "rebootfu_offer_unclear",
                    "Baik Kak 🙏 Kalau memang mau modemnya saya *nyalakan ulang*, cukup balas *ya*. Untuk kebutuhan lain silakan ketik ulang atau *menu* ya."
                )
            );
        }
        return reply(
            renderResponseTemplate(
                "rebootfu_offer_declined",
                "Baik Kak, tidak jadi saya nyalakan ulang. Kalau nanti berubah pikiran, balas saja *cek koneksi* ya 🙏"
            )
        );
    }

    const user = userState.targetUser;
    if (!user || !user.device_id) {
        deleteUserState(sender);
        return reply(
            renderResponseTemplate("reboot_device_missing", "Maaf Kak, data perangkat Anda belum lengkap. Silakan hubungi admin.")
        );
    }

    // Hapus state SEBELUM eksekusi: kelanjutan percakapan dipegang store durabel, bukan state
    // 15 menit ini. Tanpa itu, `pm2 restart` di tengah reboot membuat pelanggan tergantung.
    deleteUserState(sender);

    const result = await executeRebootAndSchedule({
        user,
        jid: sender,
        reason: userState.reason || "cek_koneksi",
        remoteAddr: userState.remoteAddr || null
    });

    if (!result.ok) {
        return reply(
            renderResponseTemplate("other_reboot_failed", "Gagal mengirim perintah reboot.\n\n*Alasan:* ${reason}", {
                reason: result.message
            })
        );
    }

    return reply(
        renderResponseTemplate(
            "rebootfu_started",
            `Siap Kak, modemnya saya nyalakan ulang sekarang. Internet akan terputus sebentar.\n\n` +
                `*Saya cek lagi sekitar 6 menit lagi dan langsung kabari Kak* — tidak perlu membalas apa pun 🙏`,
            { nama: user.name || "Kak" }
        )
    );
}

/**
 * Step REBOOTFU_ASK — jawaban atas "sudah lancar?" yang dikirim SETELAH modem terbukti kembali.
 * "masih bermasalah" TIDAK langsung jadi tiket: jalankan diagnosa dalam dulu.
 */
async function handleRebootFollowupAnswer(userState, userReply, reply, sender) {
    const service = require("../../../lib/reboot-followup-service");
    const store = require("../../../lib/reboot-followup-store");

    const job = (userState.jobId && store.loadJobs().find((j) => j.id === userState.jobId)) || store.findJobByJid(sender);

    // "masih/belum/tetep" diperiksa DULU: "sudah tapi masih lemot" mengandung keduanya.
    if (isUnresolvedAnswer(userReply)) {
        deleteUserState(sender);
        if (!job) {
            return reply(
                renderResponseTemplate(
                    "rebootfu_deep_no_job",
                    "Baik Kak, saya catat masih bermasalah. Ketik *cek koneksi* untuk diagnosa ulang ya 🙏"
                )
            );
        }

        await reply(
            renderResponseTemplate("rebootfu_deep_check", "Baik Kak, saya periksa lebih dalam dulu ya, mohon tunggu sebentar... 🔎")
        );

        const { verdict, detail } = await service.runDeepCheck(job);

        if (verdict === "SEMUA_HIJAU") {
            service.closeJob(job.id, store.STATUS.ESCALATED);
            await service.notifyAdmins(
                `🔧 *Reboot selesai tapi pelanggan masih mengeluh*\nPelanggan: ${job.name || "-"} (${job.jid})\n` +
                    `Device: ${job.deviceId}\nDiagnosa: semua jalur normal → dugaan masalah di dalam rumah.`
            );
            return reply(
                renderResponseTemplate(
                    "rebootfu_deep_all_green",
                    `Dari sisi kami semuanya terpantau normal Kak — jalur internet, dan perangkat sudah sehat.\n\n` +
                        `Kemungkinan kendalanya ada di dalam rumah (jarak ke modem, perangkat, atau aplikasinya). ` +
                        `Saya sudah teruskan ke teknisi supaya dicek langsung ya 🙏`
                )
            );
        }

        // Ada penyebab yang bisa dijelaskan → jujurkan, jangan buat tiket buta.
        service.closeJob(job.id, store.STATUS.ESCALATED);
        await service.notifyAdmins(
            `🔧 *Reboot tidak menyelesaikan masalah*\nPelanggan: ${job.name || "-"} (${job.jid})\n` +
                `Device: ${job.deviceId}\nVerdict: ${verdict} — ${detail}`
        );
        return reply(
            renderResponseTemplate(
                "rebootfu_deep_found_issue",
                `Terima kasih Kak. Saya menemukan kendalanya ada di sisi jaringan kami, *bukan di perangkat Anda*.\n\n` +
                    `Tim teknisi sudah menerima laporan ini dan sedang menanganinya. Mohon ditunggu ya 🙏`,
                { verdict, detail }
            )
        );
    }

    if (isResolvedAnswer(userReply)) {
        deleteUserState(sender);
        if (job) service.closeJob(job.id, store.STATUS.CLOSED);
        return reply(
            renderResponseTemplate(
                "rebootfu_resolved",
                "Alhamdulillah, senang mendengarnya Kak! 🙌\n\nKalau nanti terasa lambat lagi, balas saja *cek koneksi* ya. Terima kasih 🙏"
            )
        );
    }

    // Jawaban tak terbaca — tanya sekali lagi dengan pilihan yang sangat sederhana.
    return reply(
        renderResponseTemplate(
            "rebootfu_ask_invalid",
            "Maaf Kak, saya kurang paham. Balas *sudah* kalau internetnya sudah normal, atau *masih* kalau masih bermasalah ya 🙏"
        )
    );
}

module.exports = {
    handleRebootOffer,
    handleRebootFollowupAnswer
};
