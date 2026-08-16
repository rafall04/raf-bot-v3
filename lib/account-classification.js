/**
 * Header Doc
 * Purpose: Helper murni klasifikasi jenis akun di tabel `users` — memisahkan akun pelanggan
 *          dari akun infrastruktur (mis. modem CCTV/monitoring) lewat field `account_type`.
 *          Akun infra tetap disimpan di `users` agar terbaca di monitor OLT (korelasi
 *          pppoe_username/device_id/MAC), tetapi dikecualikan dari data pelanggan & billing.
 * Caller: cron billing (set-unpaid/isolir/reminder/isolir-notification), routes/stats.js,
 *          arrears, export pelanggan, halaman monitor infra, auto-outage & LOS broadcaster.
 * Deps: tidak ada (pure, tanpa I/O).
 * MainFuncs: getAccountType, isInfrastructure, isBillableCustomer, partitionAccounts,
 *          getWhitelistedPackageNames, isPaketWhitelist.
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

/**
 * Nama paket yang kebal billing (`whitelist: true` di database/packages.json).
 *
 * KENAPA DIKUNCI PADA NAMA PAKET, BUKAN PROFIL — `whitelist` adalah properti PAKET,
 * sedangkan `profile` adalah setelan bandwidth di MikroTik yang WAJAR dipakai bersama
 * beberapa paket. Enam cron billing dulu menghitung
 * `packages.filter(p=>p.whitelist).map(p=>p.profile)` lalu mencocokkan profil pelanggan,
 * sehingga paket BERBAYAR yang kebetulan berbagi profil dengan paket gratis ikut dianggap
 * gratis.
 *
 * Terukur di produksi Tanjungharjo 2026-08-16: `PAKET-KHUSUS-50K` (Rp0, whitelist) memakai
 * profil `22Mbps` yang sama dengan `PAKET-125K` (Rp125.000, berbayar). Akibatnya **49
 * pelanggan berbayar** (nilai langganan Rp6.125.000/bulan) tak pernah menerima pengingat,
 * tak pernah masuk masa tenggang, dan tak pernah jadi kandidat isolir. Dander bersih karena
 * paket gratisnya memakai profil khusus sendiri (`FREE-*`).
 *
 * Ini pola "gerbang dikunci pada PROKSI, bukan pada BUKTI" yang sudah tercatat di CLAUDE.md.
 * `lib/paid-flag-reconcile.js` sejak awal sudah memakai nama paket — itulah yang benar, dan
 * fungsi ini menjadikannya pemilik tunggal supaya keenam cron tak menyimpang lagi.
 *
 * @param {Array} [packages] default `global.packages`.
 * @returns {Set<string>}
 */
function getWhitelistedPackageNames(packages = (typeof global !== "undefined" ? global.packages : null)) {
    return new Set(
        (packages || [])
            .filter((pkg) => pkg && pkg.whitelist === true)
            .map((pkg) => pkg.name)
    );
}

/**
 * Pelanggan ini memakai paket kebal billing?
 * @param {object} user butuh `subscription`.
 * @param {Array|Set<string>} [packagesAtauNama] daftar paket ATAU Set nama hasil
 *        `getWhitelistedPackageNames()` (untuk loop besar, hitung sekali di luar).
 */
function isPaketWhitelist(user, packagesAtauNama) {
    if (!user) return false;
    const nama = packagesAtauNama instanceof Set
        ? packagesAtauNama
        : getWhitelistedPackageNames(packagesAtauNama);
    return nama.has(user.subscription);
}

module.exports = {
    ACCOUNT_TYPE,
    getAccountType,
    isInfrastructure,
    isBillableCustomer,
    partitionAccounts,
    getWhitelistedPackageNames,
    isPaketWhitelist
};
