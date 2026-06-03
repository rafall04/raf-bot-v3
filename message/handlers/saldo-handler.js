/**
 * Header Doc
 * Purpose: Menangani command saldo pelanggan termasuk cek saldo, transfer, dan riwayat transaksi.
 * Caller: Router bot WhatsApp pada intent saldo.
 * Deps: `../../lib/saldo-manager`, `../../lib/logger`, `../../lib/jid-utils`, `../../lib/whatsapp-delivery-service`, dan `../../lib/whatsapp-gateway`.
 * MainFuncs: `handleCekSaldo`, `handleTransferSaldo`, dan helper resolusi sender.
 * SideEffects: Membaca/memperbarui saldo dan mengirim notifikasi transfer masuk ke penerima.
 */
const saldoManager = require('../../lib/saldo-manager');
const convertRupiah = require('rupiah-format');
const { logger } = require('../../lib/logger');
const { resolveCanonicalCustomerContext, normalizePhoneToJid, maskPhoneNumber } = require('../../lib/jid-utils');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');
const { getSocket, isReady } = require('../../lib/whatsapp-gateway');
const { renderResponseTemplate } = require('./template-helpers');

async function resolveCanonicalSenderOrReply({ sender, msg, reply, flow }) {
    const resolution = await resolveCanonicalCustomerContext({
        sender,
        msg,
        raf: getSocket(),
        users: global.users || [],
        flow
    });

    if (!resolution.resolved || !resolution.canonicalJid) {
        await reply(renderResponseTemplate(
            'saldo_sender_verification_failed',
            '❌ Nomor WhatsApp Anda belum bisa diverifikasi otomatis. Silakan hubungi admin untuk bantuan.'
        ));
        return null;
    }

    return resolution;
}

/**
 * Handle cek saldo command
 * Supports multiple keywords: saldo, ceksaldo, cek saldo, infosaldo, saldo saya
 */
async function handleCekSaldo(msg, sender, reply, pushname) {
    try {
        const resolution = await resolveCanonicalSenderOrReply({
            sender,
            msg,
            reply,
            flow: 'saldo_check'
        });
        if (!resolution) return;
        const userId = resolution.canonicalJid;

        // Create user saldo if not exists
        saldoManager.createUserSaldo(userId);

        const saldo = await saldoManager.getUserSaldo(userId);
        const formattedSaldo = convertRupiah.convert(saldo);

        // Get recent transactions
        const transactions = saldoManager.getAllTransactions()
            .filter(tx => tx.userId === userId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 5);

        // Build riwayat section
        let riwayatSection = '';
        if (transactions.length > 0) {
            riwayatSection = `📜 *Riwayat Transaksi Terakhir:*\n`;
            transactions.forEach(tx => {
                const date = new Date(tx.created_at).toLocaleDateString('id-ID');
                const type = tx.type === 'credit' ? '✅' : '❌';
                const amount = convertRupiah.convert(tx.amount);
                riwayatSection += `${type} ${date} - ${tx.description} (${amount})\n`;
            });
        } else {
            riwayatSection = `_Belum ada transaksi_\n`;
        }

        // Gunakan template system untuk response cek saldo
        const { renderTemplate } = require('../../lib/templating');
        const message = renderTemplate('cek_saldo_response', {
            nama_pelanggan: pushname || 'User',
            nomor_hp: resolution.phoneNumber,
            formattedSaldo: formattedSaldo,
            riwayat_section: riwayatSection
        });

        await reply(message, { skipDuplicateCheck: true });
        logger.info(`Saldo check for ${userId}: ${saldo}`);

    } catch (error) {
        logger.error('Error in handleCekSaldo:', error);
        await reply(renderResponseTemplate(
            'saldo_cek_error',
            '❌ Maaf, terjadi kesalahan saat mengecek saldo. Silakan coba lagi.'
        ));
    }
}

/**
 * Handle topup saldo initiation
 * Supports keywords: topup, isi saldo, tambah saldo, topup saldo
 */
