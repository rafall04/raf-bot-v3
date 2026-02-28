/**
 * Reboot Modem Handler
 * Menangani permintaan reboot modem
 */
const { setUserState } = require('./conversation-handler');
const { resolveCustomerBySender } = require('../../lib/jid-utils');

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
        const errorMessage = (isOwner || isTeknisi)
            ? (providedId ? `Maaf, Kak. Pelanggan dengan ID "${providedId}" tidak ditemukan.` : "Anda belum terdaftar sebagai pelanggan. Untuk reboot modem pelanggan lain, sebutkan ID pelanggannya.")
            : mess.userNotRegister;
        return reply(errorMessage);
    }

    if (user.subscription === 'PAKET-VOUCHER' && !(isOwner || isTeknisi)) {
        return reply(`Maaf Kak ${pushname}, fitur reboot modem saat ini hanya tersedia untuk pelanggan bulanan.`);
    }

    if (!user.device_id) {
        return reply(`Maaf Kak ${pushname}, data device ID untuk pelanggan "${user.name || 'ini'}" tidak ditemukan sehingga saya tidak bisa melakukan reboot. Silakan hubungi Admin.`);
    }

    // Memulai percakapan konfirmasi menggunakan setUserState untuk auto-cleanup
    setUserState(sender, {
        step: 'CONFIRM_REBOOT',
        targetUser: user
    });
    reply(`Tentu, saya bisa me-reboot modem Anda. Perlu diingat, proses ini akan membuat koneksi internet terputus selama beberapa menit.\n\nAnda yakin ingin melanjutkan?\n\nBalas *'ya'* untuk melanjutkan, atau *'batal'* untuk membatalkan.`);
}

module.exports = {
    handleRebootModem
};
