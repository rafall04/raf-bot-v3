/**
 * Payment Processor Handler
 * Menangani proses pembayaran topup dan pembelian voucher
 */

const qr = require('qr-image');
const convertRupiah = require('rupiah-format');
const { extractSenderInfo, resolveCustomerBySender } = require('../../lib/lid-handler');

/**
 * Handle topup saldo and buynow
 */
async function handleTopupSaldoPayment({ sender, pushname, command, q, from, msg, reply, raf, pay, checkprofvc, checkhargavoucher, checkhargavc, addPayment }) {
    const senderInfo = extractSenderInfo(msg, sender);
    const canonicalId = senderInfo.canonicalId;
    const phoneNum = senderInfo.phoneNumber;
    if (!q) throw `contoh penggunaan: topup 10000`;

    let number = parseInt(q);
    if (command == "topup" && (isNaN(number) || number < 1000 || number > 1_000_000)) {
        throw `Jumlah topup invalid!\nMinimum topup Rp. 1000 & Maksimal topup Rp. 1.000.000`;
    }

    const reff = Math.floor(Math.random() * 1677721631342).toString(16);
    let profvc = checkprofvc(q);

    if (command == "buynow") {
        if (!checkhargavoucher(q)) {
            throw `Harga Voucher Tersebut Tidak Terdaftar. Silahkan Periksa Lagi.\n\nTerima Kasih`;
        }
        number = checkhargavc(profvc);
    }

    const res = await pay({
        amount: number,
        reffId: reff,
        comment: command == 'topup'
            ? `Topup dana saldo sebesar Rp. ${number}`
            : command == 'buynow'
                ? `pembelian voucher ${profvc} sebesar Rp. ${number}`
                : '',
        name: pushname,
        phone: phoneNum,
        email: canonicalId,
    });

    // Gunakan template system untuk info QRIS payment
    const { renderTemplate } = require('../../lib/templating');
    const text = renderTemplate('qris_payment_info', {
        sub_total: res.subTotal.toLocaleString('id-ID'),
        biaya_admin: res.fee.toLocaleString('id-ID'),
        total_bayar: res.total.toLocaleString('id-ID')
    });

    await addPayment(reff, res.id, canonicalId, command, number, 'QRIS', `Topup ${number} to ${canonicalId}`);

    let qrr = await qr.imageSync(res.qrString, { type: "png", ec_level: 'H' });

    try {
        if (global.whatsappConnectionState === 'open') {
            await raf.sendMessage(from, { image: qrr, caption: text }, { quoted: msg, skipDuplicateCheck: true });
        }
    } catch (error) {
        console.error('[QRIS_PAYMENT] Error sending QRIS payment info:', error);
    }
}

/**
 * Fungsi terpusat untuk memproses pembelian voucher.
 * @param {string} sender - JID pengirim (canonical diprioritaskan)
 * @param {string} pushname - Nama pushname pengirim
 * @param {string} price - Harga voucher yang akan dibeli
 * @param {function} replyFunc - Fungsi untuk membalas pesan
 * @param {object} helpers - Helper functions (checkhargavoucher, checkprofvc, etc)
 * @param {object} global - Global object
 */
