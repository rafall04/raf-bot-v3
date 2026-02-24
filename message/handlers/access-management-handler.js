/**
 * Access Management Handler
 * Menangani pengelolaan akses nomor telepon untuk bot
 */


/**
 * Handle access management
 */
async function handleAccessManagement({ sender, args, users, reply, global, db, msg, raf }) {
    // Get plain sender number - findUserWithLidSupport handles @lid internally
    let plainSenderNumber = sender.split('@')[0].split(':')[0];

    let optionalJid = null;
    if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
        optionalJid = msg.key.remoteJidAlt.split('@')[0].split(':')[0];
        plainSenderNumber = optionalJid;
    } else if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
        optionalJid = msg.participant.split('@')[0].split(':')[0];
        plainSenderNumber = optionalJid;
    }

    // Use LID-aware user finder
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
    if (!user && sender.endsWith('@lid')) {
        throw `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`;
    }

    if (!user) {
        throw "❌ Maaf! Nomor Anda tidak terdaftar sebagai pelanggan.\n\nSilakan hubungi admin untuk informasi lebih lanjut.";
    }

    const phoneNumbers = user.phone_number.split("|");
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
        reply(`📱 *Daftar Akses Bot*\n\n✅ ${primaryPhone} (Nomor Utama)\n\n_Anda belum memberikan akses ke nomor lain._\n\n💡 Gunakan *akses tambah 628xxx* untuk menambahkan nomor yang dapat mengakses bot ini.\n\n📊 Kuota: ${phoneNumbers.length}/${accessLimit}`);
    } else {
        const accessList = phoneNumbers.map((num, idx) =>
            idx === 0 ? `✅ ${num} (Nomor Utama)` : `📱 ${num}`
        ).join("\n");
        reply(`📱 *Daftar Akses Bot*\n\n${accessList}\n\n📊 Kuota: ${phoneNumbers.length}/${accessLimit}\n\n💡 Gunakan *akses hapus 628xxx* untuk menghapus akses.`);
    }
}

/**
 * Handle add access
 */
function handleAccessAdd(args, user, phoneNumbers, primaryPhone, accessLimit, sender, reply, db, global) {
    if (args.length < 3) {
        throw "❌ Format tidak lengkap!\n\n📝 *Cara Penggunaan:*\nakses tambah 628xxx\n\n*Contoh:*\nakses tambah 628123456789\n\n💡 Nomor harus diawali dengan 62 (kode negara Indonesia).";
    }

    const phoneToAdd = args[2].trim();

    // Validasi format nomor
    if (!phoneToAdd.startsWith('62')) {
        throw '❌ Format nomor salah!\n\nNomor harus diawali dengan *62* (kode negara Indonesia).\n\n*Contoh yang benar:*\n628123456789\n\n*Contoh yang salah:*\n08123456789 ❌\n+628123456789 ❌';
    }

    if (!/^62\d{9,13}$/.test(phoneToAdd)) {
        throw '❌ Format nomor tidak valid!\n\nPastikan:\n• Diawali dengan 62\n• Hanya berisi angka\n• Panjang 11-15 digit\n\n*Contoh yang benar:*\n628123456789';
    }

    // Validasi batas maksimal
    if (phoneNumbers.length >= accessLimit) {
        throw `❌ Batas maksimal tercapai!\n\nAnda sudah memberikan akses ke ${phoneNumbers.length} nomor (maksimal ${accessLimit}).\n\n💡 Hapus nomor lain terlebih dahulu dengan:\nakses hapus 628xxx`;
    }

    // Validasi duplikasi
    if (phoneNumbers.find(v => v === phoneToAdd)) {
        throw `❌ Nomor sudah terdaftar!\n\nNomor *${phoneToAdd}* sudah memiliki akses ke bot ini.\n\n📱 Gunakan *akses list* untuk melihat semua nomor yang memiliki akses.`;
    }

    const newPhoneNumbersAdd = `${user.phone_number}|${phoneToAdd}`;

    db.run(`UPDATE users SET phone_number = ? WHERE id = ?`, [newPhoneNumbersAdd, user.id], function (err) {
        if (err) {
            console.error("[DB_UPDATE_ERROR] Gagal update nomor telepon:", err.message);
            reply("❌ Maaf, terjadi kesalahan sistem saat memperbarui data.\n\nSilakan coba lagi dalam beberapa saat atau hubungi admin jika masalah berlanjut.");
            return;
        }

        console.log(`[DB_UPDATE_SUCCESS] Nomor telepon untuk user ID ${user.id} berhasil diperbarui.`);

        // Update in-memory global.users as well
        const userIndex = global.users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
            global.users[userIndex].phone_number = newPhoneNumbersAdd;
        }

        const newCount = phoneNumbers.length + 1;
        reply(`✅ *Akses Berhasil Diberikan!*\n\nNomor *${phoneToAdd}* sekarang dapat mengakses bot ini.\n\n📊 Total akses: ${newCount}/${accessLimit}\n\n💡 Gunakan *akses list* untuk melihat semua nomor yang memiliki akses.`);
    });
}

