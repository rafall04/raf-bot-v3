const { isCancellationKeyword, isWifiInputState, resolveIntentFromKeywords } = require('./raf-interceptors');

async function handleManagedConversationState({
    getUserState,
    stateSender,
    isGlobalCommand,
    handleConversationState,
    chats,
    reply,
    global,
    isOwner,
    isTeknisi,
    users,
    args,
    plainSenderNumber,
    pushname,
    mess,
    sleep,
    getSSIDInfo,
    namabot,
    buatLaporanGangguan
}) {
    if (!getUserState(stateSender) || isGlobalCommand) {
        return { handled: false };
    }

    await handleConversationState({
        sender: stateSender,
        chats,
        reply,
        global,
        isOwner,
        isTeknisi,
        users,
        args,
        entities: {},
        plainSenderNumber,
        pushname,
        mess,
        sleep,
        getSSIDInfo,
        namabot,
        buatLaporanGangguan
    });

    return { handled: true };
}

function handleWifiInputGuard({
    userState,
    chats,
    stateSender,
    deleteUserState,
    reply,
    format,
    clearProcessing
}) {
    if (!userState?.step || !isWifiInputState(userState.step)) {
        return { handled: false };
    }

    if (isCancellationKeyword(chats)) {
        deleteUserState(stateSender);
        reply(format('success_process_cancelled'));
        clearProcessing(stateSender);
        return { handled: true };
    }

    return { handled: true };
}

function resolveKeywordIntent({
    chats,
    isAgent,
    getIntentFromKeywords,
    args,
    q,
    command
}) {
    let intent;
    let matchedKeywordLength = 0;

    const keywordResolution = resolveIntentFromKeywords({
        chats,
        isAgent,
        getIntentFromKeywords
    });

    if (keywordResolution.intent) {
        intent = keywordResolution.intent;
        matchedKeywordLength = keywordResolution.matchedKeywordLength;
    }

    let qAfterKeyword = '';
    if (matchedKeywordLength > 0) {
        qAfterKeyword = args.slice(matchedKeywordLength).join(' ').trim();
    } else {
        qAfterKeyword = q;
    }

    if (intent === 'LAPOR_GANGGUAN_MATI' && command !== 'lapor') {
        intent = undefined;
    }

    return {
        intent,
        matchedKeywordLength,
        qAfterKeyword
    };
}

module.exports = {
    handleManagedConversationState,
    handleWifiInputGuard,
    resolveKeywordIntent
};
