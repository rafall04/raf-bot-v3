/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent workflow tiket teknisi/owner di dispatcher WhatsApp.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `TICKET_TEKNISI_INTENT_HANDLERS`, `handleListTiketIntent`, `handleDoneUploadPhotosIntent`, `handleSelesaiTiketIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleSelesaikanTiketIntent(context) {
    const {
        isTeknisi,
        isOwner,
        reply,
        mess,
        q,
        renderResponseTemplate,
        global,
        stateSender,
        setUserState
    } = context;

    if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);
    if (!q) return reply(renderResponseTemplate(
        'dispatch_tiketdone_missing_id',
        "Mohon sertakan nomor tiket yang ingin diselesaikan. Contoh: tiketdone [ID_TIKET]"
    ));

    const ticketIdToResolve = q.trim();
    const reportIndex = global.reports.findIndex(r => r.ticketId === ticketIdToResolve);

    if (reportIndex === -1) {
        return reply(renderResponseTemplate(
            'dispatch_tiketdone_not_found',
            `❌ Tiket dengan ID *${ticketIdToResolve}* tidak ditemukan.\n\nPastikan ID tiket benar.`,
            { ticket_id: ticketIdToResolve }
        ));
    }

    const report = global.reports[reportIndex];

    if (report.status === 'selesai') {
        return reply(renderResponseTemplate(
            'dispatch_tiketdone_already_done',
            `⚠️ Tiket *${ticketIdToResolve}* sudah selesai sebelumnya.`,
            { ticket_id: ticketIdToResolve }
        ));
    }

    setUserState(stateSender, {
        step: 'TICKET_RESOLVE_UPLOAD_PHOTOS',
        flow: 'teknisi',
        ownerType: 'teknisi',
        ticketIdToResolve: ticketIdToResolve,
        uploadedPhotos: [],
        uploadStartTime: Date.now()
    });

    const pelangganName = report.pelangganName || report.pelangganPushName || 'N/A';
    await reply(renderResponseTemplate(
        'dispatch_tiketdone_upload_prompt',
        `📸 *Dokumentasi Penyelesaian Tiket*\n\nID Tiket: *${ticketIdToResolve}*\nPelanggan: ${pelangganName}\n\nSilakan upload foto dokumentasi perbaikan:\n• Foto ONT/Router setelah perbaikan\n• Foto kabel yang sudah diperbaiki\n• Screenshot speedtest (jika ada)\n• Foto lainnya yang relevan\n\n📤 *Cara Upload:*\n1. Kirim foto satu per satu\n2. Setelah selesai, ketik *selesai*\n3. Atau ketik *skip* untuk lewati foto\n\n⏱️ Timeout: 10 menit`,
        { ticket_id: ticketIdToResolve, pelanggan_name: pelangganName }
    ));
}

async function handleListTiketIntent(context) {
    const {
        isTeknisi,
        isOwner,
        reply,
        mess,
        global,
        renderResponseTemplate
    } = context;

    if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

    const pendingTickets = global.reports?.filter(r =>
        r.status === 'pending' || r.status === 'open'
    ) || [];

    if (pendingTickets.length === 0) {
        return reply(renderResponseTemplate(
            'dispatch_list_tiket_empty',
            `📋 *TIDAK ADA TIKET TERSEDIA*\n━━━━━━━━━━━━━━━━\n\nSaat ini tidak ada tiket yang perlu ditangani.\n\n📌 *Tips:*\n• Cek berkala dengan *list tiket*\n• Akan ada notifikasi jika ada tiket baru\n• Siap siaga untuk respons cepat\n\nTerima kasih! 👍`
        ));
    }

    pendingTickets.sort((a, b) => {
        if (a.priority === 'HIGH' && b.priority !== 'HIGH') return -1;
        if (a.priority !== 'HIGH' && b.priority === 'HIGH') return 1;
        return new Date(a.createdAt) - new Date(b.createdAt);
    });

    let message = `📋 *DAFTAR TIKET TERSEDIA*
━━━━━━━━━━━━━━━━

