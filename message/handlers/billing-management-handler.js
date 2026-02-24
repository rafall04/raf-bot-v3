/**
 * Billing Management Handler
 * Handles billing checks and package changes
 */

const convertRupiah = require('rupiah-format');

const { getUserState, setUserState, deleteUserState } = require('./conversation-handler');

/**
 * Handle check billing
 */
async function handleCekTagihan({ plainSenderNumber, pushname, reply, mess, global, renderTemplate, msg, raf, sender }) {
    try {
        let optionalJid = null;
        if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
            optionalJid = msg.key.remoteJidAlt.split('@')[0].split(':')[0];
            plainSenderNumber = optionalJid;
        } else if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
            optionalJid = msg.participant.split('@')[0].split(':')[0];
            plainSenderNumber = optionalJid;
        }

        const user = global.users.find(u => {
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
        let optionalJid = null;
        if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
            optionalJid = msg.key.remoteJidAlt.split('@')[0].split(':')[0];
            plainSenderNumber = optionalJid;
        } else if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
            optionalJid = msg.participant.split('@')[0].split(':')[0];
            plainSenderNumber = optionalJid;
        }

        const user = global.users.find(u => {
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
        const senderJid = plainSenderNumber + '@s.whatsapp.net';
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