async function handleTopupInit(msg, sender, reply, pushname, conversationHandler) {
    try {
        const resolution = await resolveCanonicalSenderOrReply({
            sender,
            msg,
            reply,
            flow: 'topup_init'
        });
        if (!resolution) return;

        // Create user saldo if not exists
        saldoManager.createUserSaldo(resolution.canonicalJid);

        // Check if user already has pending topup (only active ones)
        const pendingTopup = saldoManager.getAllTopupRequests()
            .find(r => r.userId === resolution.canonicalJid &&
                (r.status === 'pending' || r.status === 'waiting_verification'));

        if (pendingTopup) {
            const amount = convertRupiah.convert(pendingTopup.amount);
            const status = pendingTopup.status === 'waiting_verification' ? 'Menunggu verifikasi admin' : 'Menunggu pembayaran';

            // Build rekening section
            let rekeningSection = '';
            let buktiSection = '';
            if (pendingTopup.paymentMethod === 'transfer' && pendingTopup.status === 'pending') {
                // Show bank accounts
                if (global.config?.bankAccounts && global.config.bankAccounts.length > 0) {
                    rekeningSection = `🏦 *Silakan transfer ke:*\n`;
                    global.config.bankAccounts.forEach(account => {
                        rekeningSection += `${account.bank}: ${account.number}`;
                        if (account.name) rekeningSection += ` a.n ${account.name}`;
                        rekeningSection += `\n`;
                    });
                    buktiSection = `\n📸 Kirim bukti transfer setelah melakukan pembayaran`;
                }
            }

            // Gunakan template system untuk info topup pending
            const { renderTemplate } = require('../../lib/templating');
            const message = renderTemplate('topup_pending_info', {
                jumlah: amount,
                metode_pembayaran: pendingTopup.paymentMethod,
                status: status,
                rekening_section: rekeningSection,
                bukti_section: buktiSection
            });

            return await reply(message, { skipDuplicateCheck: true });
        }

        // Start topup conversation flow
        conversationHandler.setUserState(sender, {
            step: 'TOPUP_SELECT_METHOD',
            type: 'topup',
            pushname: pushname,
            paymentSender: resolution.canonicalJid,
            phoneNumber: resolution.phoneNumber
        });

        // Gunakan template system untuk menu topup
        const { renderTemplate } = require('../../lib/templating');
        const message = renderTemplate('topup_init_menu', {
            nama_pelanggan: pushname || 'Kak'
        });

        await reply(message, { skipDuplicateCheck: true });

        // Don't notify admins yet - wait until user confirms the request

    } catch (error) {
        logger.error('Error in handleTopupInit:', error);
        await reply(renderResponseTemplate(
            'saldo_topup_init_error',
            '❌ Maaf, terjadi kesalahan. Silakan coba lagi.'
        ));
    }
}

/**
 * Handle cancel topup request
 */
async function handleCancelTopup(msg, sender, reply) {
    try {
        const resolution = await resolveCanonicalSenderOrReply({
            sender,
            msg,
            reply,
            flow: 'topup_cancel'
        });
        if (!resolution) return;

        const pendingTopup = saldoManager.getAllTopupRequests()
            .find(r => r.userId === resolution.canonicalJid && (r.status === 'pending' || r.status === 'waiting_verification'));

        if (!pendingTopup) {
            return await reply(renderResponseTemplate(
                'saldo_topup_cancel_not_found',
                'ℹ️ Anda tidak memiliki request topup yang aktif untuk dibatalkan.'
            ));
        }

        // Check remaining time
        const { getRemainingTime } = require('../../lib/topup-expiry');
        const remaining = getRemainingTime(pendingTopup);

        // Cancel the topup request using the proper function
        const success = saldoManager.cancelTopupRequest(pendingTopup.id);

        if (!success) {
            return await reply(renderResponseTemplate(
                'saldo_topup_cancel_failed',
                '❌ Gagal membatalkan request topup. Silakan coba lagi.'
            ), { skipDuplicateCheck: true });
        }

        // Build sisa waktu section
        let sisaWaktuSection = '';
        if (!remaining.expired) {
            sisaWaktuSection = `Sisa waktu: ${remaining.text}\n`;
        }

        // Gunakan template system untuk notifikasi cancel topup
        const { renderTemplate } = require('../../lib/templating');
        const message = renderTemplate('topup_cancelled', {
            request_id: pendingTopup.id,
            jumlah: pendingTopup.amount.toLocaleString('id-ID'),
            sisa_waktu_section: sisaWaktuSection
        });

        await reply(message, { skipDuplicateCheck: true });

    } catch (error) {
        logger.error('Error in handleCancelTopup:', error);
        await reply(renderResponseTemplate(
            'saldo_topup_cancel_error',
            '❌ Terjadi kesalahan saat membatalkan topup'
        ));
    }
}

