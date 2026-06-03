/**
 * Smart Report Hybrid Handler
 * Handles both direct reporting and menu-based reporting
 * Best of both worlds - flexible untuk semua tipe user
 */

const { isDeviceOnline, getDeviceOfflineMessage } = require('../../lib/device-status');
const { setUserState, getUserState, deleteUserState } = require('./conversation-handler');
const { getResponseTimeMessage, isWithinWorkingHours } = require('../../lib/working-hours-helper');
const { createCustomerReportTicket } = require('../../lib/report-orchestration-service');
const { notifyNewReport } = require('../../lib/report-notification-service');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');
const { resolveCustomerBySender } = require('../../lib/jid-utils');

// Generate ticket ID
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
 * Handle Direct Internet Mati Report
 * Langsung proses tanpa menu
 */
async function handleDirectMatiReport({ sender, pushname, reply, msg, raf }) {
    try {
        // Resolusi pelanggan terpadu (LID-aware: remoteJidAlt → getPNForLID → stored-mapping → pre-warm USync).
        const { user } = await resolveCustomerBySender({ users: global.users, sender, msg, raf });

        // Handle @lid users - no manual verification needed
        if (!user && sender.endsWith('@lid')) {
            return {
                success: false,
                message: `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`
            };
        }

        if (!user) {
            return {
                success: false,
                message: '❌ Nomor Anda belum terdaftar.\n\nSilakan hubungi admin untuk mendaftar.'
            };
        }

        // Check existing active report
        const activeReport = global.reports.find(r =>
            r.pelangganUserId === user.id &&
            r.status !== 'selesai' &&
            r.status !== 'cancelled' &&
            r.status !== 'pending'
        );

        if (activeReport) {
            return {
                success: false,
                message: `⚠️ Anda sudah punya laporan aktif:\nID: *${activeReport.ticketId}*\n\nKetik *cektiket ${activeReport.ticketId}* untuk status.`
            };
        }

        // Check device status
        const deviceStatus = await isDeviceOnline(user.user_id || user.id);

        let confirmMessage = `🔴 *KONFIRMASI LAPORAN - INTERNET MATI*\n\n`;

        if (deviceStatus.online === false) {
            confirmMessage += `✅ Device terdeteksi *OFFLINE*\n`;
            confirmMessage += `⏰ Terakhir online: ${deviceStatus.lastSeen || 'Tidak diketahui'}\n\n`;
            confirmMessage += `Laporan akan segera dibuat.\n\n`;
            confirmMessage += `Tunggu sebentar...`;

            // Auto create ticket
            const ticketId = await createDirectTicket({
                user,
                issueType: 'MATI',
                priority: 'HIGH',
                deviceStatus,
                description: 'Internet mati total - Lapor langsung',
                sender
            });

            return {
                success: true,
                message: `✅ *LAPORAN BERHASIL DIBUAT*\n\n` +
                    `📋 ID Tiket: *${ticketId}*\n` +
                    `⚡ Prioritas: 🔴 URGENT\n` +
                    `⏱️ Estimasi: 30-60 menit\n\n` +
                    `Tim teknisi akan segera menangani.\n` +
                    `Cek status: *cektiket ${ticketId}*`
            };
        } else {
            // Device online, need confirmation
            confirmMessage += `⚠️ Device terdeteksi masih *ONLINE*\n\n`;
            confirmMessage += `Kemungkinan:\n`;
            confirmMessage += `• Masalah di perangkat/WiFi lokal\n`;
            confirmMessage += `• Router perlu restart\n\n`;
            confirmMessage += `Apakah tetap buat laporan?\n`;
            confirmMessage += `Balas *YA* atau *TIDAK*`;

            setUserState(sender, {
                step: 'CONFIRM_DIRECT_MATI',
                userData: user,
                deviceStatus
            });

            return {
                success: true,
                message: confirmMessage
            };
        }

    } catch (error) {
        console.error('[DIRECT_MATI_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal membuat laporan. Silakan coba lagi.'
        };
    }
}

