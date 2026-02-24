/**
 * Balance Management Handler
 * Handles topup, transfer, and balance operations
 */

const convertRupiah = require('rupiah-format');

/**
 * Handle topup balance
 */
async function handleTopup({ q, isOwner, sender, reply, msg, mess, raf, checkATMuser, addATM, addKoinUser }) {
    try {
        if (!isOwner) throw mess.owner;
        if (!q.includes('|')) throw mess.wrongFormat;

        let [tujuan, jumblah] = q.split('|');
        if (isNaN(jumblah)) throw mess.mustNumber;

        const tujuantf = `${tujuan.replace("@", '')}@s.whatsapp.net`;

        // PENTING: Gunakan createUserSaldo untuk inisialisasi, bukan addKoinUser dengan amount=0
        try {
            const saldoManager = require('../../lib/saldo-manager');
            saldoManager.createUserSaldo(tujuantf);
        } catch (err) {
            console.error('[TOPUP_INIT] Error creating user saldo:', err);
        }

        addKoinUser(tujuantf, jumblah);
        const kerupiah123 = convertRupiah.convert(jumblah);

        // Gunakan template system untuk notifikasi admin
        const { renderTemplate } = require('../../lib/templating');
        const adminMessage = renderTemplate('topup_success_admin', {
            nomor_pengirim: sender.split("@")[0],
            nomor_tujuan: tujuan,
            jumlah: kerupiah123
        });
        await reply(adminMessage, { skipDuplicateCheck: true });

        // Gunakan template system untuk notifikasi penerima
        const recipientMessage = renderTemplate('topup_success_recipient_manual', {
            jumlah: kerupiah123
        });

        // PENTING: Cek connection state dan gunakan error handling sesuai rules
        if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
            try {
                await raf.sendMessage(tujuantf, { text: recipientMessage }, { quoted: msg });
            } catch (error) {
                console.error('[SEND_MESSAGE_ERROR]', {
                    tujuantf,
                    error: error.message
                });
                console.error('[TOPUP_HANDLER] Error sending notification to recipient:', error);
            }
        } else {
            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', tujuantf);
        }

    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            console.error('[TOPUP_HANDLER] Error:', error);
            await reply('Terjadi kesalahan saat melakukan topup.');
        }
    }
}

/**
 * Handle delete balance
 */
async function handleDelSaldo({ q, isOwner, reply, mess, checkATMuser, delSaldo }) {
    try {
        if (!isOwner) throw mess.owner;
        if (!q) throw mess.wrongFormat;
        if (isNaN(q)) throw mess.mustNumber;

        const tujuandel = `${q.replace("@", '')}@s.whatsapp.net`;
        const checkATM = await checkATMuser(tujuandel);

        if (checkATM === undefined) {
            await reply('Nomor Yang Akan Dihapus Tidak Ditemukan.');
            return;
        } else {
            delSaldo(tujuandel);

            // Gunakan template system untuk notifikasi hapus saldo
            const { renderTemplate } = require('../../lib/templating');
            const message = renderTemplate('del_saldo_success', {
                nomor_user: tujuandel
            });
            await reply(message, { skipDuplicateCheck: true });
            return;
        }
    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            console.error('[DELSALDO_HANDLER] Error:', error);
            await reply('Terjadi kesalahan saat menghapus saldo.');
        }
    }
}

/**
 * Handle balance transfer
 */
async function handleTransfer({ q, sender, reply, msg, mess, raf, checkATMuser, addATM, addKoinUser, confirmATM, format }) {
    try {
        if (!q.includes('|')) return reply(format('mess_wrongFormat'));

        // Gunakan sender murni (bisa @lid atau @s.whatsapp.net)
        let normalizedSender = sender;

        let [tujuan, jumblah] = q.split('|');
        if (isNaN(jumblah)) throw mess.mustNumber;

        const senderSaldo = await checkATMuser(normalizedSender);
        if (senderSaldo < jumblah) {
            throw `uang mu tidak mencukupi untuk melakukan transfer.`;
        }

        const tujuantf = `${tujuan.replace("@", '')}@s.whatsapp.net`;

        // PENTING: Gunakan createUserSaldo untuk inisialisasi, bukan addKoinUser dengan amount=0
        try {
            const saldoManager = require('../../lib/saldo-manager');
            saldoManager.createUserSaldo(tujuantf);
        } catch (err) {
            console.error('[TRANSFER_INIT] Error creating user saldo:', err);
        }

        confirmATM(normalizedSender, jumblah);
        addKoinUser(tujuantf, jumblah);

        const kerupiah123 = convertRupiah.convert(jumblah);
        const sisaSaldo = convertRupiah.convert(await checkATMuser(normalizedSender));

        await reply(format('transfer_sukses_pengirim', {
            nomorPengirim: sender.split("@")[0],
            nomorTujuan: tujuan,
            jumlah: kerupiah123,
            sisaSaldo
        }));

        // Dapatkan nama pengirim (pushname atau nomor HP, bukan @lid)
        let namaPengirim = normalizedSender.replace('@s.whatsapp.net', '');

        // Coba ambil pushname dari database saldo jika ada
        const saldoManager = require('../../lib/saldo-manager');
        try {
            const saldoData = await saldoManager.getAllSaldoDataFromDb();
            const senderSaldoData = saldoData.find(s => s.user_id === normalizedSender);
            if (senderSaldoData && senderSaldoData.pushname) {
                namaPengirim = senderSaldoData.pushname;
            }
        } catch (err) {
            // Ignore error, continue with other methods
        }

        // Coba ambil dari database user jika ada
        if (global.users && Array.isArray(global.users)) {
            const senderUser = global.users.find(u => {
                const userPhone = u.phone_number ? u.phone_number.replace(/[^0-9]/g, '') : '';
                const senderPhone = normalizedSender.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
                return userPhone === senderPhone || userPhone === senderPhone.replace('62', '0');
            });

            if (senderUser && senderUser.name) {
                namaPengirim = senderUser.name;
            }
        }

        // Jika masih @lid atau format aneh, gunakan nomor HP yang sudah dinormalisasi
        if (namaPengirim.includes('@lid') || namaPengirim.includes(':')) {
            namaPengirim = normalizedSender.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
        }

        // Jika msg tersedia, coba ambil pushname dari message
        if (msg && msg.pushName) {
            namaPengirim = msg.pushName;
        }

        // Gunakan template system untuk notifikasi penerima
        const { renderTemplate } = require('../../lib/templating');
        const recipientSaldo = await checkATMuser(tujuantf);

        const message = renderTemplate('transfer_saldo_masuk', {
            jumlah: kerupiah123,
            nama_pengirim: namaPengirim,
            formattedSaldo: convertRupiah.convert(recipientSaldo)
        });

        // PENTING: Cek connection state dan gunakan error handling sesuai rules
        if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
            try {
                await raf.sendMessage(tujuantf, { text: message }, { quoted: msg });
            } catch (error) {
                console.error('[SEND_MESSAGE_ERROR]', {
                    tujuantf,
                    error: error.message
                });
                logger.error('[TRANSFER_HANDLER] Error sending notification to recipient:', error);
                // Jangan throw - notification tidak critical
            }
        } else {
            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', tujuantf);
        }

    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            console.error('[TRANSFER_HANDLER] Error:', error);
            await reply('Terjadi kesalahan saat melakukan transfer.');
        }
    }
}

module.exports = {
    handleTopup,
    handleDelSaldo,
    handleTransfer
};
