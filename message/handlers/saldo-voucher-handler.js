/**
 * Saldo & Voucher Handler
 * Menangani operasi saldo dan voucher
 */

const convertRupiah = require('rupiah-format');
const { checkATMuser } = require('../../lib/saldo');

/**
 * Handle cek saldo
 */
async function handleCekSaldo(sender, pushname, config, format, reply) {
    // sender sudah dinormalisasi dari @lid ke format standar di raf.js
    // Jadi langsung gunakan sender tanpa normalisasi ulang
    let userId = sender;
    
    // Pastikan userId tidak mengandung :0 atau format aneh lainnya
    if (userId && userId.includes(':')) {
        userId = userId.split(':')[0];
        if (!userId.endsWith('@s.whatsapp.net')) {
            userId = userId + '@s.whatsapp.net';
        }
    }
    
    const currentNumericSaldo = await checkATMuser(userId);
    const formattedSaldo = convertRupiah.convert(currentNumericSaldo);
    const namaLayanan = config.nama || "Layanan Kami";
    const namaBot = config.namabot || "Bot Kami";

    let pesanKondisional = (currentNumericSaldo < 2000)
        ? format('cek_saldo_menipis', { formattedSaldo })
        : format('cek_saldo_cukup', { formattedSaldo });

    reply(format('cek_saldo', {
        nama_layanan: namaLayanan,
        pushname,
        formattedSaldo,
        pesanKondisional,
        nama_bot: namaBot
    }));
}

/**
 * Handle tanya harga voucher
 */
function handleTanyaHargaVoucher(pushname, config, voucher, format, reply) {
    const namaLayanan = config.nama || "Layanan Kami";
    const adminWaLink = `https://wa.me/${config.ownerNumber && config.ownerNumber[0] ? config.ownerNumber[0].replace(/\D/g, '') : '6285233047094'}`;

    let voucherListString = "";
    if (voucher && voucher.length > 0) {
        voucher.forEach(v => {
            const hargaFormatted = parseInt(v.hargavc) ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(parseInt(v.hargavc)) : `Rp ${v.hargavc}`;
            voucherListString += `  • 💸 ${v.namavc || 'Voucher'} ${v.durasivc ? `(${v.durasivc})` : ''} - *${hargaFormatted}*\n`;
        });
    } else {
        voucherListString = "Oops! Saat ini belum ada daftar voucher yang tersedia. Silakan cek kembali nanti atau hubungi Admin.\n";
    }

    const contohHargaVoucher = voucher && voucher.length > 0 ? voucher[0].hargavc : '1000';
    const contohHargaRupiah = voucher && voucher.length > 0 ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(parseInt(voucher[0].hargavc)) : 'Rp 1.000';
    
    reply(format('tanya_harga_voucher', {
        nama_layanan: namaLayanan,
        pushname,
        voucherListString: voucherListString.trim(),
        contoh_harga_voucher: contohHargaVoucher,
        contoh_harga_rupiah: contohHargaRupiah,
        adminWaLink
    }));
}

/**
 * Handle list voucher vc123
 */
function handleVc123(config, voucher, reply) {
    let txtx = `List Harga Voucher 「 *${config.nama}* 」\n==================================\n\n`;
    for (let i of voucher){
        txtx += `${i.namavc} = Rp. ${i.hargavc}\n`;
    }
    txtx += `\n==================================\nCara Pembelian Voucher Silahkan Ketik : \n*belivoucher [harga]*\ncontoh : _*belivoucher 1500*_\nCara Topup Saldo Silahkan Ketik : _*tutorial*_\n==================================\nNOTE :\nHarga Voucher Bisa Berubah Sewaktu-Waktu.\n_Jika ada pertanyaan, chat admin di bawah_\nWhatsapp : https://wa.me/6285233047094\n==================================\n\nTerima Kasih\n${config.namabot}`;
    reply(txtx);
}

/**
 * Handle topup saldo
 */
function handleTopupSaldo(sender, pushname, config, format, reply) {
    const namaLayanan = config.nama || "Layanan Kami";
    const namaBot = config.namabot || "Bot Kami";
    
    reply(format('topup_saldo_start', {
        nama_layanan: namaLayanan,
        pushname,
        nama_bot: namaBot
    }));
}

module.exports = {
    handleCekSaldo,
    handleTanyaHargaVoucher,
    handleVc123,
    handleTopupSaldo
};
