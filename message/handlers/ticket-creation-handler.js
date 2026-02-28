/**
 * Ticket Creation Handler
 * Menangani pembuatan tiket laporan dan fungsi terkait
 */

const fs = require('fs');
const path = require('path');
const { sleep } = require('../../lib/myfunc');
const { extractPhoneFromJid } = require('../../lib/jid-utils');

// Path untuk database reports
const reportsDbPath = path.join(__dirname, '../../database/reports.json');

/**
 * Generate unique ticket ID
 * @param {number} length - Panjang ID (default 7)
 * @returns {string} Ticket ID
 */
function generateTicketId(length = 7) {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

/**
 * Save reports data to JSON file
 * @param {Array} data - Reports data array
 */
function saveReportsToFile(data) {
    try {
        fs.writeFileSync(reportsDbPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('[SAVE_REPORTS_ERROR] Gagal menyimpan data laporan:', error);
    }
}

/**
 * Fungsi terpusat untuk membuat laporan gangguan dan mengirim notifikasi.
 * Dipanggil setelah percakapan dengan pelanggan selesai.
 * @param {string} pelangganId - JID pelanggan
 * @param {string} pelangganPushName - Nama pushname pelanggan
 * @param {object} userPelanggan - Objek data pelanggan dari global.users (database)
 * @param {string} laporanLengkap - Teks laporan yang sudah dikumpulkan
 * @param {function} reply - Fungsi untuk membalas pesan
 * @param {object} raf - Objek koneksi Baileys
 * @param {object} global - Global object containing config, accounts, reports
 */
async function buatLaporanGangguan(pelangganId, pelangganPushName, userPelanggan, laporanLengkap, reply, raf, global) {
    const pelangganPlainNumber = extractPhoneFromJid(pelangganId);
    const ticketId = generateTicketId(7);

    const newReport = {
        ticketId,
        pelangganId,
        pelangganPushName,
        pelangganDataSystem: {
            id: userPelanggan.id,
            name: userPelanggan.name,
            address: userPelanggan.address,
            subscription: userPelanggan.subscription,
            pppoe_username: userPelanggan.pppoe_username
        },
        laporanText: laporanLengkap,
        status: "baru",
        createdAt: new Date().toISOString(),
        assignedTeknisiId: null,
        processingStartedAt: null,
        processedByTeknisiId: null,
        processedByTeknisiName: null,
        resolvedAt: null,
        resolvedByTeknisiId: null,
        resolvedByTeknisiName: null,
        cancellationReason: null,
        cancellationTimestamp: null,
        cancelledBy: null
    };

    global.reports.push(newReport);
    saveReportsToFile(global.reports);

    // Pesan konfirmasi ke pelanggan
    const detailPelangganInfoUntukPelanggan = `*Nama Terdaftar:* ${userPelanggan.name || pelangganPushName}\n*Layanan/Paket:* ${userPelanggan.subscription || 'Tidak terinfo'}\n`;
    const pesanKonfirmasiKePelanggan = `✨ *Laporan Anda Telah Diterima* ✨\n\nHalo ${pelangganPushName},\n\nTerima kasih telah menghubungi Layanan ${global.config.nama || "Kami"}. Laporan Anda yang telah kami rangkum telah berhasil dicatat dan akan segera kami proses.\n\nBerikut adalah detail laporan Anda:\n-----------------------------------\n*Nomor Tiket Anda:* *${ticketId}*\n${detailPelangganInfoUntukPelanggan}*Isi Laporan (Lengkap):*\n"${laporanLengkap}"\n-----------------------------------\n\nMohon simpan Nomor Tiket di atas untuk kemudahan pengecekan status laporan Anda di kemudian hari. Tim teknisi kami akan segera meninjau dan menangani laporan Anda. Anda akan menerima notifikasi lebih lanjut mengenai perkembangan laporan ini.\n\nKami menghargai kesabaran Anda.\n\nHormat kami,\nTim ${global.config.namabot || "Bot Kami"}`;

    await reply(pesanKonfirmasiKePelanggan);

    // Persiapan dan pengiriman notifikasi ke teknisi
    const teknisiAccounts = global.accounts.filter(acc => acc.role === 'teknisi' && acc.phone_number && acc.phone_number.trim() !== "");
    const waktuLaporFormatted = new Date(newReport.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
    const linkWaPelanggan = `https://wa.me/${pelangganPlainNumber}`;

    let detailPelangganUntukNotifTeknisi = `Dari (WA): ${pelangganPushName} (${pelangganPlainNumber})`;
    detailPelangganUntukNotifTeknisi += `\nNama Terdaftar: ${userPelanggan.name || "N/A"}`;
    detailPelangganUntukNotifTeknisi += `\nAlamat: ${userPelanggan.address || "N/A"}`;
    detailPelangganUntukNotifTeknisi += `\nPaket: ${userPelanggan.subscription || "N/A"}`;
    if (userPelanggan.pppoe_username) {
        detailPelangganUntukNotifTeknisi += `\nPPPoE: ${userPelanggan.pppoe_username}`;
    }

    const messageToTeknisi = `🔔 *LAPORAN BARU MASUK - SEGERA TINDAKLANJUTI* 🔔\n\nLaporan baru telah diterima dan membutuhkan perhatian Anda.\n\n*Informasi Pelanggan:*\n${detailPelangganUntukNotifTeknisi}\n*Kontak Pelanggan (WhatsApp):* ${linkWaPelanggan}\n\n*Isi Laporan Lengkap:*\n${laporanLengkap}\n\n*Waktu Lapor:* ${waktuLaporFormatted}\n-----------------------------------\n*LANGKAH SELANJUTNYA UNTUK TEKNISI:*\n\n1.  *Hubungi Pelanggan & Tangani Laporan:*\n    - Segera hubungi pelanggan melalui link WhatsApp di atas untuk konfirmasi detail dan mulai penanganan masalah.\n\n2.  *Update Status ke "Diproses" (via Web - Opsional):*\n    - Buka halaman Manajemen Tiket Teknisi di web.\n    - Temukan laporan ini (berdasarkan info pelanggan/isi laporan) dan klik tombol "Proses Tiket". Ini akan mengubah statusnya dan menunjukkan bahwa Anda sedang menanganinya (ID Tiket akan terlihat di web).\n\n3.  *Selesaikan Laporan (Setelah Pekerjaan Selesai):*\n    - Setelah masalah pelanggan teratasi, mintalah *Nomor Tiket* kepada pelanggan (yang mereka terima saat awal melapor).\n    - *Via WhatsApp:* Kirim perintah: \`selesaikantiket NOMOR_TIKET_DARI_PELANGGAN\`\n    - *Via Web:* Pada halaman Manajemen Tiket, masukkan Nomor Tiket yang diberikan pelanggan pada form "Selesaikan Tiket".\n\nMohon segera ditangani. Terima kasih atas kerjasamanya.\nTim Layanan ${global.config.nama || "Kami"}`;

    if (teknisiAccounts.length > 0) {
        for (const teknisi of teknisiAccounts) {
            let teknisiJid = teknisi.phone_number.trim();
            if (!teknisiJid.endsWith('@s.whatsapp.net')) {
                if (teknisiJid.startsWith('0')) {
                    teknisiJid = `62${teknisiJid.substring(1)}@s.whatsapp.net`;
                } else if (teknisiJid.startsWith('62')) {
                    teknisiJid = `${teknisiJid}@s.whatsapp.net`;
                } else {
                    console.warn(`[LAPORAN_WARN] Nomor teknisi tidak valid untuk JID: ${teknisi.phone_number}`);
                    continue;
                }
            }
            // PENTING: Cek connection state dan gunakan error handling sesuai rules
            if (global.whatsappConnectionState === 'open' && raf && raf.sendMessage) {
                try {
                    await raf.sendMessage(teknisiJid, { text: messageToTeknisi });
                    await sleep(1000);
                } catch (err) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        teknisiJid,
                        error: err.message
                    });
                    console.error(`[LAPORAN_ERROR] Gagal mengirim laporan ke teknisi ${teknisi.username} (${teknisiJid}):`, err.message);
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to teknisi', teknisi.username);
            }
        }
    } else {
        console.warn("[LAPORAN_WARN] Tidak ada akun teknisi yang memiliki nomor telepon terdaftar untuk menerima notifikasi.");
        if (Array.isArray(global.config.ownerNumber) && global.config.ownerNumber.length > 0) {
            const fallbackMessageToOwner = `⚠️ *PERHATIAN: LAPORAN BARU DITERIMA (ID: ${ticketId}) TAPI TIDAK ADA TEKNISI AKTIF*\n\nPelanggan: ${pelangganPushName} (${pelangganPlainNumber}) - ${linkWaPelanggan}\nLaporan:\n${laporanLengkap}\n\nWaktu: ${waktuLaporFormatted}\n\nMohon segera ditindaklanjuti manual. Teknisi akan meminta ID tiket ke pelanggan setelah penanganan selesai.`;
            for (const ownerNum of global.config.ownerNumber) {
                let ownerJid = String(ownerNum).trim();
                if (!ownerJid.endsWith('@s.whatsapp.net')) {
                    if (ownerJid.startsWith('0')) ownerJid = `62${ownerJid.substring(1)}@s.whatsapp.net`;
                    else if (ownerJid.startsWith('62')) ownerJid = `${ownerJid}@s.whatsapp.net`;
                    else {
                         console.warn(`[LAPORAN_WARN] Format nomor Owner tidak valid: ${ownerNum}`);
                         continue;
                    }
                }
                // PENTING: Cek connection state dan gunakan error handling sesuai rules
                if (global.whatsappConnectionState === 'open' && raf && raf.sendMessage) {
                    try {
                        await raf.sendMessage(ownerJid, { text: fallbackMessageToOwner });
                    } catch (e) {
                        console.error('[SEND_MESSAGE_ERROR]', {
                            ownerJid,
                            error: e.message
                        });
                        console.error(`[LAPORAN_ERROR] Gagal mengirim fallback laporan ke owner ${ownerJid}:`, e.message);
                    }
                } else {
                    console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to owner', ownerJid);
                }
            }
        }
    }
    
    return ticketId; // Return ticket ID for reference
}

module.exports = {
    generateTicketId,
    saveReportsToFile,
    buatLaporanGangguan
};
