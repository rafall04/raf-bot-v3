/**
 * Header Doc
 * Purpose: Membentuk konteks bot standar untuk pipeline router WhatsApp agar dependency baru dapat dibundel tanpa mengubah perilaku publik.
 * Caller: `message/raf.js`.
 * Deps: `global.__appRuntime` dan payload pesan yang sudah dinormalisasi.
 * MainFuncs: `buildBotContext`.
 * SideEffects: Tidak ada; hanya menyusun objek konteks.
 */
"use strict";

const { resolveRuntimeBindings } = require("../../lib/runtime-repositories");

function buildBotRuntimeContext(runtime = null) {
    const runtimeBindings = resolveRuntimeBindings(runtime);
    return {
        runtime: runtimeBindings.runtime,
        runtimeBindings,
        runtimeGlobalScope: runtimeBindings.globalScope,
        runtimeRepositories: runtimeBindings.repositories,
        runtimeConfig: runtimeBindings.config
    };
}

function buildBotContext({ raf, msg, runtime = null, data = {} }) {
    const runtimeContext = buildBotRuntimeContext(runtime);
    return {
        raf,
        msg,
        runtime: runtimeContext.runtime,
        runtimeBindings: runtimeContext.runtimeBindings,
        runtimeGlobalScope: runtimeContext.runtimeGlobalScope,
        runtimeRepositories: runtimeContext.runtimeRepositories,
        runtimeConfig: runtimeContext.runtimeConfig,
        sender: data.sender,
        canonicalSenderId: data.canonicalSenderId || data.sender,
        stateSender: data.stateSender || data.canonicalSenderId || data.sender,
        intentOwner: data.intentOwner || "legacy",
        ...data
    };
}

module.exports = {
    buildBotContext,
    buildBotRuntimeContext
};
