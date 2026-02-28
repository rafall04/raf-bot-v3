/**
 * Package Management Handler
 * Handles package changes and speed boost requests
 */

const convertRupiah = require('rupiah-format');
const { resolveCustomerBySender } = require("../../lib/jid-utils");

const { getUserState, setUserState, deleteUserState } = require('./conversation-handler');

/**
 * Handle package change request
 */
async function handleUbahPaket({ sender, plainSenderNumber, pushname, reply, mess, global, msg, raf }) {
    try {
        const user = await resolveCustomerBySender({ users: global.users, sender, msg, raf });


        if (user.subscription === 'PAKET-VOUCHER') {
            return reply(mess.onlyMonthly);
        }

        const existingRequest = global.packageChangeRequests.find(
            r => r.userId === user.id && r.status === 'pending'
        );

        if (existingRequest) {
            return reply(`Anda sudah memiliki permintaan perubahan paket ke *${existingRequest.requestedPackageName}* yang sedang diproses. Mohon tunggu hingga permintaan tersebut diselesaikan oleh Admin.`);
        }

        const currentUserPackagePrice = global.packages.find(p => p.name === user.subscription)?.price || 0;

        const availablePackages = global.packages.filter(
            p => p.isSpeedBoost &&
                p.name !== user.subscription &&
                p.name !== 'PAKET-VOUCHER' &&
                p.name !== 'PAKET-KHUSUS'
        );

        const upgradePackages = availablePackages.filter(p => p.price > currentUserPackagePrice);
        const downgradePackages = availablePackages.filter(p => p.price < currentUserPackagePrice);

        let replyText = `Halo Kak ${pushname},\n\nAnda dapat mengubah paket langganan Anda. Paket Anda saat ini adalah *${user.subscription}*.\n\n`;

        let optionCounter = 1;
        if (upgradePackages.length > 0) {
            replyText += "📈 *Pilihan Upgrade:*\n";
            upgradePackages.forEach(p => {
                replyText += `  *${optionCounter}.* *${p.name}* (${p.profile}) - ${convertRupiah.convert(p.price)}\n`;
                optionCounter++;
            });
        }

        if (downgradePackages.length > 0) {
            replyText += "\n📉 *Pilihan Downgrade:*\n";
            downgradePackages.forEach(p => {
                replyText += `  *${optionCounter}.* *${p.name}* (${p.profile}) - ${convertRupiah.convert(p.price)}\n`;
                optionCounter++;
            });
        }

        if (availablePackages.length === 0) {
            return reply("Maaf, saat ini tidak ada pilihan paket lain yang tersedia untuk Anda.");
        }

        replyText += "\nSilakan balas dengan *nomor* paket yang Anda inginkan (contoh: `1`). Atau ketik *batal* untuk membatalkan.";

        setUserState(sender, {
            step: 'ASK_PACKAGE_CHOICE',
            user: user,
            options: availablePackages // The options are already ordered correctly
        });

        return reply(replyText);

    } catch (error) {
        console.error('[UBAH_PAKET] Error:', error);
        await reply('Terjadi kesalahan saat memproses permintaan ubah paket. Silakan coba lagi.');
    }
}

/**
 * Handle speed boost request
 */
async function handleRequestSpeedBoost({ sender, plainSenderNumber, pushname, reply, mess, global, temp, msg, raf }) {
    try {
        const user = await resolveCustomerBySender({ users: global.users, sender, msg, raf });


        if (user.subscription === 'PAKET-VOUCHER') {
            return reply(mess.onlyMonthly);
        }

        const activeBoost = global.speed_requests.find(
            r => r.userId === user.id && r.status === 'active'
        );

        if (activeBoost) {
            return reply(`Anda sudah memiliki Speed on Demand yang aktif untuk paket *${activeBoost.requestedPackageName}* dan akan berakhir pada ${new Date(activeBoost.expirationDate).toLocaleString('id-ID')}.`);
        }

        const pendingBoost = global.speed_requests.find(
            r => r.userId === user.id && r.status === 'pending'
        );

        if (pendingBoost) {
            return reply(`Anda sudah memiliki permintaan Speed on Demand untuk paket *${pendingBoost.requestedPackageName}* yang sedang menunggu persetujuan admin.`);
        }

        const currentUserPackage = global.packages.find(p => p.name === user.subscription);
        const currentUserPrice = currentUserPackage ? (Number(currentUserPackage.price) || 0) : 0;

        const sodPackages = global.packages.filter(
            p => p.isSpeedBoost && (Number(p.price) || 0) > currentUserPrice
        );

        if (sodPackages.length === 0) {
            return reply("Maaf, tidak ada paket speed boost yang tersedia untuk langganan Anda saat ini.");
        }

        let replyText = `Halo Kak ${pushname},\n\nAnda dapat mengaktifkan *Speed on Demand* untuk meningkatkan kecepatan internet selama 1 hari.\n\n`;
        replyText += `Paket Anda saat ini: *${user.subscription}*\n\n`;
        replyText += `*Pilihan Paket Speed Boost:*\n`;

        let sodOptions = global.sod; // This should be the SOD pricing structure

        sodPackages.forEach((p, index) => {
            // Find SOD price for this package
            let sodPrice = 0;
            const sodEntry = Object.values(sodOptions).find(
                sod => sod.paket === p.name
            );

            if (sodEntry) {
                sodPrice = sodEntry['1'] || sodEntry['sod_1_hari'] || sodEntry.harga || 0;
            }

            const formattedPrice = convertRupiah.convert(sodPrice);
            replyText += `  *${index + 1}.* *${p.name}* (${p.profile}) - ${formattedPrice} / 1 hari\n`;
        });

        replyText += "\nSilakan balas dengan *nomor* paket yang Anda inginkan (contoh: `1`). Atau ketik *batal* untuk membatalkan.";

        setUserState(sender, {
            step: 'SELECT_SOD_CHOICE',
            user: user,
            options: sodPackages
        });

        return reply(replyText);

    } catch (error) {
        console.error('[REQUEST_SPEED_BOOST] Error:', error);
        await reply('Terjadi kesalahan saat memproses permintaan speed boost. Silakan coba lagi.');
    }
}

module.exports = {
    handleUbahPaket,
    handleRequestSpeedBoost
};
