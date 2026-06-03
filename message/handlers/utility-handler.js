/**
 * Header Doc
 * Purpose: Handler utilitas umum (kontak admin, bantuan, sapaan, cek tiket) lewat perintah WhatsApp.
 * Caller: Dispatcher bot `message/raf.js` pada intent `ADMIN`, `BANTUAN`, `SAPAAN_UMUM`, `CEK_TIKET`.
 * Deps: `../../lib/template-manager`, `../../lib/templating`, `./template-helpers` (renderResponseTemplate).
 * MainFuncs: `handleAdminContact`, `handleBantuan`, `handleSapaanUmum`, `handleCekTiket`.
 * SideEffects: Mengirim contact card dan reply WhatsApp.
 */

const templateManager = require('../../lib/template-manager');
const { greetingMessage, errorMessage, validationMessage } = require('../../lib/templating');
const { renderResponseTemplate } = require('./template-helpers');

/**
 * Handle admin contact
 */
function handleAdminContact(from, ownerNumber, config, msg, sendContact, reply) {
    if (!ownerNumber || ownerNumber.length === 0 || !ownerNumber[0]) {
        return reply(renderResponseTemplate(
            'utility_admin_contact_missing',
            '❌ Nomor admin tidak tersedia. Silakan hubungi support.'
        ));
    }
    sendContact(from, `${ownerNumber[0]}`, `Admin ${config.nama || 'Admin'}`, msg);
}

/**
 * Handle bantuan
 */
function handleBantuan(pushname, config, reply) {
    const namaLayanan = config.nama || "Layanan Kami";
    const namaBot = config.namabot || "Bot Kami";

    // Use template_manager first (editable via admin), fallback to responseTemplates.utility_bantuan_fallback, lalu hardcoded akhir.
    if (templateManager.hasTemplate('bantuan')) {
        const message = templateManager.getTemplate('bantuan', {
            pushname: pushname || 'Kak',
            nama_layanan: namaLayanan,
            nama_bot: namaBot
        });
        reply(message);
        return;
    }

    const fallbackBantuan = `Hai ${pushname} 👋

*PANDUAN BANTUAN ${namaLayanan.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━

📌 *CARA MENGGUNAKAN BOT:*
1. Ketik perintah yang diinginkan
2. Ikuti instruksi yang diberikan
3. Tunggu respon dari bot

📋 *PERINTAH UTAMA:*
• *menu* - Tampilkan menu utama
• *lapor* - Laporkan gangguan
• *ceksaldo* - Cek saldo Anda
• *admin* - Hubungi admin

🔧 *TIPS:*
• Gunakan perintah dengan benar
• Jangan spam perintah
• Tunggu respon sebelum mengirim perintah baru

📞 *BUTUH BANTUAN LEBIH?*
Hubungi admin dengan mengetik *admin*

━━━━━━━━━━━━━━━━━━━
_${namaBot} - Siap membantu Anda 24/7_`;

    reply(renderResponseTemplate(
        'utility_bantuan_fallback',
        fallbackBantuan,
        {
            pushname: pushname || 'Kak',
            nama_layanan: namaLayanan,
            nama_layanan_upper: namaLayanan.toUpperCase(),
            nama_bot: namaBot
        }
    ));
}

/**
 * Handle sapaan umum
 */
function handleSapaanUmum(pushname, reply) {
    // Use new system greeting message
    const message = greetingMessage(pushname);
    reply(message);
}

/**
 * Handle cek tiket
 */
