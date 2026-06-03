/**
 * Header Doc
 * Purpose: Handler operasi jaringan MikroTik (IP binding, simple queue, PPPoE) yang dipanggil lewat perintah admin/owner WhatsApp.
 * Caller: Dispatcher bot `message/raf.js` pada intent `ADDBINDING`, `ADDPPP`.
 * Deps: `./template-helpers` (renderResponseTemplate).
 * MainFuncs: `handleAddBinding`, `handleAddPPP`.
 * SideEffects: Memanggil MikroTik adapter untuk mutasi binding/queue/ppp dan mengirim reply WhatsApp.
 */
"use strict";

const { renderResponseTemplate } = require('./template-helpers');

function resolveBindingErrorMessage(resultMessage) {
    const normalized = String(resultMessage || '');
    if (normalized.includes('SUDAH TERDAFTAR') || normalized.includes('already exists')) {
        return renderResponseTemplate(
            'network_binding_mac_exists',
            'Mohon Maaf Kak Mac Atau Ip Sudah Terdaftar Di IP Binding. Silahkan Cek Lagi Dalam Penulisannya.\n\nTerima Kasih'
        );
    }
    if (normalized.includes('INVALID MAC')) {
        return renderResponseTemplate(
            'network_binding_invalid_mac',
            'Mohon Maaf Kak Error Pada Mac Address. Silahkan Cek Kembali Pada Penulisan Mac Address.\n\nTerima Kasih'
        );
    }
    if (normalized.includes('RANGE IP')) {
        return renderResponseTemplate(
            'network_binding_range_ip',
            'Mohon Maaf Kak Ip Address Melebihi Range Yang Telah Ditentukan. Silahkan Cek Kembali Pada Penulisan Mac Address.\n\nTerima Kasih'
        );
    }
    return renderResponseTemplate(
        'network_binding_technical_error',
        'Mohon Maaf Kak Ada Kesalahan Teknis Saat Penambahan Ip Binding. Silahkan Hubungi Pembuat bot.\n\nTerima Kasih'
    );
}

function resolveQueueErrorMessage(resultMessage) {
    const normalized = String(resultMessage || '');
    if (normalized.includes('PARENT')) {
        return renderResponseTemplate(
            'network_queue_parent_not_found',
            'Mohon Maaf Kak Gagal Menambahkan Ke Simple Queue Dikarenakan Parent Tidak Ditemukan. Silahkan Cek Lagi Dalam Penulisannya.\n\nTerima Kasih'
        );
    }
    if (normalized.includes('SUDAH TERDAFTAR')) {
        return renderResponseTemplate(
            'network_queue_already_exists',
            'Mohon Maaf Kak Gagal Menambahkan Ke Simple Queue Dikarenakan Nama Itu Sudah Terdaftar Di Simple Queue. Silahkan Cek Lagi Dalam Penulisannya.\n\nTerima Kasih'
        );
    }
    if (normalized.includes('DOWNLOAD')) {
        return renderResponseTemplate(
            'network_queue_limitat_exceed_download',
            'Mohon Maaf Kak Limit At Download Lebih Besar Dari Max Limit. Silahkan Cek Konfigurasi Database Profil Anda.\n\nTerima Kasih'
        );
    }
    if (normalized.includes('UPLOAD')) {
        return renderResponseTemplate(
            'network_queue_limitat_exceed_upload',
            'Mohon Maaf Kak Limit At Upload Lebih Besar Dari Max Limit. Silahkan Cek Konfigurasi Database Profil Anda.\n\nTerima Kasih'
        );
    }
    return renderResponseTemplate(
        'network_queue_technical_error',
        'Mohon Maaf Kak Ada Kesalahan Teknis Saat Penambahan Simple Queue. Silahkan Hubungi Pembuat bot.\n\nTerima Kasih'
    );
}

async function handleBindingResult(reply, result, komen, ip, mac) {
    if (!result.ok) {
        await reply(resolveBindingErrorMessage(result.message));
        return;
    }
    await reply(renderResponseTemplate(
        'network_binding_success',
        `Pembuatan Ip Binding Telah Selesai. Dengan Data Berikut :\n\nKomen : ${komen}\nIP : ${ip}\nMAC ADDRESS : ${mac}\n\nTerima Kasih`,
        { komen, ip, mac }
    ));
}

/**
 * Handle add IP binding
 */
