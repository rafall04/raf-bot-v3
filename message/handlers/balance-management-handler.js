/**
 * Header Doc
 * Purpose: Menangani topup manual, transfer saldo, dan operasi balance management oleh admin/owner.
 * Caller: Router bot pada intent balance management legacy.
 * Deps: `rupiah-format`, `../../lib/jid-utils`, `../../lib/whatsapp-gateway`, dan `../../lib/whatsapp-delivery-service`.
 * MainFuncs: `handleTopup`, `handleDelSaldo`, `handleTransfer`.
 * SideEffects: Mengubah saldo user dan mengirim notifikasi penerima via gateway runtime WA.
 */

const convertRupiah = require('rupiah-format');
const { resolveCanonicalCustomerContext, normalizePhoneToJid } = require('../../lib/jid-utils');
const { getSocket } = require('../../lib/whatsapp-gateway');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');
const { renderResponseTemplate } = require('./template-helpers');

async function resolveCanonicalSender(sender, msg, flow) {
    return resolveCanonicalCustomerContext({
        sender,
        msg,
        raf: getSocket(),
        users: global.users || [],
        flow
    });
}

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

        try {
            const delivery = await sendMessage(tujuantf, { text: recipientMessage }, { quoted: msg });
            if (!delivery.sent) {
                console.warn('[SEND_MESSAGE_SKIP] Delivery not sent to recipient', {
                    tujuantf,
                    errorCode: delivery.errorCode,
                    warning: delivery.warning || null
                });
            }
        } catch (error) {
            console.error('[SEND_MESSAGE_ERROR]', {
                tujuantf,
                error: error.message
            });
            console.error('[TOPUP_HANDLER] Error sending notification to recipient:', error);
        }

    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            console.error('[TOPUP_HANDLER] Error:', error);
            await reply(renderResponseTemplate(
                'balance_topup_generic_error',
                'Terjadi kesalahan saat melakukan topup.'
            ));
        }
    }
}

/**
 * Handle delete balance
 */
async function handleDelSaldo({ q, isOwner, reply, mess, checkATMuser, checkRegisteredATM, delSaldo }) {
    try {
        if (!isOwner) throw mess.owner;
        if (!q) throw mess.wrongFormat;
        if (isNaN(q)) throw mess.mustNumber;

        const tujuandel = `${q.replace("@", '')}@s.whatsapp.net`;

        // Cek eksistensi yang benar: checkRegisteredATM mengembalikan false bila nomor belum terdaftar.
        // (checkATMuser mengembalikan 0 untuk nomor tak ada, jadi tidak bisa dipakai mendeteksi "tidak ditemukan".)
        const isRegistered = typeof checkRegisteredATM === 'function'
            ? await checkRegisteredATM(tujuandel)
            : (await checkATMuser(tujuandel)) > 0;

        if (!isRegistered) {
            await reply(renderResponseTemplate(
                'balance_del_saldo_not_found',
                'Nomor Yang Akan Dihapus Tidak Ditemukan.'
            ));
            return;
        }

        const removed = await delSaldo(tujuandel);
        if (!removed) {
            await reply(renderResponseTemplate(
                'balance_del_saldo_generic_error',
                'Terjadi kesalahan saat menghapus saldo.'
            ));
            return;
        }

        // Gunakan template system untuk notifikasi hapus saldo
        const { renderTemplate } = require('../../lib/templating');
        const message = renderTemplate('del_saldo_success', {
            nomor_user: tujuandel
        });
        await reply(message, { skipDuplicateCheck: true });
        return;
    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            console.error('[DELSALDO_HANDLER] Error:', error);
            await reply(renderResponseTemplate(
                'balance_del_saldo_generic_error',
                'Terjadi kesalahan saat menghapus saldo.'
            ));
        }
    }
}

/**
 * Handle balance transfer
 */
async function handleTransfer({ q, sender, reply, msg, mess, raf, checkATMuser, addATM, addKoinUser, confirmATM, format }) {
    try {
        if (!q.includes('|')) return reply(format('mess_wrongFormat'));

        const senderResolution = await resolveCanonicalSender(sender, msg, 'admin_balance_transfer');
        const normalizedSender = senderResolution.canonicalJid || sender;

        let [tujuan, jumblah] = q.split('|');
        if (isNaN(jumblah)) throw mess.mustNumber;

        const senderSaldo = await checkATMuser(normalizedSender);
        if (senderSaldo < jumblah) {
            throw renderResponseTemplate(
                'balance_transfer_insufficient',
                `uang mu tidak mencukupi untuk melakukan transfer.`
            );
        }

        const tujuantf = normalizePhoneToJid(tujuan.replace("@", ''));

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
            nomorPengirim: (senderResolution.phoneNumber || sender.split("@")[0]),
            nomorTujuan: tujuan,
            jumlah: kerupiah123,
            sisaSaldo
        }));

        // Dapatkan nama pengirim (pushname atau nomor HP, bukan @lid)
        let namaPengirim = senderResolution.phoneNumber || normalizedSender.replace('@s.whatsapp.net', '');

        // Coba ambil pushname dari database saldo jika ada
        const saldoManager = require('../../lib/saldo-manager');
        try {
            const saldoData = await saldoManager.getAllSaldoData();
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
                const senderPhone = (senderResolution.phoneNumber || normalizedSender.replace('@s.whatsapp.net', '')).replace(/[^0-9]/g, '');
                return userPhone === senderPhone || userPhone === senderPhone.replace('62', '0');
            });

            if (senderUser && senderUser.name) {
                namaPengirim = senderUser.name;
            }
        }

        // Jika masih @lid atau format aneh, gunakan nomor HP yang sudah dinormalisasi
        if (namaPengirim.includes('@lid') || namaPengirim.includes(':')) {
            namaPengirim = (senderResolution.phoneNumber || normalizedSender.replace('@s.whatsapp.net', '')).replace(/[^0-9]/g, '');
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

        try {
            const delivery = await sendMessage(tujuantf, { text: message }, { quoted: msg });
            if (!delivery.sent) {
                console.warn('[SEND_MESSAGE_SKIP] Delivery not sent to recipient', {
                    tujuantf,
                    errorCode: delivery.errorCode,
                    warning: delivery.warning || null
                });
            }
        } catch (error) {
            console.error('[SEND_MESSAGE_ERROR]', {
                tujuantf,
                error: error.message
            });
            console.error('[TRANSFER_HANDLER] Error sending notification to recipient:', error);
            // Jangan throw - notification tidak critical
        }

    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            console.error('[TRANSFER_HANDLER] Error:', error);
            await reply(renderResponseTemplate(
                'balance_transfer_generic_error',
                'Terjadi kesalahan saat melakukan transfer.'
            ));
        }
    }
}

module.exports = {
    handleTopup,
    handleDelSaldo,
    handleTransfer
};