function handleCekTiket(q, pushname, sender, isOwner, isTeknisi, config, global, reply) {
    if (!q) {
        return reply(validationMessage('required_field', {
            field_name: 'ID Tiket',
            format_example: 'cektiket ABC123'
        }));
    }

    const ticketIdToCheck = q.trim();
    const report = global.reports.find(r => r.ticketId && r.ticketId.toLowerCase() === ticketIdToCheck.toLowerCase());

    const namaLayanan = config.nama || "Layanan Kami";
    const namaBotKami = config.namabot || "Bot Kami";

    if (!report) {
        return reply(errorMessage('not_found', {
            nama: pushname,
            item: `tiket dengan ID "${ticketIdToCheck}"`,
            suggestion: 'Pastikan ID Tiket yang Anda masukkan sudah benar, atau hubungi Admin jika Anda yakin tiket tersebut ada.'
        }));
    }

    if (!isOwner && !isTeknisi && report.pelangganId !== sender) {
        return reply(renderResponseTemplate(
            'utility_cek_tiket_not_owned',
            `🚫 Maaf Kak ${pushname}, Anda hanya dapat memeriksa tiket laporan milik Anda sendiri. Tiket ID "*${ticketIdToCheck}*" tidak terdaftar atas nama Anda.`,
            { pushname: pushname || 'Kak', ticket_id: ticketIdToCheck }
        ));
    }

    const namaPelanggan = report.pelangganName || report.pelangganPushName || (report.pelangganDataSystem ? report.pelangganDataSystem.name : "N/A");
    const layananPelanggan = report.pelangganSubscription || 
                           (report.pelangganDataSystem && report.pelangganDataSystem.subscription) || 
                           "Tidak terinfo";
    const cuplikanLaporan = report.laporanText.substring(0, 150) + (report.laporanText.length > 150 ? '...' : '');

    const optionsDateFormat = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' };
    const tanggalDibuatFormatted = new Date(report.createdAt).toLocaleString('id-ID', optionsDateFormat);

    let statusDetail = "";
    let pesanTambahan = "";

    switch(report.status) {
        case 'pending':
            statusDetail = "🕒 *MENUNGGU DIPROSES*";
            pesanTambahan = "Laporan Anda sedang dalam antrian. Teknisi akan segera memproses.";
            break;
        case 'assigned':
            statusDetail = "👷 *TEKNISI DITUGASKAN*";
            pesanTambahan = report.teknisiName ? 
                `Teknisi *${report.teknisiName}* telah ditugaskan untuk menangani gangguan Anda.` :
                "Teknisi telah ditugaskan untuk menangani gangguan Anda.";
            break;
        case 'process':
        case 'processing':
            statusDetail = "🔧 *SEDANG DIPROSES*";
            pesanTambahan = report.teknisiName ? 
                `Teknisi *${report.teknisiName}* sedang dalam perjalanan ke lokasi Anda.` :
                "Teknisi sedang dalam perjalanan ke lokasi Anda.";
            break;
        case 'otw':
            statusDetail = "🚗 *TEKNISI MENUJU LOKASI*";
            pesanTambahan = report.teknisiName ? 
                `Teknisi *${report.teknisiName}* sedang menuju ke lokasi Anda.` :
                "Teknisi sedang menuju ke lokasi Anda.";
            break;
        case 'arrived':
            statusDetail = "📍 *TEKNISI TIBA DI LOKASI*";
            pesanTambahan = "Teknisi sudah tiba di lokasi Anda dan akan segera memulai perbaikan.";
            break;
        case 'working':
            statusDetail = "🛠️ *SEDANG DIPERBAIKI*";
            pesanTambahan = "Teknisi sedang melakukan perbaikan. Mohon ditunggu.";
            break;
        case 'resolved':
        case 'completed':
            statusDetail = "✅ *SELESAI*";
            const durasiMenit = report.workDuration || 
                (report.resolvedAt && report.startTime ? 
                    Math.floor((report.resolvedAt - report.startTime) / (1000 * 60)) : 
                    "N/A");
            pesanTambahan = `Gangguan telah selesai diperbaiki${durasiMenit !== "N/A" ? ` (durasi: ${durasiMenit} menit)` : ''}.${report.resolutionNotes ? '\n📝 Catatan: ' + report.resolutionNotes : ''}`;
            break;
        case 'cancelled':
            statusDetail = "❌ *DIBATALKAN*";
            pesanTambahan = "Tiket ini telah dibatalkan.";
            break;
        default:
            statusDetail = `📋 *${report.status.toUpperCase()}*`;
            pesanTambahan = "Status tiket sedang diperbarui.";
    }

    const replyMessage = `📋 *INFORMASI TIKET GANGGUAN*

━━━━━━━━━━━━━━━━
🎫 *ID Tiket:* ${report.ticketId}
📅 *Tanggal:* ${tanggalDibuatFormatted}
━━━━━━━━━━━━━━━━

👤 *DATA PELANGGAN:*
• Nama: ${namaPelanggan}
• Layanan: ${layananPelanggan}

📝 *LAPORAN:*
${cuplikanLaporan}

📊 *STATUS SAAT INI:*
${statusDetail}

💬 ${pesanTambahan}

━━━━━━━━━━━━━━━━
_${namaBotKami} - ${namaLayanan}_`;

    reply(replyMessage);
}

module.exports = {
    handleAdminContact,
    handleBantuan,
    handleSapaanUmum,
    handleCekTiket
};