/**
 * Handle voucher purchase with saldo
 */
async function handleBeliVoucher(msg, sender, reply, pushname) {
    try {
        const resolution = await resolveCanonicalSenderOrReply({
            sender,
            msg,
            reply,
            flow: 'voucher_purchase'
        });
        if (!resolution) return;
        const userId = resolution.canonicalJid;

        // Create user saldo if not exists
        await saldoManager.createUserSaldo(userId);

        const currentSaldo = await saldoManager.getUserSaldo(userId);

        if (currentSaldo <= 0) {
            return await reply(renderResponseTemplate(
                'saldo_voucher_insufficient',
                '❌ Saldo Anda tidak mencukupi. Silakan topup terlebih dahulu.'
            ));
        }

        // Get available vouchers
        const vouchers = global.voucher || [];

        if (vouchers.length === 0) {
            return await reply(renderResponseTemplate(
                'saldo_voucher_no_available',
                '❌ Maaf, tidak ada voucher yang tersedia saat ini.'
            ), { skipDuplicateCheck: true });
        }

        // Build voucher list
        let voucherList = '';
        vouchers.forEach((v, index) => {
            const price = convertRupiah.convert(v.harga || 0);
            const canBuy = currentSaldo >= (v.harga || 0) ? '✅' : '❌';
            voucherList += `${index + 1}. ${v.nama} - ${v.durasi}\n`;
            voucherList += `   Harga: ${price} ${canBuy}\n`;
        });

        // Gunakan template system untuk menu beli voucher
        const { renderTemplate } = require('../../lib/templating');
        const message = renderTemplate('beli_voucher_menu', {
            formattedSaldo: convertRupiah.convert(currentSaldo),
            voucher_list: voucherList
        });

        // Set conversation state for voucher purchase
        const conversationHandler = require('../handlers/conversation-handler');
        conversationHandler.setUserState(sender, {
            step: 'VOUCHER_SELECT',
            type: 'voucher_purchase',
            vouchers: vouchers
        });

        await reply(message);

    } catch (error) {
        logger.error('Error in handleBeliVoucher:', error);
        await reply(renderResponseTemplate(
            'saldo_voucher_buy_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
    }
}

/**
 * Handle transfer saldo between users
 */
async function handleTransferSaldo(msg, sender, reply, args) {
    try {
        if (args.length < 2) {
            return await reply(renderResponseTemplate(
                'saldo_transfer_format_invalid',
                '❌ Format: transfer [nomor] [jumlah]\nContoh: transfer 6281234567890 50000'
            ));
        }

        const resolution = await resolveCanonicalSenderOrReply({
            sender,
            msg,
            reply,
            flow: 'saldo_transfer'
        });
        if (!resolution) return;
        const senderId = resolution.canonicalJid;

        const targetNumber = args[0].replace(/[^0-9]/g, '');
        const amount = parseInt(args[1]);

        if (isNaN(amount) || amount <= 0) {
            return await reply(renderResponseTemplate(
                'saldo_transfer_amount_invalid',
                '❌ Jumlah transfer tidak valid'
            ));
        }

        const targetId = normalizePhoneToJid(targetNumber);

        const senderSaldo = await saldoManager.getUserSaldo(senderId);

        if (senderSaldo < amount) {
            const saldoAnda = convertRupiah.convert(senderSaldo);
            return await reply(renderResponseTemplate(
                'saldo_transfer_insufficient',
                `❌ Saldo tidak mencukupi\nSaldo Anda: ${saldoAnda}`,
                { saldo_anda: saldoAnda }
            ));
        }

        // Process transfer
        const success = await saldoManager.transferSaldo(senderId, targetId, amount);

        if (success) {
            const newSaldo = await saldoManager.getUserSaldo(senderId);
            const jumlahFmt = convertRupiah.convert(amount);
            const sisaSaldoFmt = convertRupiah.convert(newSaldo);
            await reply(renderResponseTemplate(
                'saldo_transfer_success',
                `✅ Transfer berhasil!\n\nKe: ${targetNumber}\nJumlah: ${jumlahFmt}\nSisa saldo: ${sisaSaldoFmt}`,
                { target_number: targetNumber, jumlah: jumlahFmt, sisa_saldo: sisaSaldoFmt }
            ));

            // Notify recipient if they have WhatsApp
            // PENTING: Cek connection state dan gunakan error handling sesuai rules
            if (isReady()) {
                try {
                    const { renderTemplate } = require('../../lib/templating');
                    const recipientSaldo = await saldoManager.getUserSaldo(targetId);

                    // Dapatkan nama pengirim (pushname atau nomor HP, bukan @lid)
                    let namaPengirim = resolution.phoneNumber;

                    // Coba ambil pushname dari database user jika ada
                    if (global.users && Array.isArray(global.users)) {
                        const senderUser = global.users.find(u => {
                            const userPhone = u.phone_number ? u.phone_number.replace(/[^0-9]/g, '') : '';
                            const senderPhone = resolution.phoneNumber.replace(/[^0-9]/g, '');
                            return userPhone === senderPhone || userPhone === senderPhone.replace('62', '0');
                        });

                        if (senderUser && senderUser.name) {
                            namaPengirim = senderUser.name;
                        }
                    }

                    // Jika masih @lid atau format aneh, coba ambil dari msg.pushName atau gunakan nomor HP
                    if (namaPengirim.includes('@lid') || namaPengirim.includes(':')) {
                        // Gunakan nomor HP yang sudah dinormalisasi
                        namaPengirim = resolution.phoneNumber.replace(/[^0-9]/g, '');
                    }

                    // Jika msg tersedia, coba ambil pushname dari message
                    if (msg && msg.pushName) {
                        namaPengirim = msg.pushName;
                    }

                    const message = renderTemplate('transfer_saldo_masuk', {
                        jumlah: convertRupiah.convert(amount),
                        nama_pengirim: namaPengirim,
                        formattedSaldo: convertRupiah.convert(recipientSaldo)
                    });

                    const delivery = await sendMessage(targetId, { text: message });
                    if (!delivery.sent) {
                        throw new Error(delivery.warning || delivery.errorCode || 'SEND_FAILED');
                    }
                } catch (error) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        targetId,
                        error: error.message
                    });
                    logger.error('Failed to send transfer notification to recipient:', error);
                    // Jangan throw - notification tidak critical
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', targetId);
                logger.warn('Cannot send transfer notification - WhatsApp not connected');
            }
        } else {
            await reply(renderResponseTemplate(
                'saldo_transfer_failed',
                '❌ Transfer gagal. Silakan coba lagi.'
            ));
        }

    } catch (error) {
        logger.error('Error in handleTransferSaldo:', error);
        await reply(renderResponseTemplate(
            'saldo_transfer_error',
            '❌ Terjadi kesalahan saat transfer. Silakan coba lagi.'
        ));
    }
}

module.exports = {
    handleCekSaldo,
    handleTopupInit,
    handleCancelTopup,
    handleBeliVoucher,
    handleTransferSaldo
};
