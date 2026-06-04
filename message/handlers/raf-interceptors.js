// State yang user-facing tidak boleh terinterupsi oleh global command (menu, lapor, dst).
// Keluar dari state ini hanya bisa lewat *batal/cancel* atau penyelesaian alur normal.
const PROTECTED_STATES = [
    // WiFi input (pelanggan/teknisi)
    'ASK_NEW_NAME_FOR_SINGLE',
    'ASK_NEW_NAME_FOR_SINGLE_BULK',
    'ASK_NEW_NAME_FOR_BULK',
    'ASK_NEW_NAME_FOR_BULK_AUTO',
    'ASK_NEW_PASSWORD',
    'ASK_NEW_PASSWORD_BULK',
    'ASK_NEW_PASSWORD_BULK_AUTO',

    // Customer report photo upload
    'REPORT_MATI_PHOTO',
    'MATI_AWAITING_PHOTO',
    'GANGGUAN_MATI_AWAITING_PHOTO',
    'REPORT_LEMOT_ANALYSIS',
    'LEMOT_AWAITING_PHOTO',

    // Customer report decision/menu (sebelum tiket dibuat)
    'GANGGUAN_MATI_DEVICE_OFFLINE',
    'GANGGUAN_MATI_DEVICE_ONLINE',
    'GANGGUAN_LEMOT_AWAITING_RESPONSE',
    'GANGGUAN_LEMOT_CONFIRM_TICKET',

    // Teknisi workflow aktif — ketik "menu" tidak boleh drop tiket di tengah jalan
    'AWAITING_LOCATION_FOR_JOURNEY',
    'AWAITING_PHOTO_CATEGORY_1',
    'AWAITING_PHOTO_CATEGORY_2',
    'AWAITING_PHOTO_CATEGORY_3',
    'AWAITING_PHOTO_EXTRA',
    'AWAITING_PHOTO_EXTRA_CONFIRM',
    'AWAITING_COMPLETION_PHOTOS',
    'AWAITING_RESOLUTION_NOTES',
    'AWAITING_CONFIRMATION',
    'TICKET_RESOLVE_UPLOAD_PHOTOS',
    'TICKET_VERIFIED_AWAITING_PHOTOS',
    'TICKET_RESOLVE_ASK_NOTES',
    'TICKET_RESOLVE_CONFIRM',

    // Agent voucher purchase/sale
    'AGENT_VOUCHER_PURCHASE_SELECT',
    'AGENT_VOUCHER_PURCHASE_QUANTITY',
    'AGENT_VOUCHER_PURCHASE_PAYMENT',
    'AGENT_VOUCHER_SALE_SELECT',
    'AGENT_VOUCHER_SALE_QUANTITY',
    'AGENT_VOUCHER_SALE_CUSTOMER',
    'AGENT_VOUCHER_SALE_CONFIRM',

    // Payment / transfer
    'TOPUP_SELECT_METHOD',
    'VOUCHER_SELECT',
    'TRANSFER_CONFIRM'
];

const WIFI_INPUT_STATES = [
    'ASK_NEW_NAME_FOR_SINGLE',
    'ASK_NEW_NAME_FOR_SINGLE_BULK',
    'ASK_NEW_NAME_FOR_BULK',
    'ASK_NEW_NAME_FOR_BULK_AUTO',
    'ASK_NEW_PASSWORD',
    'ASK_NEW_PASSWORD_BULK',
    'ASK_NEW_PASSWORD_BULK_AUTO'
];

const CANCEL_KEYWORDS = ['batal', 'cancel', 'ga jadi', 'gak jadi'];
const GLOBAL_COMMANDS = ['menu', 'bantuan', 'help', 'lapor', 'ceksaldo', 'saldo'];

function normalizeChatInput(chats) {
    return String(chats || '').toLowerCase().trim();
}

function isCancellationKeyword(chats) {
    return CANCEL_KEYWORDS.includes(normalizeChatInput(chats));
}

function isWifiInputState(step) {
    return WIFI_INPUT_STATES.includes(step);
}

function isProtectedState(step) {
    return PROTECTED_STATES.includes(step);
}

function buildStateRoutingContext({ smartReportState, conversationState }) {
    return {
        protectedStates: PROTECTED_STATES,
        isInProtectedState:
            (smartReportState && isProtectedState(smartReportState.step)) ||
            (conversationState && conversationState.step && isProtectedState(conversationState.step))
    };
}

function resolveGlobalCommandStatus({ chats, isInProtectedState, getIntentFromKeywords }) {
    if (isInProtectedState) {
        return false;
    }

    const keywordCheck = getIntentFromKeywords(chats);
    const commandCheck = String(chats || '').toLowerCase().split(' ')[0];
    return GLOBAL_COMMANDS.includes(commandCheck) || keywordCheck !== null;
}

function resolveIntentFromKeywords({ chats, isAgent, getIntentFromKeywords }) {
    const keywordResult = getIntentFromKeywords(chats);
    if (!keywordResult) {
        return {
            intent: undefined,
            matchedKeywordLength: 0
        };
    }

    const lowerChats = String(chats || '').toLowerCase();
    if (isAgent && (lowerChats.includes('jual') || lowerChats === 'jual voucher' || lowerChats.startsWith('jual voucher'))) {
        return {
            intent: 'AGENT_SELL_VOUCHER',
            matchedKeywordLength: 2
        };
    }

    return {
        intent: keywordResult.intent,
        matchedKeywordLength: keywordResult.matchedKeywordLength
    };
}

module.exports = {
    PROTECTED_STATES,
    WIFI_INPUT_STATES,
    isCancellationKeyword,
    isWifiInputState,
    buildStateRoutingContext,
    resolveGlobalCommandStatus,
    resolveIntentFromKeywords
};
