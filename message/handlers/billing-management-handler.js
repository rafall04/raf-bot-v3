/**
 * Header Doc
 * Purpose: Handler cek tagihan customer-facing lewat perintah WhatsApp.
 * Caller: Dispatcher bot `message/raf.js` pada intent `CEK_TAGIHAN`. (UBAH_PAKET live =
 *         `package-management-handler`; salinan di sini ter-shadow & dihapus — double-owner.)
 * Deps: `rupiah-format`, `./template-helpers` (renderResponseTemplate).
 * MainFuncs: `handleCekTagihan`.
 * SideEffects: Mengirim reply WhatsApp berisi status tagihan + link bayar.
 */

const log = require('../../lib/logger').logger.child('BILLING_MANAGEMENT_HANDLER');
const convertRupiah = require('rupiah-format');

const { renderResponseTemplate } = require('./template-helpers');
const { resolveCustomerBySender } = require('../../lib/jid-utils');
const { buildBillPayUrl } = require('../../lib/bill-pay-token');

/**
 * Handle check billing
 */
async function handleCekTagihan({ plainSenderNumber: _plainSenderNumber, pushname, reply, mess, global, renderTemplate, msg, raf, sender }) {
    try {
        // Resolusi pelanggan terpadu (LID-aware: remoteJidAlt → getPNForLID → stored-mapping → pre-warm USync).
        const { user } = await resolveCustomerBySender({ users: global.users, sender, msg, raf });

        // Handle @lid users - no manual verification needed
        if (!user && sender && sender.endsWith('@lid')) {
            return reply(renderResponseTemplate(
                'billing_lid_not_registered',
                `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`
            ));
        }

        if (!user) {
            return reply(mess.userNotRegister);
        }

        // 2. Check if user is a monthly subscriber
        if (user.subscription === 'PAKET-VOUCHER') {
            return reply(mess.onlyMonthly);
        }

        // 3. Find package details
        const packageInfo = global.packages.find(p => p.name === user.subscription);
        const packageName = packageInfo ? packageInfo.name : "Tidak Diketahui";
        // Harga EFEKTIF (subscription_price per-pelanggan + diskon aktif), satu sumber dengan
        // ledger pembayaran — bukan harga paket mentah yang salah untuk pelanggan berharga khusus.
        const { getEffectivePrice, getPaymentPositionForPeriod } = require('../../lib/payment-finance-service');
        // TANPA fallback ke harga paket: nilai 0 dari getEffectivePrice adalah jawaban SAH
        // (paket gratis / diskon 100%) dan tak boleh diganti harga penuh.
        const hargaEfektif = getEffectivePrice(user);

        // SISA tagihan, bukan harga penuh. Pelanggan yang sudah mencicil dulu tetap melihat angka
        // penuh + "BELUM LUNAS" — dari sisinya uang yang sudah diserahkan seperti hilang.
        // Sumber kebenarannya ledger (`payment_history` − reversal, dikurangi waiver), sama dengan
        // yang dipakai penagihan.
        //
        // GAGAL-TERTUTUP: kalau ledger tak terbaca, JANGAN menebak — pakai harga efektif seperti
        // perilaku lama. Menampilkan sisa yang salah di layar tagihan lebih berbahaya daripada
        // menampilkan angka penuh yang sudah dikenal pelanggan.
        const now = new Date();
        let tagihan = hargaEfektif;
        let sudahDibayar = 0;
        try {
            const posisi = await getPaymentPositionForPeriod(
                user, now.getMonth() + 1, now.getFullYear(), { amountDue: hargaEfektif }
            );
            if (posisi && Number.isFinite(Number(posisi.outstanding))) {
                tagihan = Math.max(0, Number(posisi.outstanding));
                sudahDibayar = Math.max(0, hargaEfektif - tagihan);
            }
        } catch (posErr) {
            log.warn('[CEK_TAGIHAN] Posisi ledger tak terbaca, pakai harga efektif:', posErr && posErr.message);
        }

        // Slot cicilan: string KOSONG bila tak ada cicilan, supaya template tak menampilkan
        // baris menggantung untuk pelanggan biasa.
        const cicilanInfo = sudahDibayar > 0
            ? `\n\n💰 Sudah dibayar: *${convertRupiah.convert(sudahDibayar)}* — sisa yang tertera di atas.`
            : '';

        // 4. Check paid status and build response using templates
        const templateData = {
            nama_pelanggan: user.name || pushname,
            nama_paket: packageName,
            harga: tagihan,
            cicilan_info: cicilanInfo
        };

        let responseMessage;
        if (user.paid) {
            responseMessage = renderTemplate('tagihan_lunas', templateData);
        } else {
            // Link bayar mandiri (QRIS/VA/retail) — token bertanda-tangan, tanpa login.
            const now = new Date();
            let linkBayar = '';
            try {
                linkBayar = buildBillPayUrl(user, { periodMonth: now.getMonth() + 1, periodYear: now.getFullYear() });
            } catch (linkErr) {
                log.error('[CEK_TAGIHAN] Gagal buat link bayar:', linkErr.message);
            }
            responseMessage = renderTemplate('tagihan_belum_lunas', { ...templateData, link_bayar: linkBayar });
        }

        await reply(responseMessage);

    } catch (error) {
        log.error('[CEK_TAGIHAN] Error:', error);
        await reply(renderResponseTemplate(
            'billing_check_generic_error',
            'Terjadi kesalahan saat mengecek tagihan. Silakan coba lagi.'
        ));
    }
}

module.exports = {
    handleCekTagihan
};
