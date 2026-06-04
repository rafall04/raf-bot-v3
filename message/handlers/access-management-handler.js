/**
 * Header Doc
 * Purpose: Handler manajemen akses nomor telepon tambahan ke bot (list/add/delete/help) per pelanggan.
 * Caller: Dispatcher bot `message/raf.js` pada intent `AKSES` / `ACCESS`.
 * Deps: `./template-helpers` (renderResponseTemplate), database SQLite users untuk update phone_number.
 * MainFuncs: `handleAccessManagement`.
 * SideEffects: Mengubah kolom `phone_number` di tabel users dan mengirim reply WhatsApp.
 */

"use strict";

const { renderResponseTemplate } = require('./template-helpers');
const { resolveCustomerBySender } = require('../../lib/jid-utils');

/**
 * Handle access management
 */
async function handleAccessManagement({ sender, args, users, reply, global, db, msg, raf }) {
    // Resolusi pelanggan terpadu (LID-aware: remoteJidAlt → getPNForLID → stored-mapping → pre-warm USync).
    const { user } = await resolveCustomerBySender({ users: global.users, sender, msg, raf });

    // Handle @lid users - no manual verification needed
    if (!user && sender.endsWith('@lid')) {
        throw renderResponseTemplate(
            'access_not_registered_lid',
            `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`
        );
    }

    if (!user) {
        throw renderResponseTemplate(
            'access_not_registered',
            "❌ Maaf! Nomor Anda tidak terdaftar sebagai pelanggan.\n\nSilakan hubungi admin untuk informasi lebih lanjut."
        );
    }

    const phoneNumbers = (user.phone_number || '').split("|").filter(Boolean);
    if (phoneNumbers.length === 0) {
        throw renderResponseTemplate(
            'access_no_primary_phone',
            '❌ Data nomor utama pelanggan belum lengkap. Silakan hubungi admin.'
        );
    }
    const primaryPhone = phoneNumbers[0]; // Nomor utama (pertama)
    const accessLimit = global.config.accessLimit || 3;

    switch (args[1]) {
        case "list":
            handleAccessList(phoneNumbers, primaryPhone, accessLimit, reply);
            break;

        case "add":
        case "tambah":
            handleAccessAdd(args, user, phoneNumbers, primaryPhone, accessLimit, sender, reply, db, global);
            break;

        case "del":
        case "delete":
        case "hapus":
            handleAccessDelete(args, user, phoneNumbers, primaryPhone, accessLimit, sender, reply, db, global);
            break;

        default:
            handleAccessHelp(accessLimit, reply);
            break;
    }
}

/**
 * Handle list access
 */
function handleAccessList(phoneNumbers, primaryPhone, accessLimit, reply) {
    if (phoneNumbers.length === 1) {
        reply(renderResponseTemplate(
            'access_list_single',
            `📱 *Daftar Akses Bot*\n\n✅ ${primaryPhone} (Nomor Utama)\n\n_Anda belum memberikan akses ke nomor lain._\n\n💡 Gunakan *akses tambah 628xxx* untuk menambahkan nomor yang dapat mengakses bot ini.\n\n📊 Kuota: ${phoneNumbers.length}/${accessLimit}`,
            { primary_phone: primaryPhone, current_count: phoneNumbers.length, access_limit: accessLimit }
        ));
    } else {
        const accessList = phoneNumbers.map((num, idx) =>
            idx === 0 ? `✅ ${num} (Nomor Utama)` : `📱 ${num}`
        ).join("\n");
        reply(renderResponseTemplate(
            'access_list_many',
            `📱 *Daftar Akses Bot*\n\n${accessList}\n\n📊 Kuota: ${phoneNumbers.length}/${accessLimit}\n\n💡 Gunakan *akses hapus 628xxx* untuk menghapus akses.`,
            { access_list: accessList, current_count: phoneNumbers.length, access_limit: accessLimit }
        ));
    }
}