async function handleAddBinding({ q, isOwner, reply, mess, global, checkStatik, checkLimitAt, checkMaxLimit, addbinding, addqueue }) {
    try {
        if (!isOwner) throw mess.owner;

        const parent = `${global.config.parentbinding}`;
        let [komen, ip, mac, prof] = q.split('|');

        const cekprof = checkStatik(prof);
        const ceklimitat = checkLimitAt(prof);
        const cekmaxlimit = checkMaxLimit(prof);

        if (cekprof === false) {
            return reply(renderResponseTemplate(
                'statik_profile_not_found',
                'Profil Tidak Ditemukan !!!'
            ));
        }

        if (mac && mac.toLowerCase() === 'kosong') {
            try {
                const result = await addbinding(komen, ip, undefined, { caller: 'network-management.addbinding' });
                await handleBindingResult(reply, result, komen, ip, mac);
            } catch (err) {
                console.error('[ADD_BINDING] Error:', err);
                await reply(renderResponseTemplate(
                    'network_generic_error',
                    'Terjadi kesalahan saat memproses operasi jaringan.'
                ));
            }
            return;
        }

        try {
            const result = await addbinding(komen, ip, mac, { caller: 'network-management.addbinding' });
            await handleBindingResult(reply, result, komen, ip, mac);
        } catch (err) {
            console.error('[ADD_BINDING] Error:', err);
            await reply(renderResponseTemplate(
                'network_generic_error',
                'Terjadi kesalahan saat memproses operasi jaringan.'
            ));
        }

        try {
            const result = await addqueue(prof, komen, ip, parent, ceklimitat, cekmaxlimit, { caller: 'network-management.addqueue' });
            if (!result.ok) {
                await reply(resolveQueueErrorMessage(result.message));
                return;
            }
            await reply(renderResponseTemplate(
                'network_queue_success',
                `Pembuatan Simple Queue Telah Selesai. Dengan Data Berikut :\n\nNama : ${komen}\nIP : ${ip}\nParent : ${parent}\nLimit At : ${ceklimitat}\nMax Limit : ${cekmaxlimit}\n\nTerima Kasih`,
                { komen, ip, parent, limit_at: ceklimitat, max_limit: cekmaxlimit }
            ));
        } catch (err) {
            console.error('[ADD_QUEUE] Error:', err);
            await reply(renderResponseTemplate(
                'network_generic_error',
                'Terjadi kesalahan saat memproses operasi jaringan.'
            ));
        }
    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            console.error('[ADD_BINDING_HANDLER] Unexpected error:', error);
            await reply(renderResponseTemplate(
                'network_generic_error',
                'Terjadi kesalahan saat menambahkan binding.'
            ));
        }
    }
}

/**
 * Handle add PPPoE account
 */
async function handleAddPPP({ q, isOwner, reply, mess, addpppoe }) {
    try {
        if (!isOwner) throw mess.owner;

        let [user, pw, profil] = q.split('|');

        const result = await addpppoe(user, pw, profil, { caller: 'network-management.addpppoe' });
        const resultppp = String(result.message || '');

        if (!result.ok && resultppp.includes('PROFILE')) {
            await reply(renderResponseTemplate(
                'network_ppp_profile_error',
                `Mohon Maaf Kak Ada Kesalahan Dalam Penulisan Profil. Silahkan Cek Lagi Dalam Penulisan Profil.\n\nTerima Kasih`
            ));
        } else if (!result.ok && (resultppp.includes('SUDAH ADA') || resultppp.includes('SUDAH TERDAFTAR') || resultppp.includes('already'))) {
            await reply(renderResponseTemplate(
                'network_ppp_already_exists',
                `Mohon Maaf Kak User PPPOE Tersebut Telah Terdaftar. Silahkan Buat User Baru Lagi Kak.\n\nTerima Kasih`
            ));
        } else if (!result.ok) {
            await reply(renderResponseTemplate(
                'network_ppp_technical_error',
                `Mohon Maaf Kak Ada Kesalahan Teknis. Silahkan Lapor Ke Pembuat Bot\n\nTerima Kasih`
            ));
        } else {
            await reply(renderResponseTemplate(
                'network_ppp_success',
                `Pembuatan Akun PPPOE Berhasil\n\nUsername : ${user}\nPassword : ${pw} \nProfile : ${profil}\n\nTerima Kasih`,
                { user, password: pw, profil }
            ));
        }
    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            console.error('[ADD_PPP] Error:', error);
            await reply(renderResponseTemplate(
                'network_generic_error',
                'Terjadi kesalahan saat menambahkan akun PPPoE.'
            ));
        }
    }
}

module.exports = {
    handleAddBinding,
    handleAddPPP
};
