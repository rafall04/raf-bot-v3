/**
 * Header Doc
 * Purpose: Handler perintah monitoring admin/owner: statistik PPPoE, Hotspot, Status AP, daftar saldo/user/profil static & voucher.
 * Caller: Dispatcher bot `message/raf.js` pada intent monitoring (`statusppp`, `statushotspot`, `statusap`, `allsaldo`, dst).
 * Deps: `../../lib/mikrotik`, `./template-helpers` (renderResponseTemplate), `./conversation-handler` (format legacy).
 * MainFuncs: `handleStatusPpp`, `handleStatusHotspot`, `handleStatusAp`, `handleAllSaldo`, `handleAllUser`, `handleListProfStatik`, `handleListProfVoucher`, `handleMonitorWifi`.
 * SideEffects: Membaca MikroTik/RouterOS API dan mengirim reply WhatsApp statistik.
 */

const { getPppStats, getHotspotStats, statusap } = require('../../lib/mikrotik');
const { format } = require('./conversation-handler');
const { renderResponseTemplate } = require('./template-helpers');

/**
 * Handle status PPP
 */
async function handleStatusPpp(isOwner, isTeknisi, reply, mess, config) {
    if (!isOwner && !isTeknisi) return reply(mess.teknisiOrOwnerOnly);
    
    reply(renderResponseTemplate(
        'monitoring_ppp_loading',
        "⏳ Sedang mengambil statistik PPPoE, mohon tunggu..."
    ));

    try {
        const pppStatsResult = await getPppStats({ caller: 'monitoring-handler.statusppp' });
        if (!pppStatsResult.ok) {
            throw new Error(pppStatsResult.message);
        }
        const pppStats = pppStatsResult.data || {};
        const namaLayanan = config.nama || 'Layanan Kami';
        const namaBot = config.namabot || 'Bot Kami';
        const total = pppStats.total !== undefined ? pppStats.total : 'N/A';
        const online = pppStats.online !== undefined ? pppStats.online : 'N/A';
        const offline = pppStats.offline !== undefined ? pppStats.offline : 'N/A';

        let replyText = renderResponseTemplate(
            'monitoring_ppp_stats_header',
            `📊 *Statistik PPPoE Saat Ini (${namaLayanan}):*\n\n👤 Total Pengguna PPPoE: *${total}*\n🟢 Aktif Saat Ini: *${online}*\n🔴 Tidak Aktif: *${offline}*\n`,
            { nama_layanan: namaLayanan, total, online, offline }
        );

        if (pppStats.inactive_users_list && Array.isArray(pppStats.inactive_users_list) && pppStats.inactive_users_list.length > 0) {
            replyText += renderResponseTemplate(
                'monitoring_ppp_inactive_list_header',
                `\n📜 *Daftar Pengguna PPPoE Tidak Aktif:*\n`
            );
            const maxInactiveToShow = 20;
            const inactiveToShow = pppStats.inactive_users_list.slice(0, maxInactiveToShow);

            inactiveToShow.forEach((user, index) => {
                replyText += `${index + 1}. ${user}\n`;
            });

            if (pppStats.inactive_users_list.length > maxInactiveToShow) {
                replyText += `... dan ${pppStats.inactive_users_list.length - maxInactiveToShow} pengguna lainnya.\n`;
            }
        } else if (pppStats.offline > 0) {
            replyText += renderResponseTemplate(
                'monitoring_ppp_inactive_detail_missing',
                `\n📜 *Daftar Pengguna PPPoE Tidak Aktif:* (Detail daftar tidak tersedia saat ini)\n`
            );
        } else {
            replyText += renderResponseTemplate(
                'monitoring_ppp_all_active',
                `\n👍 Semua pengguna PPPoE yang terdaftar saat ini aktif atau tidak ada pengguna tidak aktif.\n`
            );
        }

        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        replyText += renderResponseTemplate(
            'monitoring_ppp_stats_footer',
            `\n----\nℹ️ _Data diambil pada: ${timestamp}_\nTim ${namaBot}`,
            { timestamp, nama_bot: namaBot }
        );
        reply(replyText);
    } catch (err) {
        console.error("[statusppp_ERROR_COMMAND]", err.message);
        reply(renderResponseTemplate(
            'monitoring_ppp_error',
            `🚫 Gagal mengambil statistik PPPoE: ${err.message}. Silakan coba lagi nanti atau hubungi Admin.`,
            { errorMessage: err.message }
        ));
    }
}

/**
 * Handle status hotspot
 */
async function handleStatusHotspot(isOwner, isTeknisi, reply, mess, config) {
    if (!isOwner && !isTeknisi) return reply(mess.teknisiOrOwnerOnly);
    
    reply(renderResponseTemplate(
        'monitoring_hotspot_loading',
        "⏳ Sedang mengambil statistik Hotspot, mohon tunggu..."
    ));

    try {
        const hotspotStatsResult = await getHotspotStats({ caller: 'monitoring-handler.statushotspot' });
        if (!hotspotStatsResult.ok) {
            throw new Error(hotspotStatsResult.message);
        }
        const hotspotStats = hotspotStatsResult.data || {};
        const namaLayanan = config.nama || 'Layanan Kami';
        const namaBot = config.namabot || 'Bot Kami';
        const total = hotspotStats.total !== undefined ? hotspotStats.total : 'N/A';
        const active = hotspotStats.active !== undefined ? hotspotStats.active : 'N/A';
        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

        reply(renderResponseTemplate(
            'monitoring_hotspot_stats_wrapper',
            `📊 *Statistik Hotspot Saat Ini (${namaLayanan}):*\n\n👥 Total Pengguna Hotspot Terdaftar: *${total}*\n🟢 Aktif Saat Ini: *${active}*\n\n----\nℹ️ _Data diambil pada: ${timestamp}_\nTim ${namaBot}`,
            { nama_layanan: namaLayanan, total, active, timestamp, nama_bot: namaBot }
        ));
    } catch (err) {
        console.error("[statushotspot_ERROR_COMMAND]", err.message);
        reply(renderResponseTemplate(
            'monitoring_hotspot_error',
            `🚫 Gagal mengambil statistik Hotspot: ${err.message}. Silakan coba lagi nanti atau hubungi Admin.`,
            { errorMessage: err.message }
        ));
    }
}

