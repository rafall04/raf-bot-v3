/**
 * Header Doc
 * Purpose: Menjadi gateway tunggal runtime WhatsApp agar detail socket Baileys terlokalisasi di satu boundary.
 * Caller: `whatsapp.adapter`, `whatsapp-delivery-service`, `whatsapp-bootstrap`, dan session recovery.
 * Deps: State global kompatibilitas (`global.conn`, `global.raf`, `global.whatsappConnectionState`).
 * MainFuncs: `getSocket`, `getConnectionState`, `setConnectionState`, `hasSocket`, `hasAuthenticatedSession`, `getSocketDiagnostics`, `getStatusSnapshot`, `canReconnect`, `closeActiveSocket`, `isReady`, `setActiveSocket`, `clearActiveSocket`, `sendPayload`, `sendText`, `sendMedia`, `normalkanPayload`.
 * SideEffects: Menyinkronkan mirror global kompatibilitas, menutup socket aktif, dan mengirim payload melalui socket aktif.
 */
"use strict";

let activeSocket = null;
let connectionState = "close";

function getSocket() {
    return activeSocket || global.raf || global.conn || null;
}

function getConnectionState() {
    if (typeof global.whatsappConnectionState === "string" && global.whatsappConnectionState) {
        connectionState = global.whatsappConnectionState;
    }
    return connectionState;
}

function hasSocket() {
    const socket = getSocket();
    return !!socket && typeof socket.sendMessage === "function";
}

function hasAuthenticatedSession() {
    const socket = getSocket();
    return !!socket?.user?.id;
}

function getSocketDiagnostics() {
    const socket = getSocket();
    const wsReadyState = socket?.ws?.readyState ?? socket?.ws?._ws?.readyState ?? null;
    return {
        hasSocket: hasSocket(),
        hasUser: hasAuthenticatedSession(),
        wsReadyState,
        connectionState: getConnectionState()
    };
}

function getStatusSnapshot({ reconcileState = false } = {}) {
    const socket = getSocket();
    const diagnostics = getSocketDiagnostics();
    const currentState = diagnostics.connectionState;
    let effectiveState = currentState;

    if (diagnostics.hasUser || diagnostics.wsReadyState === 1) {
        effectiveState = "open";
    } else if (currentState !== "logged_out") {
        effectiveState = diagnostics.hasSocket ? "temporary_disconnect" : "close";
    }

    if (reconcileState && effectiveState !== currentState) {
        setConnectionState(effectiveState);
    }

    const userInfo = socket?.user
        ? {
            id: socket.user.id,
            name: socket.user.name || socket.user.notify || "Unknown"
        }
        : null;

    return {
        botStatus: effectiveState === "open" || diagnostics.wsReadyState === 1 || diagnostics.hasUser,
        connectionState: effectiveState,
        requiresReauth: effectiveState === "logged_out",
        hasSocket: diagnostics.hasSocket,
        hasUser: diagnostics.hasUser,
        hasRafObject: diagnostics.hasSocket,
        hasConnObject: diagnostics.hasSocket,
        hasRaf: diagnostics.hasSocket,
        hasConn: diagnostics.hasSocket,
        hasWebSocket: diagnostics.wsReadyState !== null,
        webSocketState: diagnostics.wsReadyState,
        webSocketStateText:
            diagnostics.wsReadyState === 0 ? "CONNECTING" :
            diagnostics.wsReadyState === 1 ? "OPEN" :
            diagnostics.wsReadyState === 2 ? "CLOSING" :
            diagnostics.wsReadyState === 3 ? "CLOSED" :
            "UNKNOWN",
        userInfo,
        timestamp: new Date().toISOString()
    };
}

function canReconnect() {
    const snapshot = getStatusSnapshot();
    return snapshot.connectionState !== "open";
}

function setConnectionState(state, { mirrorGlobals = true } = {}) {
    connectionState = state || "close";
    if (mirrorGlobals) {
        global.whatsappConnectionState = connectionState;
    }
    return connectionState;
}

function setActiveSocket(socket, { mirrorGlobals = true, state = null } = {}) {
    activeSocket = socket || null;
    if (mirrorGlobals) {
        global.conn = socket || null;
        global.raf = socket || null;
    }
    if (state) {
        setConnectionState(state, { mirrorGlobals });
    }
    return activeSocket;
}