/**
 * Handle Direct Internet Lemot Report
 * Langsung masuk troubleshooting
 */
async function handleDirectLemotReport({ sender, pushname, reply, msg, raf }) {
    try {
        // Resolusi pelanggan terpadu (LID-aware: remoteJidAlt → getPNForLID → stored-mapping → pre-warm USync).
        const { user } = await resolveCustomerBySender({ users: global.users, sender, msg, raf });

        // Handle @lid users - no manual verification needed
        if (!user && sender.endsWith('@lid')) {
            return {
                success: false,
                message: `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`
            };
        }

        if (!user) {
            return {
                success: false,
                message: '❌ Nomor Anda belum terdaftar.\n\nSilakan hubungi admin untuk mendaftar.'
            };
        }

        // Check existing active report
        const activeReport = global.reports.find(r =>
            r.pelangganUserId === user.id &&
            r.status !== 'selesai' &&
            r.status !== 'cancelled' &&
            r.status !== 'pending'
        );

        if (activeReport) {
            return {
                success: false,
                message: `⚠️ Anda sudah punya laporan aktif:\nID: *${activeReport.ticketId}*\n\nKetik *cektiket ${activeReport.ticketId}* untuk status.`
            };
        }

        // Direct to troubleshooting
        setUserState(sender, {
            step: 'DIRECT_LEMOT_TROUBLESHOOT',
            userData: user,
            issueType: 'LEMOT'
        });

        return {
            success: true,
            message: `🔍 *TROUBLESHOOTING CEPAT*\n\n` +
                `Sebelum membuat laporan, coba:\n\n` +
                `1️⃣ *RESTART ROUTER*\n` +
                `   Cabut power 10 detik\n\n` +
                `2️⃣ *CEK DEVICE LAIN*\n` +
                `   Apakah semua device lemot?\n\n` +
                `3️⃣ *KURANGI BEBAN*\n` +
                `   Matikan download/streaming\n\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `Apakah sudah membaik?\n\n` +
                `Balas:\n` +
                `• *SUDAH* - Problem solved ✅\n` +
                `• *BELUM* - Buat laporan 📝`
        };

    } catch (error) {
        console.error('[DIRECT_LEMOT_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal memproses. Silakan coba lagi.'
        };
    }
}

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
async function handleDirectConfirmation({ sender, response, reply }) {
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
async function handleDirectLemotResponse({ sender, response, reply }) {
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

/**
 * Notify technicians
 */
async function notifyTechnicians(report) {
    return notifyNewReport(report, { photoBuffers: report.photoBuffers || [] });
    const teknisiAccounts = global.accounts.filter(acc => acc.role === 'teknisi');

    for (const teknisi of teknisiAccounts) {
        if (!teknisi.phone_number) continue;

        const teknisiJid = teknisi.phone_number.includes('@') ?
            teknisi.phone_number :
            `${teknisi.phone_number}@s.whatsapp.net`;

        const urgentIcon = report.priority === 'HIGH' ? '🚨 URGENT!' : '📢';
        const message = `${urgentIcon} *TIKET BARU*\n\n` +
            `📋 ID: *${report.ticketId}*\n` +
            `👤 ${report.pelangganName}\n` +
            `📱 ${report.pelangganPhone}\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `*Masalah:* ${report.laporanText}\n` +
            `*Direct Report:* ${report.directReport ? '✅ Ya' : '❌ Tidak'}\n\n` +
            `Ketik: *proses ${report.ticketId}*`;

        try {
            await sendMessage(teknisiJid, { text: message });
        } catch (err) {
            console.error(`[NOTIFY_ERROR] Failed to notify ${teknisi.username}:`, err);
        }
    }
}

module.exports = {
    handleDirectMatiReport,
    handleDirectLemotReport,
    handleDirectConfirmation,
    handleDirectLemotResponse,
    createDirectTicket
};