async function processVoucherPurchase(sender, pushname, price, replyFunc, helpers, global) {
    // Pastikan menggunakan canonical ID untuk operasi saldo dan voucher
    const canonicalId = resolveCustomerBySender(sender);
    const { checkhargavoucher, checkprofvc, checkdurasivc, checkhargavc, checkATMuser, confirmATM, getvoucher } = helpers;

    // Cek apakah harga voucher terdaftar
    if (!checkhargavoucher(price)) {
        await replyFunc(`Harga Voucher Rp ${price} Tidak Terdaftar. Silahkan Periksa Lagi.\n\nTerima Kasih`);
        return;
    }

    const profvc123 = checkprofvc(price);
    const durasivc123 = checkdurasivc(profvc123);
    const hargavc123 = checkhargavc(profvc123);

    // Cek saldo pengguna menggunakan canonical ID
    const currentSaldo = await checkATMuser(canonicalId);
    if (currentSaldo < hargavc123) {
        await replyFunc(`Saldo Anda tidak mencukupi untuk melakukan pembelian voucher seharga ${convertRupiah.convert(hargavc123)}. Silakan top up saldo terlebih dahulu.`);
        return;
    }

    try {
        await replyFunc("⏳ Sedang memproses pembelian voucher Anda, mohon tunggu sebentar...");

        const voucherData = await getvoucher(profvc123, canonicalId);
        const voucherCode = `${voucherData.username}`;

        // Konfirmasi pengurangan saldo (async) menggunakan canonical ID
        await confirmATM(canonicalId, hargavc123);
        const currentSaldoAfterPurchase = await checkATMuser(canonicalId);
        const formattedSaldoAfterPurchase = convertRupiah.convert(currentSaldoAfterPurchase);

        // Pesan sukses
        await replyFunc(`🎉 *Hore! Voucher Berhasil Dibeli!* 🎉\n\n=============================\n*Paket:* ${durasivc123}\n\n*Kode Voucher:* \`${voucherCode}\`\n\n*Sisa Saldo:* ${formattedSaldoAfterPurchase}\n=============================\nTerimakasih Atas Pembelian Anda\n\n${global.config.nama}!`);

    } catch (err) {
        console.error("[processVoucherPurchase_ERROR]", err);
        let userFriendlyErrorMessage = "Terjadi kesalahan saat membuat voucher. ";
        if (err.message) {
            if (err.message.includes("Kesalahan Koneksi Mikrotik")) {
                userFriendlyErrorMessage += "Bot gagal terhubung ke Mikrotik. Mohon laporkan ke Admin.";
            } else if (err.message.includes("Profil Hotspot yang dimasukkan salah atau tidak ditemukan")) {
                userFriendlyErrorMessage += "Profil voucher yang Anda pilih tidak valid. Mohon hubungi Admin.";
            } else if (err.message.includes("Voucher dengan username ini") || err.message.includes("already have user with this name")) {
                userFriendlyErrorMessage += "Terjadi duplikasi username saat membuat voucher. Mohon coba lagi atau hubungi Admin.";
            } else if (err.message.includes("data username/password tidak ditemukan")) {
                userFriendlyErrorMessage += "Voucher berhasil dibuat, namun bot gagal mendapatkan username/passwordnya. Mohon laporkan ke Admin.";
            } else {
                userFriendlyErrorMessage += `Detail: ${err.message || 'Error tidak diketahui'}. Mohon coba lagi atau hubungi Admin.`;
            }
        }
        await replyFunc(`🚫 *PEMBELIAN VOUCHER GAGAL* 🚫\n=============================\n${userFriendlyErrorMessage}\n=============================\n_Mohon coba lagi nanti atau hubungi tim support kami._`);
    }
}

/**
 * Handle beli voucher
 */
/**
 * Handle beli voucher
 */
async function handleBeliVoucher({ msg, sender, normalizedSenderForPayment, pushname, entities, q, reply, temp, global, helpers }) {
    const senderInfo = extractSenderInfo(msg, sender);
    const canonicalId = senderInfo.canonicalId;
    const paymentSender = normalizedSenderForPayment || canonicalId;
    const hargaVoucher = entities.harga_voucher || q;

    if (hargaVoucher) {
        // Jika harga ada, langsung proses
        await processVoucherPurchase(paymentSender, pushname, hargaVoucher, reply, helpers, global);
    } else {
        // Jika tidak ada harga, mulai percakapan menggunakan canonicalId untuk state
        temp[canonicalId] = {
            step: 'ASK_VOUCHER_CHOICE',
            paymentSender: paymentSender
        };

        let voucherListString = "";
        if (global.voucher && global.voucher.length > 0) {
            global.voucher.forEach(v => {
                const hargaFormatted = parseInt(v.hargavc) ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(parseInt(v.hargavc)) : `Rp ${v.hargavc}`;
                voucherListString += `  • 💸 ${v.namavc || 'Voucher'} (${v.durasivc || 'N/A'}) - *${hargaFormatted}*\n`;
            });
        } else {
            voucherListString = "Maaf, saat ini tidak ada voucher yang tersedia.\n";
        }

        const message = `Tentu, Kak ${pushname}! Mau beli voucher yang mana?\n\n*Pilihan Voucher Tersedia:*\n${voucherListString}\nSilakan balas dengan *harga* voucher yang ingin dibeli (contoh: \`1000\`).\n\nAtau ketik *batal* untuk membatalkan.`;
        reply(message);
    }
}

module.exports = {
    handleTopupSaldoPayment,
    handleBeliVoucher,
    processVoucherPurchase
};