/**
 * Handle add access
 */
function handleAccessAdd(args, user, phoneNumbers, primaryPhone, accessLimit, sender, reply, db, global) {
    if (args.length < 3) {
        throw renderResponseTemplate(
            'access_add_format',
            "❌ Format tidak lengkap!\n\n📝 *Cara Penggunaan:*\nakses tambah 628xxx\n\n*Contoh:*\nakses tambah 628123456789\n\n💡 Nomor harus diawali dengan 62 (kode negara Indonesia)."
        );
    }

    const phoneToAdd = args[2].trim();

    // Validasi format nomor
    if (!phoneToAdd.startsWith('62')) {
        throw renderResponseTemplate(
            'access_add_invalid_prefix',
            '❌ Format nomor salah!\n\nNomor harus diawali dengan *62* (kode negara Indonesia).\n\n*Contoh yang benar:*\n628123456789\n\n*Contoh yang salah:*\n08123456789 ❌\n+628123456789 ❌'
        );
    }

    if (!/^62\d{9,13}$/.test(phoneToAdd)) {
        throw renderResponseTemplate(
            'access_add_invalid_format',
            '❌ Format nomor tidak valid!\n\nPastikan:\n• Diawali dengan 62\n• Hanya berisi angka\n• Panjang 11-15 digit\n\n*Contoh yang benar:*\n628123456789'
        );
    }

    // Validasi batas maksimal
    if (phoneNumbers.length >= accessLimit) {
        throw renderResponseTemplate(
            'access_add_limit_reached',
            `❌ Batas maksimal tercapai!\n\nAnda sudah memberikan akses ke ${phoneNumbers.length} nomor (maksimal ${accessLimit}).\n\n💡 Hapus nomor lain terlebih dahulu dengan:\nakses hapus 628xxx`,
            { current_count: phoneNumbers.length, access_limit: accessLimit }
        );
    }

    // Validasi duplikasi
    if (phoneNumbers.find(v => v === phoneToAdd)) {
        throw renderResponseTemplate(
            'access_add_duplicate',
            `❌ Nomor sudah terdaftar!\n\nNomor *${phoneToAdd}* sudah memiliki akses ke bot ini.\n\n📱 Gunakan *akses list* untuk melihat semua nomor yang memiliki akses.`,
            { phone_to_add: phoneToAdd }
        );
    }

    const newPhoneNumbersAdd = `${user.phone_number}|${phoneToAdd}`;

    db.run(`UPDATE users SET phone_number = ? WHERE id = ?`, [newPhoneNumbersAdd, user.id], function (err) {
        if (err) {
            console.error("[DB_UPDATE_ERROR] Gagal update nomor telepon:", err.message);
            reply(renderResponseTemplate(
                'access_add_db_error',
                "❌ Maaf, terjadi kesalahan sistem saat memperbarui data.\n\nSilakan coba lagi dalam beberapa saat atau hubungi admin jika masalah berlanjut."
            ));
            return;
        }

        console.log(`[DB_UPDATE_SUCCESS] Nomor telepon untuk user ID ${user.id} berhasil diperbarui.`);

        // Update in-memory global.users as well
        const userIndex = global.users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
            global.users[userIndex].phone_number = newPhoneNumbersAdd;
        }

        const newCount = phoneNumbers.length + 1;
        reply(renderResponseTemplate(
            'access_add_success',
            `✅ *Akses Berhasil Diberikan!*\n\nNomor *${phoneToAdd}* sekarang dapat mengakses bot ini.\n\n📊 Total akses: ${newCount}/${accessLimit}\n\n💡 Gunakan *akses list* untuk melihat semua nomor yang memiliki akses.`,
            { phone_to_add: phoneToAdd, new_count: newCount, access_limit: accessLimit }
        ));
    });
}

/**
 * Handle delete access
 */
