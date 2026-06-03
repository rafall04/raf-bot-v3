/**
 * Header Doc
 * Purpose: Facade owner intent WiFi pelanggan untuk perubahan nama dan sandi WiFi.
 * Caller: `message/handlers/domain-handlers.js` dan `message/handlers/raf-intent-dispatch.js`.
 * Deps: Handler WiFi existing.
 * MainFuncs: `handleWifiIntent`.
 * SideEffects: Menjalankan flow perubahan WiFi melalui handler existing.
 */
"use strict";

const { handleGantiNamaWifi, handleGantiSandiWifi } = require("../wifi-management-handler");

async function handleWifiIntent(context) {
    const { intent } = context;

    if (intent === "GANTI_NAMA_WIFI") {
        await handleGantiNamaWifi(context);
        return { handled: true };
    }

    if (intent === "GANTI_SANDI_WIFI") {
        await handleGantiSandiWifi(context);
        return { handled: true };
    }

    return { handled: false };
}

module.exports = {
    handleWifiIntent
};
