/**
 * Header Doc
 * Purpose: Menormalkan satu baris `users` dari SQLite ke bentuk yang dipakai `global.users`
 *          — khususnya kolom `bulk` yang tersimpan sebagai TEKS JSON.
 * Caller: `lib/database-reload.js`; `lib/database.js` memakai pola yang sama saat memuat awal.
 * Deps: Tidak ada.
 * MainFuncs: `parseBulk`, `normalizeUserRow`.
 * SideEffects: Menulis peringatan ke konsol untuk data `bulk` yang rusak.
 *
 * KENAPA ADA: ada DUA jalur yang mengisi `global.users` — pemuatan awal (`lib/database.js`)
 * dan Reload dari halaman Database (`lib/database-reload.js`) — dan keduanya MENYIMPANG.
 * Jalur reload tak mem-parse `bulk` sama sekali, sehingga setelah admin menekan Reload
 * nilainya menjadi TEKS mentah (mis. string `"[1,5]"`, bukan array `[1,5]`). Kode yang
 * mengiterasi indeks SSID lalu memperlakukan string itu sebagai daftar karakter — SSID kedua
 * pelanggan berhenti ikut diubah, dan gejalanya baru terlihat saat ganti nama/sandi WiFi
 * massal tak berpengaruh pada sebagian pelanggan.
 */
"use strict";

/**
 * `bulk` di SQLite adalah TEKS JSON (mis. `"[1,5]"`). Kembalikan selalu ARRAY.
 * Data rusak (`"[object Object]"`, JSON tak valid) dikembalikan sebagai `[]` dengan peringatan
 * — bukan dilempar: satu baris rusak tak boleh menggagalkan pemuatan seluruh pelanggan.
 */
function parseBulk(user) {
    const nilai = user && user.bulk;

    if (Array.isArray(nilai)) return nilai;
    if (nilai === null || nilai === undefined) return [];

    if (typeof nilai === "string") {
        const trimmed = nilai.trim();
        if (trimmed === "" || trimmed === "[]" || trimmed === "null") return [];
        if (trimmed.startsWith("[object")) {
            console.warn(
                `[DB_WARNING] Data bulk rusak untuk user ${user.id}: "${trimmed}", dikembalikan ke default`
            );
            return [];
        }
        try {
            const hasil = JSON.parse(trimmed);
            return Array.isArray(hasil) ? hasil : [];
        } catch (error) {
            console.warn(`[DB_WARNING] Gagal parse bulk untuk user ${user.id}:`, error.message);
            return [];
        }
    }

    return [];
}

/** Bentuk baris user yang konsisten untuk `global.users`, dari mana pun ia dimuat. */
function normalizeUserRow(user) {
    return {
        ...user,
        paid: user.paid === 1 || user.paid === true,
        send_invoice: user.send_invoice === 1 || user.send_invoice === true,
        is_corporate: user.is_corporate === 1 || user.is_corporate === true,
        bulk: parseBulk(user),
        connected_odp_id: user.connected_odp_id || null,
        // Alias yang dipakai kode lama.
        phone: user.phone_number,
        package: user.subscription,
        created_at: user.created_at || new Date().toISOString(),
        updated_at: user.updated_at || new Date().toISOString()
    };
}

module.exports = { parseBulk, normalizeUserRow };