function handleAccessDelete(args, user, phoneNumbers, primaryPhone, accessLimit, sender, reply, db, global) {
    if (args.length < 3) {
        throw renderResponseTemplate(
            'access_delete_format',
            "❌ Format tidak lengkap!\n\n📝 *Cara Penggunaan:*\nakses hapus 628xxx\n\n*Contoh:*\nakses hapus 628123456789\n\n💡 Gunakan *akses list* untuk melihat nomor yang dapat dihapus."
        );
    }

    const phoneToDelete = args[2].trim();

    // Validasi nomor ada dalam daftar
    if (!phoneNumbers.find(v => v === phoneToDelete)) {
        throw renderResponseTemplate(
            'access_delete_not_found',
            `❌ Nomor tidak ditemukan!\n\nNomor *${phoneToDelete}* tidak ada dalam daftar akses.\n\n📱 Gunakan *akses list* untuk melihat nomor yang terdaftar.`,
            { phone_to_delete: phoneToDelete }
        );
    }

    // Validasi tidak menghapus nomor utama
    if (phoneToDelete === primaryPhone) {
        throw renderResponseTemplate(
            'access_delete_primary_blocked',
            `❌ Tidak dapat menghapus nomor utama!\n\nNomor *${primaryPhone}* adalah nomor utama akun Anda dan tidak dapat dihapus.\n\n💡 Anda hanya dapat menghapus nomor tambahan yang telah ditambahkan.`,
            { primary_phone: primaryPhone }
        );
    }

    const newPhoneNumbersDel = phoneNumbers.filter(vv => vv !== phoneToDelete).join("|");

    db.run(`UPDATE users SET phone_number = ? WHERE id = ?`, [newPhoneNumbersDel, user.id], function (err) {
        if (err) {
            console.error("[DB_UPDATE_ERROR] Gagal menghapus nomor telepon:", err.message);
            reply(renderResponseTemplate(
                'access_add_db_error',
                "❌ Maaf, terjadi kesalahan sistem saat memperbarui data.\n\nSilakan coba lagi dalam beberapa saat atau hubungi admin jika masalah berlanjut."
            ));
            return;
        }

        console.log(`[DB_UPDATE_SUCCESS] Nomor telepon untuk user ID ${user.id} berhasil dihapus.`);

        // Update in-memory global.users as well
        const userIndex = global.users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
            global.users[userIndex].phone_number = newPhoneNumbersDel;
        }

        const newCount = phoneNumbers.length - 1;
        reply(renderResponseTemplate(
            'access_delete_success',
            `✅ *Akses Berhasil Dihapus!*\n\nNomor *${phoneToDelete}* tidak dapat lagi mengakses bot ini.\n\n📊 Total akses: ${newCount}/${accessLimit}\n\n💡 Gunakan *akses list* untuk melihat nomor yang tersisa.`,
            { phone_to_delete: phoneToDelete, new_count: newCount, access_limit: accessLimit }
        ));
    });
}

/**
 * Handle access help
 */
function handleAccessHelp(accessLimit, reply) {
    reply(renderResponseTemplate(
        'access_help',
        `📱 *Manajemen Akses Bot*\n\nFitur ini memungkinkan Anda memberikan akses bot kepada nomor lain (misal: keluarga atau karyawan).\n\n📝 *Perintah yang tersedia:*\n\n1️⃣ *akses list*\n   Melihat daftar nomor yang memiliki akses\n\n2️⃣ *akses tambah 628xxx*\n   Menambahkan nomor baru\n   Contoh: akses tambah 628123456789\n\n3️⃣ *akses hapus 628xxx*\n   Menghapus akses nomor\n   Contoh: akses hapus 628123456789\n\n📊 Batas maksimal: ${accessLimit} nomor\n\n💡 *Tips:*\n• Nomor utama tidak dapat dihapus\n• Format nomor harus diawali 62\n• Gunakan perintah *hp*, *akses*, atau *access*`,
        { access_limit: accessLimit }
    ));
}

module.exports = {
    handleAccessManagement
};
