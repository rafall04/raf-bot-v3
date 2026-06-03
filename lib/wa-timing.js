/**
 * Header Doc
 * Purpose: Menjadi boundary internal untuk jeda operasi WhatsApp/runtime agar controller dan service tidak import Baileys langsung.
 * Caller: Route/service yang butuh jeda antar operasi notifikasi atau sinkronisasi terkait WhatsApp.
 * Deps: Timer bawaan Node.js.
 * MainFuncs: `waitForWhatsAppDelay`.
 * SideEffects: Menunda eksekusi sesuai durasi yang diminta.
 */

function waitForWhatsAppDelay(durationMs = 1000) {
    const delayMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    return new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
}

module.exports = {
    waitForWhatsAppDelay,
};
