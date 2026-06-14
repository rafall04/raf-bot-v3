/**
 * Header Doc
 * Purpose: Handler customer-facing untuk ubah paket bulanan dan request Speed on Demand (SOD).
 * Caller: Dispatcher bot `message/raf.js` pada intent `UBAH_PAKET` (variant speed-boost) dan `REQUEST_SPEED_BOOST`.
 * Deps: `rupiah-format`, `./conversation-handler`, `./template-helpers` (renderResponseTemplate).
 * MainFuncs: `handleUbahPaket`, `handleRequestSpeedBoost`.
 * SideEffects: Menyimpan state pilihan paket dan mengirim reply WhatsApp.
 */

const convertRupiah = require('rupiah-format');

const { getUserState: _getUserState, setUserState, deleteUserState: _deleteUserState } = require('./conversation-handler');
const { renderResponseTemplate } = require('./template-helpers');
const { resolveCustomerBySender } = require('../../lib/jid-utils');

/**
 * Handle package change request
 */
async function handleUbahPaket({ sender, stateSender, plainSenderNumber: _plainSenderNumber, pushname, reply, mess, global, msg, raf }) {
    try {
        // stateKey = JID kanonik untuk key state (router membaca state via stateSender);
        // sender mentah tetap dipakai untuk resolusi pelanggan @lid.
        const stateKey = stateSender || sender;
        // Resolusi pelanggan terpadu (LID-aware: remoteJidAlt → getPNForLID → stored-mapping → pre-warm USync).
        const { user } = await resolveCustomerBySender({ users: global.users, sender, msg, raf });

        // Handle @lid users - no manual verification needed
        if (!user && sender.endsWith('@lid')) {
            return reply(renderResponseTemplate(
                'package_lid_not_registered',
                `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`
            ));
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
            return reply(renderResponseTemplate(
                'package_request_pending',
                `Anda sudah memiliki permintaan perubahan paket ke *${existingRequest.requestedPackageName}* yang sedang diproses. Mohon tunggu hingga permintaan tersebut diselesaikan oleh Admin.`,
                { nama_paket: existingRequest.requestedPackageName }
            ));
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

        let replyText = renderResponseTemplate(
            'package_list_intro',
            `Halo Kak ${pushname},\n\nAnda dapat mengubah paket langganan Anda. Paket Anda saat ini adalah *${user.subscription}*.\n\n`,
            { pushname: pushname || 'Kak', paket_sekarang: user.subscription }
        );

        let optionCounter = 1;
        if (upgradePackages.length > 0) {
            replyText += renderResponseTemplate(
                'package_upgrade_header',
                "📈 *Pilihan Upgrade:*\n"
            );
            upgradePackages.forEach(p => {
                replyText += `  *${optionCounter}.* *${p.name}* (${p.profile}) - ${convertRupiah.convert(p.price)}\n`;
                optionCounter++;
            });
        }

        if (downgradePackages.length > 0) {
            replyText += renderResponseTemplate(
                'package_downgrade_header',
                "\n📉 *Pilihan Downgrade:*\n"
            );
            downgradePackages.forEach(p => {
                replyText += `  *${optionCounter}.* *${p.name}* (${p.profile}) - ${convertRupiah.convert(p.price)}\n`;
                optionCounter++;
            });
        }

        if (availablePackages.length === 0) {
            return reply(renderResponseTemplate(
                'package_no_options',
                "Maaf, saat ini tidak ada pilihan paket lain yang tersedia untuk Anda."
            ));
        }

        replyText += renderResponseTemplate(
            'package_list_footer',
            "\nSilakan balas dengan *nomor* paket yang Anda inginkan (contoh: `1`). Atau ketik *batal* untuk membatalkan."
        );

        setUserState(stateKey, {
            step: 'ASK_PACKAGE_CHOICE',
            user: user,
            options: availablePackages // The options are already ordered correctly
        });

        return reply(replyText);

    } catch (error) {
        console.error('[UBAH_PAKET] Error:', error);
        await reply(renderResponseTemplate(
            'package_generic_error',
            'Terjadi kesalahan saat memproses permintaan ubah paket. Silakan coba lagi.'
        ));
    }
}

/**
 * Handle speed boost request
 */
async function handleRequestSpeedBoost({ sender, stateSender, plainSenderNumber: _plainSenderNumber, pushname, reply, mess, global, temp: _temp, msg, raf }) {
    try {
        // stateKey = JID kanonik untuk key state (router membaca state via stateSender);
        // sender mentah tetap dipakai untuk resolusi pelanggan @lid.
        const stateKey = stateSender || sender;
        // Resolusi pelanggan terpadu (LID-aware: remoteJidAlt → getPNForLID → stored-mapping → pre-warm USync).
        const { user } = await resolveCustomerBySender({ users: global.users, sender, msg, raf });

        // Handle @lid users - no manual verification needed
        if (!user && sender.endsWith('@lid')) {
            return reply(renderResponseTemplate(
                'sod_lid_not_registered',
                `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`
            ));
        }

        if (!user) {
            return reply(mess.userNotRegister);
        }

        if (user.subscription === 'PAKET-VOUCHER') {
            return reply(mess.onlyMonthly);
        }

        const activeBoost = global.speed_requests.find(
            r => r.userId === user.id && r.status === 'active'
        );

        if (activeBoost) {
            const expireAt = new Date(activeBoost.expirationDate).toLocaleString('id-ID');
            return reply(renderResponseTemplate(
                'sod_active_exists',
                `Anda sudah memiliki Speed on Demand yang aktif untuk paket *${activeBoost.requestedPackageName}* dan akan berakhir pada ${expireAt}.`,
                { nama_paket: activeBoost.requestedPackageName, expire_at: expireAt }
            ));
        }

        const pendingBoost = global.speed_requests.find(
            r => r.userId === user.id && r.status === 'pending'
        );

        if (pendingBoost) {
            return reply(renderResponseTemplate(
                'sod_pending_exists',
                `Anda sudah memiliki permintaan Speed on Demand untuk paket *${pendingBoost.requestedPackageName}* yang sedang menunggu persetujuan admin.`,
                { nama_paket: pendingBoost.requestedPackageName }
            ));
        }

        const currentUserPackage = global.packages.find(p => p.name === user.subscription);
        const currentUserPrice = currentUserPackage ? (Number(currentUserPackage.price) || 0) : 0;

        const sodPackages = global.packages.filter(
            p => p.isSpeedBoost && (Number(p.price) || 0) > currentUserPrice
        );

        if (sodPackages.length === 0) {
            return reply(renderResponseTemplate(
                'sod_no_options',
                "Maaf, tidak ada paket speed boost yang tersedia untuk langganan Anda saat ini."
            ));
        }

        let replyText = renderResponseTemplate(
            'sod_list_intro',
            `Halo Kak ${pushname},\n\nAnda dapat mengaktifkan *Speed on Demand* untuk meningkatkan kecepatan internet selama 1 hari.\n\nPaket Anda saat ini: *${user.subscription}*\n\n*Pilihan Paket Speed Boost:*\n`,
            { pushname: pushname || 'Kak', paket_sekarang: user.subscription }
        );

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

        replyText += renderResponseTemplate(
            'sod_list_footer',
            "\nSilakan balas dengan *nomor* paket yang Anda inginkan (contoh: `1`). Atau ketik *batal* untuk membatalkan."
        );

        setUserState(stateKey, {
            step: 'SELECT_SOD_CHOICE',
            user: user,
            options: sodPackages
        });

        return reply(replyText);

    } catch (error) {
        console.error('[REQUEST_SPEED_BOOST] Error:', error);
        await reply(renderResponseTemplate(
            'sod_generic_error',
            'Terjadi kesalahan saat memproses permintaan speed boost. Silakan coba lagi.'
        ));
    }
}

module.exports = {
    handleUbahPaket,
    handleRequestSpeedBoost
};
