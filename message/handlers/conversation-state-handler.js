/**
 * Header Doc
 * Purpose: Menangani state conversation legacy/managed dengan store state terkelola sebagai source of truth.
 * Caller: `message/handlers/raf-state-routing.js`.
 * Deps: `conversation-handler`, sub-handler state WiFi/report/other, `axios`, `rupiah-format`.
 * MainFuncs: `handleConversationState`.
 * SideEffects: Memperbarui state managed, memanggil workflow domain, dan mengirim reply.
 */

const axios = require('axios');
const convertRupiah = require('rupiah-format');
const { getUserState, deleteUserState } = require('./conversation-handler');
const { renderResponseTemplate } = require('./template-helpers');

// Import all state sub-handlers
const {
    handleSelectChangeMode,
    handleSelectSsidToChange,
    handleAskNewName,
    handleAskNewNameBulkAuto,
    handleConfirmGantiNamaBulk: _handleConfirmGantiNamaBulk
} = require('./states/wifi-name-state-handler');

const {
    handleSelectPasswordMode,
    handleSelectSsidPassword,
    handleAskNewPassword,
    handleAskNewPasswordBulk,
    handleAskNewPasswordBulkAuto,
    handleConfirmGantiSandi: _handleConfirmGantiSandi,
    handleConfirmGantiSandiBulk: _handleConfirmGantiSandiBulk
} = require('./states/wifi-password-state-handler');

const {
    handleConfirmCancelTicket,
    handleConfirmReboot,
    handleAwaitingComplaint,
    handleSelectSodChoice,
    handleConfirmSodChoice,
    handleAskPackageChoice,
    handleConfirmPackageChoice
} = require('./states/other-state-handler');

/**
 * Main handler for conversation state management
 * @param {Object} params - Parameters object
 * @returns {Promise<void>}
 */
async function handleConversationState(params) {
    const {
        sender,
        chats,
        reply,
        global,
        isOwner: _isOwner,
        isTeknisi: _isTeknisi,
        users: _users,
        args: _args,
        entities: _entities,
        plainSenderNumber: _plainSenderNumber,
        pushname,
        mess: _mess,
        sleep: _sleep,
        getSSIDInfo: _getSSIDInfo,
        namabot: _namabot,
        buatLaporanGangguan: _buatLaporanGangguan
    } = params;

    // Always use managed state store as the source of truth.
    const userState = getUserState(sender);
    if (!userState || !userState.step) {
        return;
    }
    const userReply = chats.toLowerCase().trim();

    // Universal cancel commands
    if (['batal', 'cancel', 'ga jadi', 'gak jadi'].includes(userReply)) {
        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'conversation_universal_cancel',
            "Baik, permintaan sebelumnya telah dibatalkan. Ada lagi yang bisa saya bantu?"
        ));
    }

    // Handle based on stored step
    switch (userState.step) {
        // ========== WiFi Name Change States ==========
        case 'SELECT_CHANGE_MODE_FIRST':
        case 'SELECT_CHANGE_MODE': {
            return handleSelectChangeMode(userState, userReply, reply);
        }

        case 'SELECT_SSID_TO_CHANGE': {
            return handleSelectSsidToChange(userState, userReply, reply);
        }

        case 'ASK_NEW_NAME_FOR_SINGLE': // Single SSID without bulk
        case 'ASK_NEW_NAME_FOR_SINGLE_BULK': // Single from bulk selection
        case 'ASK_NEW_NAME_FOR_BULK': { // All SSIDs in bulk
            return handleAskNewName(userState, chats, reply, sender, global);
        }

        case 'ASK_NEW_NAME_FOR_BULK_AUTO': {
            return handleAskNewNameBulkAuto(userState, chats, reply, sender, global, axios);
        }

        case 'CONFIRM_GANTI_NAMA':
        case 'CONFIRM_GANTI_NAMA_BULK': {
            const { handleConfirmGantiNamaBulk } = require('./states/wifi-name-state-handler');
            return handleConfirmGantiNamaBulk(userState, userReply, reply, sender, global, axios);
        }

        // ========== WiFi Password Change States ==========
        case 'SELECT_CHANGE_PASSWORD_MODE':
        case 'SELECT_CHANGE_PASSWORD_MODE_FIRST': {
            return handleSelectPasswordMode(userState, userReply, reply, sender);
        }

        case 'SELECT_SSID_PASSWORD':
        case 'SELECT_SSID_PASSWORD_FIRST': {
            return handleSelectSsidPassword(userState, userReply, reply, sender);
        }

        case 'ASK_NEW_PASSWORD': {
            return handleAskNewPassword(userState, chats, reply, sender, global);
        }

        case 'ASK_NEW_PASSWORD_BULK': {
            return handleAskNewPasswordBulk(userState, chats, reply, sender, global);
        }

        case 'ASK_NEW_PASSWORD_BULK_AUTO': {
            return handleAskNewPasswordBulkAuto(userState, chats, reply, sender, global, axios);
        }

        case 'CONFIRM_GANTI_SANDI': {
            const { handleConfirmGantiSandi } = require('./states/wifi-password-state-handler');
            return handleConfirmGantiSandi(userState, userReply, reply, sender, global, axios);
        }

        case 'CONFIRM_GANTI_SANDI_BULK': {
            const { handleConfirmGantiSandiBulk } = require('./states/wifi-password-state-handler');
            return handleConfirmGantiSandiBulk(userState, userReply, reply, sender, global, axios);
        }

        // ========== Other Confirmation States ==========
        case 'CONFIRM_CANCEL_TICKET': {
            return handleConfirmCancelTicket(userState, userReply, reply, sender, global, pushname);
        }

        case 'CONFIRM_REBOOT': {
            return handleConfirmReboot(userState, userReply, reply, sender, global, axios);
        }

        case 'AWAITING_COMPLAINT': {
            return handleAwaitingComplaint(userState, chats, reply, sender, pushname);
        }

        case 'SELECT_SOD_CHOICE': {
            return handleSelectSodChoice(userState, userReply, reply, convertRupiah);
        }

        case 'CONFIRM_SOD_CHOICE': {
            return handleConfirmSodChoice(userState, userReply, reply, sender, global);
        }

        case 'ASK_PACKAGE_CHOICE': {
            return handleAskPackageChoice(userState, userReply, reply, convertRupiah);
        }

        case 'CONFIRM_PACKAGE_CHOICE': {
            return handleConfirmPackageChoice(userState, userReply, reply, sender, global);
        }

        default:
            console.log(`[CONVERSATION_STATE] Unknown step: ${userState.step}`);
            deleteUserState(sender);
            return reply(renderResponseTemplate(
                'conversation_unknown_step_error',
                "Maaf, terjadi kesalahan dalam proses. Silakan coba lagi dari awal."
            ));
    }
}

module.exports = {
    handleConversationState
};
