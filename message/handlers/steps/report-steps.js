"use strict";

/**
 * Report/Ticket Conversation Steps
 * Only handles ticket cancellation (CONFIRM_CANCEL_TICKET)
 */

const { setUserState, deleteUserState } = require('../conversation-handler');
const fs = require('fs');
const path = require('path');

/**
 * Handle report/ticket conversation steps
 */
async function handleReportSteps({ userState, sender, chats, pushname, reply, setUserState, deleteUserState }) {
    const userReply = chats.toLowerCase().trim();
    
    switch (userState.step) {
        case 'CONFIRM_CANCEL_TICKET': {
            if (['ya', 'ok', 'lanjut', 'iya', 'y'].includes(userReply)) {
                const { ticketIdToCancel } = userState;
                const reportIndex = global.reports.findIndex(r => r.ticketId === ticketIdToCancel);
                
                if (reportIndex !== -1) {
                    global.reports[reportIndex].status = 'dibatalkan';
                    global.reports[reportIndex].cancelledAt = new Date().toISOString();
                    global.reports[reportIndex].cancelledBy = pushname;
                    
                    // Save to file
                    try {
                        const reportsPath = path.join(__dirname, '../../../database/reports.json');
                        fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
                    } catch (error) {
                        console.error('[SAVE_REPORT_ERROR]', error);
                    }
                    
                    deleteUserState(sender);
                    
                    return {
                        success: true,
                        message: `✅ Tiket dengan ID *${ticketIdToCancel}* telah dibatalkan.`
                    };
                } else {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: `❌ Tiket dengan ID *${ticketIdToCancel}* tidak ditemukan.`
                    };
                }
            } else if (['tidak', 'no', 'n', 'gak'].includes(userReply)) {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Pembatalan tiket dibatalkan. Tiket tetap aktif.'
                };
            } else {
                return {
                    success: false,
                    message: "Mohon balas dengan *'ya'* untuk membatalkan tiket atau *'tidak'* untuk membatalkan aksi ini."
                };
            }
        }
    }
    
    return {
        success: false,
        message: 'Step tidak dikenali.'
    };
}

module.exports = {
    handleReportSteps
};
