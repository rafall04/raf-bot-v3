const PROTECTED_STATES = [
    'ASK_NEW_NAME_FOR_SINGLE',
    'ASK_NEW_NAME_FOR_SINGLE_BULK',
    'ASK_NEW_NAME_FOR_BULK',
    'ASK_NEW_NAME_FOR_BULK_AUTO',
    'ASK_NEW_PASSWORD',
    'ASK_NEW_PASSWORD_BULK',
    'ASK_NEW_PASSWORD_BULK_AUTO',
    'REPORT_MATI_PHOTO',
    'MATI_AWAITING_PHOTO',
    'GANGGUAN_MATI_AWAITING_PHOTO',
    'REPORT_LEMOT_ANALYSIS',
    'LEMOT_AWAITING_PHOTO',
    'AGENT_VOUCHER_PURCHASE_SELECT',
    'AGENT_VOUCHER_PURCHASE_QUANTITY',
    'AGENT_VOUCHER_PURCHASE_PAYMENT',
    'AGENT_VOUCHER_SALE_SELECT',
    'AGENT_VOUCHER_SALE_QUANTITY',
    'AGENT_VOUCHER_SALE_CUSTOMER',
    'AGENT_VOUCHER_SALE_CONFIRM'
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
