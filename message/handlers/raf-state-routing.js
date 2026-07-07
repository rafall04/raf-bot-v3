/**
 * Header Doc
 * Purpose: Routing state percakapan + resolusi intent keyword (ketat lalu longgar) untuk pipeline pesan bot.
 * Caller: `message/raf.js`.
 * Deps: `./raf-interceptors` (matcher ketat + guard), matcher longgar via dependency injection caller.
 * MainFuncs: `handleManagedConversationState`, `handleWifiInputGuard`, `resolveKeywordIntent`.
 * SideEffects: Tidak ada langsung; mendelegasikan reply/state ke callback caller.
 */
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
    command,
    getLooseIntentFromKeywords = null,
    looseIntentEnabled = false
}) {
    let intent;
    let matchedKeywordLength = 0;
    let isLooseMatch = false;

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

    // Lapis kedua LONGGAR (lib/loose-intent-matcher) — hanya saat matcher ketat gagal dan
    // caller mengizinkan (pengirim non-staf, config customerAssist.looseMatcher). PENTING:
    // matchedKeywordLength dipatok = seluruh kata & qAfterKeyword dikosongkan supaya handler
    // TIDAK pernah membaca parameter dari kalimat bebas — mis. GANTI_SANDI_WIFI selalu masuk
    // wizard tanya-sandi, bukan menganggap sisa kalimat sebagai password baru.
    if (!intent && looseIntentEnabled && typeof getLooseIntentFromKeywords === 'function') {
        const looseResult = getLooseIntentFromKeywords(chats);
        if (looseResult && looseResult.intent) {
            intent = looseResult.intent;
            matchedKeywordLength = Array.isArray(args) ? args.length : 0;
            qAfterKeyword = '';
            isLooseMatch = true;
        }
    }

    return {
        intent,
        matchedKeywordLength,
        qAfterKeyword,
        isLooseMatch
    };
}

module.exports = {
    handleManagedConversationState,
    handleWifiInputGuard,
    resolveKeywordIntent
};