*Total: ${pendingTickets.length} tiket menunggu*\n\n`;

    pendingTickets.forEach((ticket, index) => {
        const createdTime = new Date(ticket.createdAt);
        const waitingMinutes = Math.floor((Date.now() - createdTime) / (1000 * 60));
        const priorityEmoji = ticket.priority === 'HIGH' ? '🔴' : '🟡';

        message += `${index + 1}. *ID: ${ticket.ticketId}*
   ${priorityEmoji} Prioritas: ${ticket.priority}
   👤 ${ticket.pelangganName}
   📍 ${ticket.pelangganAddress || 'Alamat tidak tersedia'}
   ⏱️ Menunggu: ${waitingMinutes} menit
   📝 ${ticket.issueType || 'Gangguan'}
   
`;
    });

    message += `━━━━━━━━━━━━━━━━
📌 *STEP SELANJUTNYA:*
➡️ Ambil tiket dengan ketik:
   *proses [ID_TIKET]*

Contoh: proses ${pendingTickets[0].ticketId}

💡 *Tips:* Prioritaskan tiket 🔴 HIGH`;

    return reply(message);
}

async function handleProsesTiketIntent(context) {
    const {
        isTeknisi,
        isOwner,
        reply,
        mess,
        chats,
        matchedKeywordLength,
        format,
        handleProsesTicket,
        sender
    } = context;

    if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

    const words = chats.split(' ');
    const ticketId = words[matchedKeywordLength] || words[1];
    if (!ticketId) {
        return reply(format('error_format_proses'));
    }

    const result = await handleProsesTicket(sender, ticketId, reply);
    return reply(result.message);
}

async function handleOtwTiketIntent(context) {
    const {
        isTeknisi,
        isOwner,
        reply,
        mess,
        chats,
        matchedKeywordLength,
        format,
        handleOTW,
        sender
    } = context;

    if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

    const words = chats.split(' ');
    const ticketId = words[matchedKeywordLength] || words[1];
    if (!ticketId) {
        return reply(format('error_format_otw'));
    }

    const result = await handleOTW(sender, ticketId, null, reply);
    return reply(result.message);
}

async function handleSampaiLokasiIntent(context) {
    const {
        isTeknisi,
        isOwner,
        reply,
        mess,
        chats,
        matchedKeywordLength,
        format,
        handleSampaiLokasi,
        sender
    } = context;

    if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

    const words = chats.split(' ');
    const ticketId = words[matchedKeywordLength] || words[1];
    if (!ticketId) {
        return reply(format('error_format_sampai'));
    }

    const result = await handleSampaiLokasi(sender, ticketId, reply);
    return reply(result.message);
}

async function handleVerifikasiOtpIntent(context) {
    const {
        isTeknisi,
        isOwner,
        reply,
        mess,
        chats,
        matchedKeywordLength,
        format,
        handleVerifikasiOTP,
        sender
    } = context;

    if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

    const args = chats.split(' ');
    const ticketId = args[matchedKeywordLength] || args[1];
    const otp = args[matchedKeywordLength + 1] || args[2];

    if (!ticketId || !otp) {
        return reply(format('error_format_verifikasi'));
    }

    const result = await handleVerifikasiOTP(sender, ticketId, otp, reply);
    return reply(result.message);
}

async function handleDoneUploadPhotosIntent(context) {
    const {
        getUserState,
        stateSender,
        isTeknisi,
        isOwner,
        reply,
        renderResponseTemplate,
        format,
        setUserState
    } = context;
    const state = getUserState(stateSender);

    if (!state) {
        return undefined;
    }

    if (!isTeknisi && !isOwner) {
        return undefined;
    }

    if (state.guidedMode) {
        const { problem, speedtest } = state.photoCategories;

        if (!problem || !speedtest) {
            let missingCategories = [];
            if (!problem) missingCategories.push('📷 Foto penyebab masalah');
            if (!speedtest) missingCategories.push('📊 Screenshot speedtest');

            const problemStatus = problem ? '✅' : '❌';
            const speedtestStatus = speedtest ? '✅' : '❌';
            const resultStatus = state.photoCategories.result ? '✅' : '⚪';
            const missingList = missingCategories.join('\n');

            return reply(renderResponseTemplate(
                'dispatch_done_upload_categories_missing',
                `❌ *KATEGORI FOTO WAJIB BELUM LENGKAP!*\n\n━━━━━━━━━━━━━━━━\n📌 *STATUS:*\n━━━━━━━━━━━━━━━━\n\n${problemStatus} 1. Foto penyebab masalah\n${speedtestStatus} 2. Screenshot speedtest\n${resultStatus} 3. Foto hasil (opsional)\n\n━━━━━━━━━━━━━━━━\n⚠️ *YANG MASIH KURANG:*\n━━━━━━━━━━━━━━━━\n\n${missingList}\n\n➡️ *Upload foto yang kurang terlebih dahulu!*`,
                { problem_status: problemStatus, speedtest_status: speedtestStatus, result_status: resultStatus, missing_list: missingList }
            ));
        }

    } else {
        if (state.step !== 'AWAITING_COMPLETION_PHOTOS') {
            return reply(format('error_not_photo_upload_phase'));
        }

        if (!state.uploadedPhotos || state.uploadedPhotos.length < 2) {
            const uploadedCount = state.uploadedPhotos?.length || 0;
            const minRequired = 2;
            const kurangCount = minRequired - uploadedCount;
            return reply(renderResponseTemplate(
                'dispatch_done_upload_not_enough',
                `❌ *FOTO BELUM CUKUP!*\n\n📌 *STATUS:*\n• Foto terupload: ${uploadedCount}\n• Minimum required: ${minRequired} foto\n• Kurang: ${kurangCount} foto\n\n📌 *STEP SELANJUTNYA:*\n➡️ Upload ${kurangCount} foto lagi\n   Kemudian ketik *done*`,
                { uploaded_count: uploadedCount, min_required: minRequired, kurang_count: kurangCount }
            ));
        }
    }

    setUserState(stateSender, {
        ...state,
        step: 'AWAITING_RESOLUTION_NOTES'
    });

    const photoCount = state.uploadedPhotos.length;
    return reply(renderResponseTemplate(
        'dispatch_done_upload_complete',
        `✅ *DOKUMENTASI SELESAI - ${photoCount} FOTO TERSIMPAN*\n\n📌 *STEP SELANJUTNYA:*\n📝 *ISI CATATAN RESOLUSI PERBAIKAN*\n━━━━━━━━━━━━━━━━\n\nSilakan ketik catatan perbaikan Anda.\n\n*Format Bebas (min. 10 karakter):*\n🔸 "Restart modem, sudah normal"\n🔸 "Ganti kabel drop, sinyal OK" \n🔸 "Setting ulang router, speed normal"\n\n*Atau Format Detail:*\n*Masalah:* [apa masalahnya]\n*Solusi:* [apa yang diperbaiki]\n*Status:* [hasil akhir]\n\n➡️ Ketik catatan Anda sekarang...`,
        { photo_count: photoCount }
    ));
}

async function handleSelesaiTiketIntent(context) {
    const {
        isTeknisi,
        isOwner,
        reply,
        mess,
        chats,
        format,
        handleSelesaiTicket,
        sender
    } = context;

    if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

    const ticketId = chats.split(' ')[1];
    if (!ticketId) {
        return reply(format('error_format_selesai'));
    }

    const result = await handleSelesaiTicket(sender, ticketId, reply);
    return reply(result.message);
}

const TICKET_TEKNISI_INTENT_HANDLERS = Object.freeze({
    SELESAIKAN_TIKET: handleSelesaikanTiketIntent,
    tiketdone: handleSelesaikanTiketIntent,
    LIST_TIKET: handleListTiketIntent,
    PROSES_TIKET: handleProsesTiketIntent,
    OTW_TIKET: handleOtwTiketIntent,
    SAMPAI_LOKASI: handleSampaiLokasiIntent,
    VERIFIKASI_OTP: handleVerifikasiOtpIntent,
    DONE_UPLOAD_PHOTOS: handleDoneUploadPhotosIntent,
    SELESAI_TIKET: handleSelesaiTiketIntent
});

module.exports = {
    TICKET_TEKNISI_INTENT_HANDLERS,
    handleSelesaikanTiketIntent,
    handleListTiketIntent,
    handleProsesTiketIntent,
    handleOtwTiketIntent,
    handleSampaiLokasiIntent,
    handleVerifikasiOtpIntent,
    handleDoneUploadPhotosIntent,
    handleSelesaiTiketIntent
};
