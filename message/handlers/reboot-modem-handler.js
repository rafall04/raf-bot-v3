/**
 * Header Doc
 * Purpose: Handler permintaan reboot modem pelanggan lewat perintah WhatsApp dengan konfirmasi 'ya'/'batal'.
 * Caller: Dispatcher bot `message/raf.js` pada intent `REBOOT_MODEM`.
 * Deps: `./conversation-handler`, `../../lib/jid-utils`, `./template-helpers` (renderResponseTemplate).
 * MainFuncs: `handleRebootModem`.
 * SideEffects: Menyimpan state konfirmasi `CONFIRM_REBOOT` dan mengirim reply WhatsApp.
 */
const { setUserState } = require('./conversation-handler');
const { resolveCustomerBySender } = require('../../lib/jid-utils');
const { renderResponseTemplate } = require('./template-helpers');

/**
 * Handle reboot modem request
 */
async function handleRebootModem({ sender, entities, isOwner, isTeknisi, plainSenderNumber, pushname, users, reply, mess, msg, raf }) {
    // Logika pencarian user yang aman dan konsisten
    let user;
    const providedId = entities.id_pelanggan;

    if ((isOwner || isTeknisi) && providedId && !isNaN(parseInt(providedId))) {
        user = users.find(v => v.id == providedId);
    } else {
        const resolved = await resolveCustomerBySender({ users, sender, msg, raf });
        user = resolved.user;
        plainSenderNumber = resolved.plainSenderNumber;

        // Debug logging for @lid format
        if (sender.endsWith('@lid') && !user) {
            console.log('[REBOOT_MODEM] @lid format detected, user not found');
            console.log('[REBOOT_MODEM] Sender:', sender);
        }
    }

    if (!user) {
        if (isOwner || isTeknisi) {
            const errorMessage = providedId
                ? renderResponseTemplate(
                    'reboot_admin_id_not_found',
                    `Maaf, Kak. Pelanggan dengan ID "${providedId}" tidak ditemukan.`,
                    { providedId }
                )
                : renderResponseTemplate(
                    'reboot_admin_prompt_id',
                    `Anda belum terdaftar sebagai pelanggan. Untuk reboot modem pelanggan lain, sebutkan ID pelanggannya.`
                );
            return reply(errorMessage);
        }
        return reply(mess.userNotRegister);
    }

    if (user.subscription === 'PAKET-VOUCHER' && !(isOwner || isTeknisi)) {
        return reply(renderResponseTemplate(
            'reboot_voucher_only_monthly',
            `Maaf Kak ${pushname}, fitur reboot modem saat ini hanya tersedia untuk pelanggan bulanan.`,
            { pushname: pushname || 'Kak' }
        ));
    }

    if (!user.device_id) {
        return reply(renderResponseTemplate(
            'reboot_device_missing',
            `Maaf Kak ${pushname}, data device ID untuk pelanggan "${user.name || 'ini'}" tidak ditemukan sehingga saya tidak bisa melakukan reboot. Silakan hubungi Admin.`,
            { pushname: pushname || 'Kak', nama_pelanggan: user.name || 'ini' }
        ));
    }

    // Memulai percakapan konfirmasi menggunakan setUserState untuk auto-cleanup
    setUserState(sender, {
        step: 'CONFIRM_REBOOT',
        targetUser: user
    });
    reply(renderResponseTemplate(
        'reboot_confirm_prompt',
        `Tentu, saya bisa me-reboot modem Anda. Perlu diingat, proses ini akan membuat koneksi internet terputus selama beberapa menit.\n\nAnda yakin ingin melanjutkan?\n\nBalas *'ya'* untuk melanjutkan, atau *'batal'* untuk membatalkan.`
    ));
}

module.exports = {
    handleRebootModem
};
