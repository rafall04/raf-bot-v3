/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent percakapan umum yang akan diekstrak dari `raf-intent-dispatch.js`.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `CONVERSATION_INTENT_HANDLERS`, `handleMulaiBertanyaIntent`, `handleTanyaJawabUmumIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleMulaiBertanyaIntent(context) {
    const {
        stateSender,
        isTeknisi,
        setUserState,
        reply,
        format
    } = context;

    setUserState(stateSender, {
        step: 'AWAITING_QUESTION',
        flow: 'general',
        ownerType: isTeknisi ? 'teknisi' : 'customer'
    });
    reply(format('convo_awaiting_question_prompt'));
}

async function handleTanyaJawabUmumIntent(context) {
    const { reply, renderResponseTemplate } = context;

    reply(renderResponseTemplate(
        'raf_dispatch_qa_unavailable',
        "Maaf, fitur tanya jawab otomatis sudah tidak tersedia.\n\nSilakan gunakan perintah berikut:\n• *menu* - Lihat menu utama\n• *bantuan* - Lihat panduan\n• Atau hubungi admin untuk bantuan lebih lanjut."
    ));
}

const CONVERSATION_INTENT_HANDLERS = Object.freeze({
    MULAI_BERTANYA: handleMulaiBertanyaIntent,
    TANYA_JAWAB_UMUM: handleTanyaJawabUmumIntent
});

module.exports = {
    CONVERSATION_INTENT_HANDLERS,
    handleMulaiBertanyaIntent,
    handleTanyaJawabUmumIntent
};
