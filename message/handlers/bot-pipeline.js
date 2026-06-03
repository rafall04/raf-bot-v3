/**
 * Header Doc
 * Purpose: Menyediakan wrapper pipeline bot untuk state routing dan intersepsi global secara bertahap.
 * Caller: `message/raf.js`.
 * Deps: Handler existing `handleManagedConversationState`.
 * MainFuncs: `routeManagedState`, `runGlobalInterceptors`.
 * SideEffects: Mengembalikan hasil handler existing tanpa memodifikasi kontrak.
 */
"use strict";

async function routeManagedState(params) {
    const { handleManagedConversationState, ...rest } = params;
    return handleManagedConversationState(rest);
}

function runGlobalInterceptors(context = {}) {
    return {
        handled: false,
        context
    };
}

module.exports = {
    routeManagedState,
    runGlobalInterceptors
};
