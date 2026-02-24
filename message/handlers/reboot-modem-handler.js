/**
 * Reboot Modem Handler
 * Menangani permintaan reboot modem
 */
const { setUserState } = require('./conversation-handler');

/**
 * Handle reboot modem request
 */
function handleRebootModem({ sender, entities, isOwner, isTeknisi, plainSenderNumber, pushname, users, reply, mess, msg }) {
    // Logika pencarian user yang aman dan konsisten
    let user;
    const providedId = entities.id_pelanggan;

    if ((isOwner || isTeknisi) && providedId && !isNaN(parseInt(providedId))) {
        user = users.find(v => v.id == providedId);
    } else {
        let optionalJid = null;
        if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
            optionalJid = msg.key.remoteJidAlt.split('@')[0].split(':')[0];
            plainSenderNumber = optionalJid;
        } else if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
            optionalJid = msg.participant.split('@')[0].split(':')[0];
            plainSenderNumber = optionalJid;
        }

        user = users.find(u => {
            if (u.lid && u.lid === sender) return true;
            if (!u.phone_number) return false;
            const phones = u.phone_number.split('|').map(p => p.trim());
            return phones.some(phone => {
                if (phone === plainSenderNumber || phone === sender) return true;
                let pClean = phone.replace(/[^0-9]/g, '');
                let sClean = plainSenderNumber.replace(/[^0-9]/g, '');
                if (pClean.startsWith('62')) pClean = pClean.substring(2);
                if (pClean.startsWith('0')) pClean = pClean.substring(1);
                if (sClean.startsWith('62')) sClean = sClean.substring(2);
                if (sClean.startsWith('0')) sClean = sClean.substring(1);
                return pClean === sClean;
            });
        });

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