/**
 * Handle delete access
 */
function handleAccessDelete(args, user, phoneNumbers, primaryPhone, accessLimit, sender, reply, db, global) {
    if (args.length < 3) {
        throw "❌ Format tidak lengkap!\n\n📝 *Cara Penggunaan:*\nakses hapus 628xxx\n\n*Contoh:*\nakses hapus 628123456789\n\n💡 Gunakan *akses list* untuk melihat nomor yang dapat dihapus.";
    }

    const phoneToDelete = args[2].trim();

    // Validasi nomor ada dalam daftar
    if (!phoneNumbers.find(v => v === phoneToDelete)) {
        throw `❌ Nomor tidak ditemukan!\n\nNomor *${phoneToDelete}* tidak ada dalam daftar akses.\n\n📱 Gunakan *akses list* untuk melihat nomor yang terdaftar.`;
    }

    // Validasi tidak menghapus nomor utama
    if (phoneToDelete === primaryPhone) {
        throw `❌ Tidak dapat menghapus nomor utama!\n\nNomor *${primaryPhone}* adalah nomor utama akun Anda dan tidak dapat dihapus.\n\n💡 Anda hanya dapat menghapus nomor tambahan yang telah ditambahkan.`;
    }

    const newPhoneNumbersDel = phoneNumbers.filter(vv => vv !== phoneToDelete).join("|");

    db.run(`UPDATE users SET phone_number = ? WHERE id = ?`, [newPhoneNumbersDel, user.id], function (err) {
        if (err) {
            console.error("[DB_UPDATE_ERROR] Gagal menghapus nomor telepon:", err.message);
            reply("❌ Maaf, terjadi kesalahan sistem saat memperbarui data.\n\nSilakan coba lagi dalam beberapa saat atau hubungi admin jika masalah berlanjut.");
            return;
        }

        console.log(`[DB_UPDATE_SUCCESS] Nomor telepon untuk user ID ${user.id} berhasil dihapus.`);

        // Update in-memory global.users as well
        const userIndex = global.users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
            global.users[userIndex].phone_number = newPhoneNumbersDel;
        }

        const newCount = phoneNumbers.length - 1;
        reply(`✅ *Akses Berhasil Dihapus!*\n\nNomor *${phoneToDelete}* tidak dapat lagi mengakses bot ini.\n\n📊 Total akses: ${newCount}/${accessLimit}\n\n💡 Gunakan *akses list* untuk melihat nomor yang tersisa.`);
    });
}

/**
 * Handle access help
 */
function handleAccessHelp(accessLimit, reply) {
    reply(`📱 *Manajemen Akses Bot*\n\nFitur ini memungkinkan Anda memberikan akses bot kepada nomor lain (misal: keluarga atau karyawan).\n\n📝 *Perintah yang tersedia:*\n\n1️⃣ *akses list*\n   Melihat daftar nomor yang memiliki akses\n\n2️⃣ *akses tambah 628xxx*\n   Menambahkan nomor baru\n   Contoh: akses tambah 628123456789\n\n3️⃣ *akses hapus 628xxx*\n   Menghapus akses nomor\n   Contoh: akses hapus 628123456789\n\n📊 Batas maksimal: ${accessLimit} nomor\n\n💡 *Tips:*\n• Nomor utama tidak dapat dihapus\n• Format nomor harus diawali 62\n• Gunakan perintah *hp*, *akses*, atau *access*`);
}

module.exports = {
    handleAccessManagement
};
