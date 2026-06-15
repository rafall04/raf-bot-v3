/**
 * Smart Report Hybrid Handler
 * Continuation flow laporan langsung: konfirmasi MATI (device online) dan troubleshoot LEMOT.
 * Catatan: setter direct-report (handleDirectMatiReport/handleDirectLemotReport) sudah dihapus —
 * entry flow laporan kini dimiliki smart-report-text-menu.js (key state kanonik via stateSender).
 */

const { getUserState, deleteUserState } = require('./conversation-handler');
const { createCustomerReportTicket } = require('../../lib/report-orchestration-service');

/**
 * Create ticket directly without menu
 */
async function createDirectTicket({ user, issueType, priority, deviceStatus, description, sender }) {
    const report = await createCustomerReportTicket({
        user,
        sender,
        laporanText: description,
        issueType,
        priority,
        createdBy: sender,
        createdByRole: 'customer',
        additionalFields: {
            deviceOnline: deviceStatus?.online !== false,
            directReport: true
        }
    });

    return report.ticketId;
}

/**
 * Handle confirmation responses
 */
async function handleDirectConfirmation({ sender, response, reply: _reply }) {
    const state = getUserState(sender);
    if (!state || state.step !== 'CONFIRM_DIRECT_MATI') {
        return { success: false };
    }

    const answer = response.toLowerCase().trim();

    if (answer === 'ya' || answer === 'y' || answer === 'yes') {
        const ticketId = await createDirectTicket({
            user: state.userData,
            issueType: 'MATI',
            priority: 'HIGH',
            deviceStatus: state.deviceStatus,
            description: 'Internet mati (Device online, user konfirm)',
            sender
        });

        deleteUserState(sender);

        return {
            success: true,
            message: `✅ *LAPORAN BERHASIL DIBUAT*\n\n` +
                `📋 ID Tiket: *${ticketId}*\n` +
                `⚡ Prioritas: 🔴 URGENT\n` +
                `⏱️ Estimasi: 30-60 menit\n\n` +
                `Tim teknisi akan segera menangani.\n` +
                `Cek status: *cektiket ${ticketId}*`
        };
    } else if (answer === 'tidak' || answer === 'no' || answer === 'n') {
        deleteUserState(sender);
        return {
            success: true,
            message: '❌ Pembuatan laporan dibatalkan.\n\n' +
                '💡 Tips: Coba restart router Anda terlebih dahulu.'
        };
    } else {
        return {
            success: false,
            message: '⚠️ Mohon balas dengan *YA* atau *TIDAK*'
        };
    }
}

/**
 * Handle direct lemot troubleshoot response
 */
async function handleDirectLemotResponse({ sender, response, reply: _reply }) {
    const state = getUserState(sender);
    if (!state || state.step !== 'DIRECT_LEMOT_TROUBLESHOOT') {
        return { success: false };
    }

    const answer = response.toLowerCase().trim();

    if (answer.includes('sudah') || answer.includes('solved')) {
        deleteUserState(sender);
        return {
            success: true,
            message: `✅ *GREAT! PROBLEM SOLVED!*\n\n` +
                `Senang bisa membantu! 🎉\n\n` +
                `💡 Tips agar stabil:\n` +
                `• Restart router rutin (1x/minggu)\n` +
                `• Jaga ventilasi router\n` +
                `• Update firmware bila ada\n\n` +
                `Terima kasih! 😊`
        };
    } else if (answer.includes('belum') || answer.includes('tidak')) {
        const ticketId = await createDirectTicket({
            user: state.userData,
            issueType: 'LEMOT',
            priority: 'MEDIUM',
            deviceStatus: { online: true },
            description: 'Internet lemot - Troubleshooting tidak berhasil',
            sender
        });

        deleteUserState(sender);

        return {
            success: true,
            message: `✅ *LAPORAN BERHASIL DIBUAT*\n\n` +
                `📋 ID Tiket: *${ticketId}*\n` +
                `⚡ Prioritas: 🟡 NORMAL\n` +
                `⏱️ Estimasi: 2-4 jam\n\n` +
                `Tim teknisi akan segera menangani.\n` +
                `Cek status: *cektiket ${ticketId}*`
        };
    } else {
        return {
            success: false,
            message: '⚠️ Mohon balas:\n• *SUDAH* jika membaik\n• *BELUM* jika masih lemot'
        };
    }
}

module.exports = {
    handleDirectConfirmation,
    handleDirectLemotResponse,
    createDirectTicket
};
