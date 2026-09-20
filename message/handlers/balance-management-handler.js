/**
 * Header Doc
 * Purpose: Menangani topup manual dan hapus saldo oleh admin/owner (intent `<topup`/`<delsaldo`).
 * Caller: Router bot pada intent balance management legacy.
 * Deps: `rupiah-format` dan `../../lib/whatsapp-delivery-service`.
 * MainFuncs: `handleTopup`, `handleDelSaldo`.
 * SideEffects: Mengubah saldo user dan mengirim notifikasi penerima via gateway runtime WA.
 */

const log = require('../../lib/logger').logger.child('BALANCE_MANAGEMENT_HANDLER');
const convertRupiah = require('rupiah-format');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');
const { renderResponseTemplate } = require('./template-helpers');

/**
 * Handle topup balance
 */
async function handleTopup({ q, isOwner, sender, reply, msg, mess, raf: _raf, checkATMuser: _checkATMuser, addATM: _addATM, addKoinUser }) {
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
            log.error('[TOPUP_INIT] Error creating user saldo:', err);
        }

        // addKoinUser fail-closed: return false bila JID tak ter-resolve / amount invalid / DB sibuk.
        // WAJIB di-await & dicek — kalau tidak, saldo tak bertambah tapi owner & pelanggan tetap
        // menerima notif "berhasil / saldo Rp X masuk" (bohong). Selaras jalur callback iPaymu 'topup'.
        const credited = await addKoinUser(tujuantf, jumblah);
        if (!credited) {
            log.error('[TOPUP_FAILED] addKoinUser mengembalikan false — saldo TIDAK bertambah', { tujuantf, jumlah: jumblah });
            throw new Error('TOPUP_NOT_CREDITED'); // → catch: balas error template ke owner, penerima TIDAK di-notif
        }
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
                log.warn('[SEND_MESSAGE_SKIP] Delivery not sent to recipient', {
                    tujuantf,
                    errorCode: delivery.errorCode,
                    warning: delivery.warning || null
                });
            }
        } catch (error) {
            log.error('[SEND_MESSAGE_ERROR]', {
                tujuantf,
                error: error.message
            });
            log.error('[TOPUP_HANDLER] Error sending notification to recipient:', error);
        }

    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            log.error('[TOPUP_HANDLER] Error:', error);
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
            log.error('[DELSALDO_HANDLER] Error:', error);
            await reply(renderResponseTemplate(
                'balance_del_saldo_generic_error',
                'Terjadi kesalahan saat menghapus saldo.'
            ));
        }
    }
}

module.exports = {
    handleTopup,
    handleDelSaldo
};
