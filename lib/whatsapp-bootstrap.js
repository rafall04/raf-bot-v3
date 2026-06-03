/**
 * Header Doc
 * Purpose: Menyediakan boundary lifecycle WhatsApp untuk start, reconnect, sinkronisasi state/socket, dan cleanup runtime.
 * Caller: `index.js`, route status/runtime, dan recovery handler.
 * Deps: Callback starter koneksi existing, `./whatsapp-runtime`, dan `./whatsapp-gateway`.
 * MainFuncs: `startWhatsApp`, `registerWhatsAppStarter`, `triggerWhatsAppReconnect`, `syncWhatsAppRuntime`, `clearWhatsAppRuntime`.
 * SideEffects: Menjalankan callback starter, menyinkronkan socket/state gateway, dan memperbarui mirror global kompatibilitas.
 */
"use strict";

const { resolveWhatsAppRuntimeState } = require("./whatsapp-runtime");
const { setActiveSocket, setConnectionState, clearActiveSocket, getConnectionState } = require("./whatsapp-gateway");

let registeredRuntime = null;
let registeredStarter = null;

async function startWhatsApp(runtime, starter) {
    if (typeof starter !== "function") {
        throw new TypeError("startWhatsApp membutuhkan callback starter");
    }

    return starter(runtime);
}

function registerWhatsAppStarter(runtime, starter) {
    registeredRuntime = runtime || null;
    registeredStarter = typeof starter === "function" ? starter : null;
    return Boolean(registeredStarter);
}

async function triggerWhatsAppReconnect(runtime = registeredRuntime) {
    if (typeof registeredStarter !== "function") {
        throw new Error("WhatsApp starter belum terdaftar");
    }

    return startWhatsApp(runtime, registeredStarter);
}

function syncWhatsAppRuntime({
    socket = null,
    connection,
    reason,
    currentState = getConnectionState(),
    hasActiveSession = false,
    mirrorGlobals = true
} = {}) {
    const nextState = resolveWhatsAppRuntimeState({
        connection,
        reason,
        currentState,
        hasActiveSession
    });

    if (socket) {
        setActiveSocket(socket, { mirrorGlobals, state: nextState });
    } else {
        setConnectionState(nextState, { mirrorGlobals });
    }

    return nextState;
}

function clearWhatsAppRuntime({ nextState = "close", mirrorGlobals = true } = {}) {
    clearActiveSocket({ mirrorGlobals, nextState });
    return getConnectionState();
}

module.exports = {
    startWhatsApp,
    registerWhatsAppStarter,
    triggerWhatsAppReconnect,
    syncWhatsAppRuntime,
    clearWhatsAppRuntime
};
