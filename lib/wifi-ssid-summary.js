/**
 * Header Doc
 * Purpose: Format ringkasan SSID yang diubah untuk pesan WhatsApp ganti nama/sandi —
 *          menyebut SSID mana saja + jumlahnya agar pesan ke pelanggan tetap informatif
 *          (bukan sekadar "semua SSID").
 * Caller: services/wifi-management.service.js,
 *         message/handlers/states/wifi-name-state-handler.js,
 *         message/handlers/states/wifi-password-state-handler.js.
 * Deps: -
 * MainFuncs: formatWifiSsidInfo, formatWifiSsidList.
 * SideEffects: -
 */
"use strict";

function normalizeIds(ssidIds) {
    return (Array.isArray(ssidIds) ? ssidIds : [ssidIds])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean);
}

/**
 * Daftar polos SSID: "SSID 1, SSID 5". Tanpa jumlah/markup — untuk disisipkan
 * di template yang sudah memberi konteksnya sendiri.
 */
function formatWifiSsidList(ssidIds = []) {
    return normalizeIds(ssidIds).map((id) => `SSID ${id}`).join(", ");
}

/**
 * Isi slot `${ssidInfo}` pada template sukses ganti nama/sandi. Menyebut SSID mana
 * saja + jumlahnya. SELALU berakhiran spasi (atau "" bila kosong) supaya menyatu
 * mulus: "Nama WiFi ${ssidInfo}telah diubah..." → "Nama WiFi pada *SSID 1* telah diubah...".
 *   - 1 SSID  → "pada *SSID 1* "
 *   - >1 SSID → "pada *2 SSID* (SSID 1, SSID 5) "
 *   - kosong  → ""
 */
function formatWifiSsidInfo(ssidIds = []) {
    const ids = normalizeIds(ssidIds);
    if (ids.length === 0) return "";
    if (ids.length === 1) return `pada *SSID ${ids[0]}* `;
    return `pada *${ids.length} SSID* (${formatWifiSsidList(ids)}) `;
}

module.exports = { formatWifiSsidInfo, formatWifiSsidList };
