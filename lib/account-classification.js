/**
 * Header Doc
 * Purpose: Helper murni klasifikasi jenis akun di tabel `users` — memisahkan akun pelanggan
 *          dari akun infrastruktur (mis. modem CCTV/monitoring) lewat field `account_type`.
 *          Akun infra tetap disimpan di `users` agar terbaca di monitor OLT (korelasi
 *          pppoe_username/device_id/MAC), tetapi dikecualikan dari data pelanggan & billing.
 * Caller: cron billing (set-unpaid/isolir/reminder/isolir-notification), routes/stats.js,
 *          arrears, export pelanggan, halaman monitor infra, auto-outage & LOS broadcaster.
 * Deps: tidak ada (pure, tanpa I/O).
 * MainFuncs: getAccountType, isInfrastructure, isBillableCustomer, partitionAccounts.
 * SideEffects: Tidak ada.
 */
"use strict";

// Nilai kanonik field `users.account_type`. Default 'pelanggan' supaya semua user
// existing (pra-migrasi) otomatis dianggap pelanggan biasa.
const ACCOUNT_TYPE = Object.freeze({
    CUSTOMER: "pelanggan",
    INFRASTRUCTURE: "infrastruktur"
});

/**
 * Ambil account_type ter-normalisasi dari record user (default 'pelanggan').
 * Toleran terhadap null/undefined/angka/spasi/kapital.
 * @param {object} user
 * @returns {string} 'pelanggan' | 'infrastruktur' | nilai lain yang sudah dilowercase
 */
function getAccountType(user) {
    const raw = user && user.account_type;
    if (typeof raw !== "string") return ACCOUNT_TYPE.CUSTOMER;
    const normalized = raw.trim().toLowerCase();
    return normalized || ACCOUNT_TYPE.CUSTOMER;
}

/**
 * True bila akun adalah infrastruktur (bukan pelanggan bayar) — mis. modem CCTV/monitoring.
 * @param {object} user
 * @returns {boolean}
 */
function isInfrastructure(user) {
    return getAccountType(user) === ACCOUNT_TYPE.INFRASTRUCTURE;
}

/**
 * True bila akun harus diperlakukan sebagai pelanggan yang ditagih (kebalikan infra).
 * Dipakai sebagai guard di cron billing/isolir dan agregasi statistik.
 * @param {object} user
 * @returns {boolean}
 */
function isBillableCustomer(user) {
    return !isInfrastructure(user);
}

/**
 * Pisahkan daftar user menjadi { customers, infrastructure }.
 * @param {Array<object>} users
 * @returns {{ customers: Array<object>, infrastructure: Array<object> }}
 */
function partitionAccounts(users) {
    const customers = [];
    const infrastructure = [];
    for (const user of Array.isArray(users) ? users : []) {
        if (isInfrastructure(user)) infrastructure.push(user);
        else customers.push(user);
    }
    return { customers, infrastructure };
}

module.exports = {
    ACCOUNT_TYPE,
    getAccountType,
    isInfrastructure,
    isBillableCustomer,
    partitionAccounts
};