function clearActiveSocket({ mirrorGlobals = true, nextState = null } = {}) {
    activeSocket = null;
    if (mirrorGlobals) {
        global.conn = null;
        global.raf = null;
    }
    if (nextState) {
        setConnectionState(nextState, { mirrorGlobals });
    }
}

async function closeActiveSocket({ mirrorGlobals = true, nextState = "close" } = {}) {
    const socket = getSocket();
    if (socket) {
        try {
            if (typeof socket.end === "function") {
                await socket.end();
            } else if (typeof socket.ws?.close === "function") {
                socket.ws.close();
            }
        } catch (error) {
            console.warn("[WHATSAPP_GATEWAY] Failed to close active socket:", error.message);
        }
    }
    clearActiveSocket({ mirrorGlobals, nextState });
    return getConnectionState();
}

function isReady() {
    return hasSocket() && getConnectionState() === "open";
}

/**
 * Cek nomor terdaftar di WhatsApp (Baileys `onWhatsApp`). FAIL-OPEN: kembalikan `null` bila tak bisa
 * cek (socket tak siap / error) → pemanggil JANGAN blokir kirim karena cek gagal.
 * @param {string} jid  '628xxx@s.whatsapp.net'
 * @returns {Promise<boolean|null>} true=terdaftar, false=tak terdaftar, null=tak bisa cek
 */
async function isRegisteredOnWhatsApp(jid) {
    try {
        const socket = getSocket();
        if (!socket || typeof socket.onWhatsApp !== "function" || getConnectionState() !== "open") return null;
        const res = await socket.onWhatsApp(jid);
        if (!Array.isArray(res) || res.length === 0) return false;
        const base = String(jid).split("@")[0];
        const hit = res.find((r) => r && String(r.jid || "").split("@")[0] === base) || res[0];
        return Boolean(hit && hit.exists);
    } catch (_e) {
        return null; // fail-open
    }
}

/**
 * Menormalkan payload berbentuk STRING menjadi `{ text }`.
 *
 * KENAPA DI SINI — Baileys menuntut objek `AnyMessageContent`; string mentah ditolak.
 * `sendCritical` sudah menormalkan (lib/whatsapp-critical-delivery `normalizePayload`) dan
 * `sendText` di bawah membungkusnya, tapi `sendMessage`/`sendMessageToMany`/`safeSendMessage`
 * meneruskan apa adanya. Akibatnya SETIAP pemanggil yang mengirim string gagal diam-diam —
 * terukur: seluruh kabar bot ke GRUP KAS lewat tiga jalur (`kas-group-notifier`,
 * `cron/jobs/money-digest`, `cron/jobs/recurring-expense-reminder`) tak pernah sampai,
 * padahal fiturnya AKTIF di kedua bot produksi.
 *
 * Ditaruh di gateway — hop TERAKHIR sebelum Baileys — supaya kelas cacat ini tak bisa lahir
 * lagi lewat pemanggil baru. Objek diteruskan apa adanya, jadi jalur media/tombol tak berubah.
 */
function normalkanPayload(payload) {
    return typeof payload === "string" ? { text: payload } : payload;
}

async function sendPayload(recipient, payload, options = {}) {
    const socket = getSocket();
    if (!socket || typeof socket.sendMessage !== "function" || getConnectionState() !== "open") {
        throw new Error(`WhatsApp connection not ready (state: ${getConnectionState()})`);
    }
    return socket.sendMessage(recipient, normalkanPayload(payload), options);
}

async function sendText(recipient, text, options = {}) {
    return sendPayload(recipient, { text }, options);
}

async function sendMedia(recipient, mediaPayload, options = {}) {
    return sendPayload(recipient, mediaPayload, options);
}

module.exports = {
    getSocket,
    getConnectionState,
    setConnectionState,
    hasSocket,
    hasAuthenticatedSession,
    getSocketDiagnostics,
    getStatusSnapshot,
    canReconnect,
    isReady,
    isRegisteredOnWhatsApp,
    setActiveSocket,
    closeActiveSocket,
    clearActiveSocket,
    sendPayload,
    normalkanPayload,
    sendText,
    sendMedia
};
