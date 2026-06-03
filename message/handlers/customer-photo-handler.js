/**
 * Customer Photo Upload Handler
 * Handle optional photo uploads from customers when reporting issues.
 * Ticket creation and notifications are delegated to orchestration services.
 */

const { deleteUserState } = require('./conversation-handler');
const { getResponseTimeMessage } = require('../../lib/working-hours-helper');
const { createCustomerReportTicket } = require('../../lib/report-orchestration-service');

async function handleCustomerPhotoUpload({ sender, state, chats }) {
    const response = chats.toLowerCase().trim();

    if (Date.now() - (state.startTime || Date.now()) > 300000) {
        const report = await saveReportAndNotify(state, false);
        deleteUserState(sender);
        return {
            success: true,
            message: `⏱️ Timeout upload foto. Laporan tetap dibuat tanpa foto.\n\nTiket *${report.ticketId}* telah dibuat. Teknisi akan segera menghubungi Anda.`
        };
    }

    if (['skip', 'lewati', 'tidak'].includes(response)) {
        const report = await saveReportAndNotify(state, false);
        deleteUserState(sender);
        return {
            success: true,
            message: `✅ *LAPORAN BERHASIL DIBUAT*\n\n📋 ID Tiket: *${report.ticketId}*\n⚡ Prioritas: *HIGH - URGENT*\n⏱️ Estimasi: ${getResponseTimeMessage('HIGH')}\n\nTeknisi telah diberitahu dan akan segera menangani.`
        };
    }

    if (['lanjut', 'done', 'selesai'].includes(response)) {
        const photoCount = state.uploadedPhotos ? state.uploadedPhotos.length : 0;
        if (photoCount === 0) {
            return {
                success: false,
                message: '⚠️ Belum ada foto yang diupload.\n\nSilakan upload foto atau ketik *skip* untuk lewati.'
            };
        }

        const report = await saveReportAndNotify(state, true);
        deleteUserState(sender);
        return {
            success: true,
            message: `✅ *LAPORAN BERHASIL DIBUAT*\n\n📋 ID Tiket: *${report.ticketId}*\n⚡ Prioritas: *HIGH - URGENT*\n📸 Foto dilampirkan: ${photoCount} foto\n⏱️ Estimasi: ${getResponseTimeMessage('HIGH')}\n\nTeknisi telah menerima foto Anda dan akan segera menangani.`
        };
    }

    return {
        success: false,
        message: `📸 Silakan:\n• Upload foto (kirim gambar)\n• Ketik *lanjut* jika sudah selesai upload\n• Ketik *skip* jika tidak ada foto\n\nFoto tersisa: ${3 - (state.uploadedPhotos?.length || 0)} dari 3`
    };
}

async function saveReportAndNotify(state, withPhotos = false) {
    const ticketData = state.ticketData || {};
    const user = state.targetUser || state.customer || state.userData;
    const customerPhotos = withPhotos && Array.isArray(state.uploadedPhotos) ? state.uploadedPhotos : [];

    const report = await createCustomerReportTicket({
        user,
        sender: ticketData.pelangganId || senderFromState(state),
        laporanText: ticketData.laporanText,
        issueType: ticketData.issueType || 'MATI',
        priority: ticketData.priority || 'HIGH',
        createdBy: senderFromState(state),
        createdByRole: 'customer_wa',
        customerPhotos,
        photoBuffers: withPhotos ? (state.photoBuffers || []) : [],
        additionalFields: {
            deviceOnline: ticketData.deviceOnline,
            troubleshootingDone: ticketData.troubleshootingDone,
            hasCustomerPhotos: customerPhotos.length > 0
        }
    });

    state.ticketData = report;
    return report;
}

function senderFromState(state) {
    return state.sender || state.ticketData?.pelangganId || '';
}

module.exports = {
    handleCustomerPhotoUpload,
    saveReportAndNotify
};
