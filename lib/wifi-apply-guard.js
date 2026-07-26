/**
 * Header Doc
 * Purpose: Satu-satunya penilai "apakah perubahan WiFi benar-benar mendarat di modem" — mencegah lapor sukses-semu ke pelanggan.
 * Caller: `message/handlers/states/wifi-password-state-handler.js`, `message/handlers/states/wifi-name-state-handler.js`, `services/wifi-management.service.js`.
 * Deps: tidak ada (fungsi murni).
 * MainFuncs: `isWifiChangeApplied`, `assertWifiChangeApplied`.
 * SideEffects: `assertWifiChangeApplied` melempar Error kalau perubahan tidak terbukti diterima GenieACS.
 */
"use strict";

const DEFAULT_FAILURE_MESSAGE = "Perubahan WiFi tidak diterima perangkat.";

/**
 * Aturan sukses yang SAMA dengan `toLegacyMutationResult` di `lib/genieacs.js`:
 * `ok` saja TIDAK cukup. `ok:true` + `accepted:false` berarti tidak ada task yang
 * benar-benar dikirim ke GenieACS (mis. payload kosong) — itu kegagalan, bukan sukses.
 * `applied:null` tetap lolos: itu mode `accept_task_only` (perubahan sandi tak bisa
 * dibaca ulang dari ACS), jadi task-diterima adalah bukti terkuat yang tersedia.
 * Yang ditolak hanya `applied:false` = terbukti TIDAK mendarat saat readback.
 *
 * Menerima dua bentuk hasil: `{ ok, accepted, applied }` (updateWifiSettings dkk)
 * dan bentuk legacy `{ success }` (setPassword/setSSIDName).
 */
function isWifiChangeApplied(result) {
    if (!result || typeof result !== "object") {
        return false;
    }
    if (typeof result.success === "boolean" && result.ok === undefined) {
        return result.success;
    }
    return Boolean(result.ok) && result.accepted !== false && result.applied !== false;
}

/**
 * Lempar Error kalau perubahan tidak terbukti mendarat. Pemanggil sudah punya
 * try-catch yang mengubah Error jadi template pesan gagal, jadi ini bikin semua
 * jalur apply WiFi gagal terang-terangan dengan satu baris.
 */
function assertWifiChangeApplied(result) {
    if (isWifiChangeApplied(result)) {
        return result;
    }
    throw new Error((result && result.message) || DEFAULT_FAILURE_MESSAGE);
}

module.exports = {
    isWifiChangeApplied,
    assertWifiChangeApplied,
    DEFAULT_FAILURE_MESSAGE,
};
