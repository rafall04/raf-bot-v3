/**
 * Header Doc
 * Purpose: Compatibility handler untuk pembuatan tiket pelanggan dan delegasi persistence draft laporan ke repository owner.
 * Caller: `message/raf.js`, general report steps, dan caller legacy pembuatan tiket.
 * Deps: `../../lib/report-orchestration-service` dan `../../repositories/ticket.repository`.
 * MainFuncs: `saveReportsToFile`, `generateTicketId`, dan `buatLaporanGangguan`.
 * SideEffects: Menulis draft laporan via repository owner dan mengirim balasan konfirmasi pelanggan.
 */
"use strict";

const { createCustomerReportTicket } = require("../../lib/report-orchestration-service");
const { createTicketRepository } = require("../../repositories/ticket.repository");

const ticketRepository = createTicketRepository();

function saveReportsToFile(data) {
    return ticketRepository.saveReportDraft(data);
}

function generateTicketId() {
    return ticketRepository.generateTicketId();
}

async function buatLaporanGangguan(pelangganId, pelangganPushName, userPelanggan, laporanLengkap, reply) {
    const report = await createCustomerReportTicket({
        user: userPelanggan,
        sender: pelangganId,
        laporanText: laporanLengkap,
        issueType: 'GENERAL',
        priority: 'MEDIUM',
        createdBy: pelangganId,
        createdByRole: 'customer_wa_legacy',
        customerPhotos: [],
        photoBuffers: [],
        notifyAdmins: true,
        additionalFields: {
            pelangganPushName,
            pelangganDataSystem: {
                id: userPelanggan.id,
                name: userPelanggan.name,
                address: userPelanggan.address,
                subscription: userPelanggan.subscription,
                pppoe_username: userPelanggan.pppoe_username
            }
        }
    });

    const detailPelangganInfoUntukPelanggan = `*Nama Terdaftar:* ${userPelanggan.name || pelangganPushName}\n*Layanan/Paket:* ${userPelanggan.subscription || 'Tidak terinfo'}\n`;
    const pesanKonfirmasiKePelanggan = `✨ *Laporan Anda Telah Diterima* ✨\n\nHalo ${pelangganPushName},\n\nTerima kasih telah menghubungi Layanan ${global.config.nama || "Kami"}. Laporan Anda yang telah kami rangkum telah berhasil dicatat dan akan segera kami proses.\n\nBerikut adalah detail laporan Anda:\n-----------------------------------\n*Nomor Tiket Anda:* *${report.ticketId}*\n${detailPelangganInfoUntukPelanggan}*Isi Laporan (Lengkap):*\n"${laporanLengkap}"\n-----------------------------------\n\nMohon simpan Nomor Tiket di atas untuk kemudahan pengecekan status laporan Anda di kemudian hari. Tim teknisi kami akan segera meninjau dan menangani laporan Anda. Anda akan menerima notifikasi lebih lanjut mengenai perkembangan laporan ini.\n\nKami menghargai kesabaran Anda.\n\nHormat kami,\nTim ${global.config.namabot || "Bot Kami"}`;

    await reply(pesanKonfirmasiKePelanggan);
    return report.ticketId;
}

module.exports = {
    generateTicketId,
    saveReportsToFile,
    buatLaporanGangguan
};