/**
 * Handle status AP
 */
async function handleStatusAp(isOwner, reply, mess) {
    if (!isOwner) throw mess.owner;
    
    try {
        const bodyResult = await statusap({ caller: 'monitoring-handler.statusap' });
        if (!bodyResult.ok) {
            throw new Error(bodyResult.message);
        }
        const body = String(bodyResult.data || '');
        const tod = body.split();
        const statusapData = tod[Math.floor(Math.random() * tod.length)];
        var splitnya = 'Nama' + statusapData.replace('NAMA', '').split('NAMA').join('\nNAMA').split('</br>').join(' ').split(' : ').join(':').split(' ').join('\n');
        await reply(renderResponseTemplate(
            'monitoring_statusap_wrapper',
            `STATUS AP :\n\n${splitnya}\n\nBy Bot`,
            { statusApData: splitnya }
        ));
    } catch (err) {
        console.error(err);
        await reply(renderResponseTemplate(
            'monitoring_statusap_error',
            'Error!'
        ));
    }
}

/**
 * Handle all saldo
 */
function handleAllSaldo(isOwner, reply, mess, config, atm) {
    if (!isOwner) throw mess.owner;

    const entries = (atm || [])
        .map((i) => `User  : ${i.id}\nSaldo :  Rp.${i.saldo}`)
        .join('\n\n');
    const namaLayanan = config.nama || 'Layanan Kami';

    reply(renderResponseTemplate(
        'monitoring_allsaldo_wrapper',
        `「 *${namaLayanan}* 」\n\nJumlah Saldo Semua User.\n\n${entries}`,
        { nama_layanan: namaLayanan, entries }
    ));
}

/**
 * Handle all user
 */
function handleAllUser(isOwner, reply, mess, users) {
    if (!isOwner) throw mess.owner;

    const entries = (users || []).map((user) => (
        'Nama: ' + user.name +
        '\nNo Telepon: ' + (user.phone_number ? user.phone_number.split('|').join(', ') : '') +
        '\nPaket Langganan: ' + user.subscription +
        '\nAlamat: ' + user.address +
        '\nUsername PPPoE: ' + user.pppoe_username +
        '\nPassword PPPoE: ' + user.pppoe_password
    )).join('\n\n');

    reply(renderResponseTemplate(
        'monitoring_allusers_wrapper',
        `ALL USERS\n\n${entries}`,
        { entries }
    ));
}

/**
 * Handle list profil statik
 */
function handleListProfStatik(isOwner, reply, mess, statik) {
    if(!isOwner) throw mess.owner;

    const entries = (statik || [])
        .map((i) => `• *PROFIL:* ${i.prof}\n• *LIMIT AT:* ${i.limitat}\n• *MAX LIMIT:* ${i.maxlimit}`)
        .join('\n\n');

    reply(renderResponseTemplate(
        'monitoring_list_profstatik_wrapper',
        `「 *LIST-PROFIL-STATIK* 」\n\nJumlah : ${statik.length}\n\n${entries}`,
        { total: statik.length, entries }
    ));
}

/**
 * Handle list profil voucher
 */
function handleListProfVoucher(isOwner, reply, mess, voucher) {
    if(!isOwner) throw mess.owner;

    const entries = (voucher || [])
        .map((i) => `• *NAMA PROFIL:* ${i.prof}\n• *NAMA VOUCHER:* ${i.namavc}\n• *DURASI VOUCHER:* ${i.durasivc}\n• *HARGA VOUCHER:* ${i.hargavc}`)
        .join('\n\n');

    reply(renderResponseTemplate(
        'monitoring_list_profvoucher_wrapper',
        `「 *LIST-PROFIL-VOUCHER* 」\n\nJumlah : ${voucher.length}\n\n${entries}`,
        { total: voucher.length, entries }
    ));
}

/**
 * Handle monitor wifi
 */
function handleMonitorWifi(isOwner, isTeknisi, reply, mess) {
    if (!isOwner && !isTeknisi) return reply(mess.teknisiOrOwnerOnly);
    
    reply(renderResponseTemplate(
        'monitoring_wifi_placeholder',
        `📊 *MONITOR WIFI*\n\nFitur monitoring WiFi sedang dalam pengembangan.\n\nGunakan perintah berikut yang tersedia:\n• *statusppp* - Status PPPoE\n• *statushotspot* - Status Hotspot\n• *statusap* - Status Access Point (Owner only)`
    ));
}

module.exports = {
    handleStatusPpp,
    handleStatusHotspot,
    handleStatusAp,
    handleAllSaldo,
    handleAllUser,
    handleListProfStatik,
    handleListProfVoucher,
    handleMonitorWifi
};
