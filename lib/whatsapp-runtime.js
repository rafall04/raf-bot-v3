"use strict";

function resolveWhatsAppRuntimeState({ connection, reason, currentState = "close", hasActiveSession = false } = {}) {
    if (connection === "open") {
        return "open";
    }

    if (connection === "connecting") {
        return "connecting";
    }

    if (reason === "logged_out") {
        return "logged_out";
    }

    if (connection === "close" && currentState === "logged_out" && !hasActiveSession) {
        return "logged_out";
    }

    if (connection === "close") {
        return "temporary_disconnect";
    }

    if (hasActiveSession) {
        return "open";
    }

    return currentState || "close";
}

function buildWhatsAppSocketPayload(state) {
    return {
        service: "whatsapp",
        state,
        requiresReauth: state === "logged_out"
    };
}

module.exports = {
    resolveWhatsAppRuntimeState,
    buildWhatsAppSocketPayload
};
