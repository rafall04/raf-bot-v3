/**
 * Billing Management Handler
 * Handles billing checks and package changes
 */

const convertRupiah = require('rupiah-format');

const { getUserState, setUserState, deleteUserState } = require('./conversation-handler');
const { resolveCustomerBySender } = require('../../lib/jid-utils');

/**
 * Handle check billing
 */
async function handleCekTagihan({ plainSenderNumber, pushname, reply, mess, global, renderTemplate, msg, raf, sender }) {
    try {
        const { user } = await resolveCustomerBySender({
            users: global.users,
            sender,
            msg,
            plainSenderNumber,
            raf
        });

        // Handle @lid users - no manual verification needed
        if (!user && sender && sender.endsWith('@lid')) {
            return reply(`❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`);
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
        const packagePrice = packageInfo ? parseInt(packageInfo.price) : 0;

        // 4. Check paid status and build response using templates
        const templateData = {
            nama_pelanggan: user.name || pushname,
            nama_paket: packageName,
            harga: packagePrice
        };

        let responseMessage;
        if (user.paid) {
            responseMessage = renderTemplate('tagihan_lunas', templateData);
        } else {
            responseMessage = renderTemplate('tagihan_belum_lunas', templateData);
        }

        await reply(responseMessage);

    } catch (error) {
        console.error('[CEK_TAGIHAN] Error:', error);
        await reply('Terjadi kesalahan saat mengecek tagihan. Silakan coba lagi.');
    }
}

/**
 * Handle package change request
 */
async function handleUbahPaket({ plainSenderNumber, reply, mess, global, temp, msg, raf, sender }) {
    try {
        const { user, plainSenderNumber: resolvedPlainSenderNumber } = await resolveCustomerBySender({
            users: global.users,
            sender,
            msg,
            plainSenderNumber,
            raf
        });

        // Handle @lid users - no manual verification needed
        if (!user && sender && sender.endsWith('@lid')) {
            return reply(`❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`);
        }

        if (!user) {
            return reply(mess.userNotRegister);
        }

        if (user.subscription === 'PAKET-VOUCHER') {
            return reply(mess.onlyMonthly);
        }

        const existingRequest = global.packageChangeRequests.find(
            r => r.userId === user.id && r.status === 'pending'
        );

        if (existingRequest) {
            return reply(`Anda sudah memiliki permintaan perubahan paket ke *${existingRequest.requestedPackageName}* yang sedang diproses. Mohon tunggu hingga permintaan tersebut diselesaikan oleh Admin.`);
        }

        // Build package list
        const packages = global.packages || [];
        const currentPackageIndex = packages.findIndex(p => p.name === user.subscription);
        const availablePackages = packages.filter((p, index) => index !== currentPackageIndex);

        if (availablePackages.length === 0) {
            return reply("Tidak ada paket lain yang tersedia untuk dipilih.");
        }

        const packageList = availablePackages.map((pkg, index) =>
            `${index + 1}. *${pkg.name}* - ${convertRupiah.convert(pkg.price)}/bulan`
        ).join('\n');

        // Set state to ask for package choice
        const senderJid = resolvedPlainSenderNumber + '@s.whatsapp.net';
        setUserState(senderJid, {
            step: 'ASK_PACKAGE_CHOICE',
            userId: user.id,
            availablePackages
        });

        const replyText = `*UBAH PAKET INTERNET*\n\nPaket Anda saat ini: *${user.subscription}*\n\nPilih paket baru:\n${packageList}\n\nBalas dengan nomor pilihan Anda (1-${availablePackages.length})`;
        await reply(replyText);

    } catch (error) {
        console.error('[UBAH_PAKET] Error:', error);
        await reply('Terjadi kesalahan saat memproses permintaan ubah paket. Silakan coba lagi.');
    }
}

module.exports = {
    handleCekTagihan,
    handleUbahPaket
};
