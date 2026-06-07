/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent tiket sisi pelanggan dan konfirmasi customer di dispatcher WhatsApp.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `TICKET_CUSTOMER_INTENT_HANDLERS`, `handleBatalkanTiketIntent`, `handleKonfirmasiSelesaiIntent`, `handleCustomerConfirmDoneIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleCekTiketIntent(context) {
    const {
        handleCekTiket,
        q,
        pushname,
        sender,
        isOwner,
        isTeknisi,
        global,
        reply
    } = context;

    handleCekTiket(q, pushname, sender, isOwner, isTeknisi, global.config, global, reply);
}

async function handleBatalkanTiketIntent(context) {
    const {
        isOwner,
        isTeknisi,
        reply,
        renderResponseTemplate,
        chats,
        global,
        pushname,
        sender,
        stateSender,
        setUserState
    } = context;

    if (isOwner || isTeknisi) {
        return reply(renderResponseTemplate(
            'raf_dispatch_cancel_customer_only',
            `Fitur ini khusus untuk pelanggan. Admin dapat membatalkan tiket melalui antarmuka web.`
        ));
    }

    let ticketId = '';
    const originalMessage = chats.trim();

    const cleanedMessage = originalMessage.replace(/^batalkan\s*tiket\s*/i, '').trim();

    if (cleanedMessage && cleanedMessage.length > 0) {
        ticketId = cleanedMessage.toUpperCase();
    }

    if (!ticketId || ticketId.length < 5) {
        const userReports = global.reports.filter(
            r => r.pelangganId === sender && (r.status === 'baru' || r.status === 'pending')
        );

        if (userReports.length === 0) {
            return reply(renderResponseTemplate(
                'raf_dispatch_cancel_no_active_report',
                `Halo Kak ${pushname}, saat ini Anda tidak memiliki laporan aktif yang bisa dibatalkan.\n\nFormat: *batalkantiket [ID_TIKET]*`,
                { pushname }
            ));
        }

        let listMessage = `📋 *Laporan Anda yang bisa dibatalkan:*\n\n`;
        userReports.forEach(r => {
            listMessage += `ID: *${r.ticketId}*\nStatus: ${r.status}\nTanggal: ${new Date(r.createdAt).toLocaleString('id-ID')}\n\n`;
        });
        listMessage += `Untuk membatalkan, ketik:\n*batalkantiket [ID_TIKET]*`;
        return reply(listMessage);
    }

    const activeReport = global.reports.find(
        r => r.ticketId === ticketId
    );

    if (!activeReport) {
        return reply(renderResponseTemplate(
            'raf_dispatch_cancel_not_found',
            `❌ Tiket dengan ID *${ticketId}* tidak ditemukan.\n\nSilakan cek kembali ID tiket Anda.`,
            { ticketId }
        ));
    }
    if (activeReport.pelangganId !== sender) {
        return reply(renderResponseTemplate(
            'raf_dispatch_cancel_not_owned',
            `❌ Tiket dengan ID *${ticketId}* bukan milik Anda.`,
            { ticketId }
        ));
    }

    if (activeReport.status === 'dibatalkan' || activeReport.status === 'dibatalkan pelanggan') {
        return reply(renderResponseTemplate(
            'raf_dispatch_cancel_already_cancelled',
            `ℹ️ Tiket dengan ID *${ticketId}* sudah dibatalkan sebelumnya.`,
            { ticketId }
        ));
    }

    if (activeReport.status === 'selesai') {
        return reply(renderResponseTemplate(
            'raf_dispatch_cancel_already_done',
            `ℹ️ Tiket dengan ID *${ticketId}* sudah selesai ditangani.`,
            { ticketId }
        ));
    }

    if (activeReport.status === 'diproses teknisi' || activeReport.status === 'otw' || activeReport.status === 'sampai lokasi') {
        return reply(renderResponseTemplate(
            'raf_dispatch_cancel_in_progress',
            `⚠️ Maaf, laporan Anda dengan ID *${ticketId}* sudah dalam penanganan teknisi dan tidak dapat dibatalkan.\n\nStatus: *${activeReport.status}*\n\nSilakan hubungi Admin jika ada keperluan mendesak.`,
            { ticketId, status: activeReport.status }
        ));
    }

    if (activeReport.status === 'baru' || activeReport.status === 'pending') {
        const reportDetails = activeReport.laporanText ?
            activeReport.laporanText.substring(0, 75) + (activeReport.laporanText.length > 75 ? '...' : '') :
            'Tidak ada deskripsi';

        setUserState(stateSender, {
            step: 'CONFIRM_CANCEL_TICKET',
            flow: 'report',
            ticketIdToCancel: activeReport.ticketId
        });

        return reply(renderResponseTemplate(
            'raf_dispatch_cancel_confirm',
            `📋 *Konfirmasi Pembatalan Tiket*\n\nID: *${activeReport.ticketId}*\nLaporan: _"${reportDetails}"_\nStatus: ${activeReport.status}\n\nAnda yakin ingin membatalkan laporan ini?\n\nBalas *ya* untuk konfirmasi pembatalan\nBalas *tidak* untuk membatalkan`,
            { ticketId: activeReport.ticketId, reportDetails, status: activeReport.status }
        ));
    }

    return reply(renderResponseTemplate(
        'raf_dispatch_cancel_status_unsupported',
        `⚠️ Tiket dengan ID *${ticketId}* memiliki status: *${activeReport.status}*\n\nStatus ini tidak dapat diproses untuk pembatalan. Silakan hubungi admin untuk bantuan.`,
        { ticketId, status: activeReport.status }
    ));
}

async function handleKonfirmasiSelesaiIntent(context) {
    const {
        q,
        reply,
        renderResponseTemplate,
        handleAgentConfirmation,
        msg,
        sender,
        isTeknisi,
        isOwner,
        mess,
        handleFinalConfirmation
    } = context;
    const args = q.split(' ');
    if (args.length < 2) {
        const transactionId = args[0];
        if (transactionId && transactionId.startsWith('AGT_TRX_')) {
            return reply(renderResponseTemplate(
                'raf_dispatch_confirm_agent_format',
                "Format: konfirmasi [transaction_id] [pin]"
            ));
        }
        return reply(renderResponseTemplate(
            'raf_dispatch_confirm_ticket_format',
            "Format: konfirmasi [ID_TIKET] [KODE]"
        ));
    }

    const firstArg = args[0];

    if (firstArg.startsWith('AGT_TRX_')) {
        await handleAgentConfirmation(msg, sender, reply, args);
    } else {
        if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

        const ticketId = firstArg;
        const code = args[1];

        const result = await handleFinalConfirmation({
            ticketId,
            completionCode: code,
            isFromCustomer: false,
            sender
        });

        if (result.message) {
            await reply(result.message);
        }
    }
}

async function handleCustomerConfirmDoneIntent(context) {
    const {
        isOwner,
        isTeknisi,
        handleRemoteResponse,
        sender,
        lowerMessage,
        reply
    } = context;

    if (!isOwner && !isTeknisi) {
        const remoteResponse = await handleRemoteResponse({
            customerId: sender,
            response: lowerMessage,
            reply
        });

        if (remoteResponse) {
            return reply(remoteResponse.message);
        }
    }

    // Tidak ada konfirmasi remote yang cocok untuk pelanggan ini (atau pemanggil
    // owner/teknisi yang semestinya memakai KONFIRMASI_SELESAI). Tidak ada aksi
    // lanjutan. Blok sebelumnya memakai `ticketId`/`code` yang tak pernah tersedia
    // di context (selalu ReferenceError) — dihapus karena tak fungsional.
}

async function handleCekLokasiTeknisiIntent(context) {
    const {
        chats,
        matchedKeywordLength,
        reply,
        format,
        handleCekLokasiTeknisi,
        sender
    } = context;
    const commandArgs = chats.split(' ').slice(matchedKeywordLength || 1);
    const ticketIdLokasi = commandArgs[0];

    if (!ticketIdLokasi) {
        return reply(format('error_format_lokasi'));
    }

    const lokasiResult = await handleCekLokasiTeknisi(
        sender,
        ticketIdLokasi,
        reply
    );
    return reply(lokasiResult.message);
}

async function handleTiketSayaIntent(context) {
    const { handleTiketSaya, sender, reply } = context;
    const tiketResult = await handleTiketSaya(sender, reply);
    return reply(tiketResult.message);
}

const TICKET_CUSTOMER_INTENT_HANDLERS = Object.freeze({
    CEK_TIKET: handleCekTiketIntent,
    BATALKAN_TIKET: handleBatalkanTiketIntent,
    KONFIRMASI_SELESAI: handleKonfirmasiSelesaiIntent,
    CUSTOMER_CONFIRM_DONE: handleCustomerConfirmDoneIntent,
    CEK_LOKASI_TEKNISI: handleCekLokasiTeknisiIntent,
    TIKET_SAYA: handleTiketSayaIntent
});

module.exports = {
    TICKET_CUSTOMER_INTENT_HANDLERS,
    handleCekTiketIntent,
    handleBatalkanTiketIntent,
    handleKonfirmasiSelesaiIntent,
    handleCustomerConfirmDoneIntent,
    handleCekLokasiTeknisiIntent,
    handleTiketSayaIntent
};
