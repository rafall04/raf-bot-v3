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

/**
 * Siklus tagihan pelanggan ini = "akhir bulan"?
 *
 * Sebagian kecil pelanggan (mis. Leny Mustiko Wati) sepakat membayar menjelang AKHIR bulan,
 * bukan awal. Siklus standar (reset unpaid tgl 1 → reminder → masa tenggang → isolir tgl
 * `tanggal_isolir`, biasanya 11-12) akan MENGISOLIR mereka ~18 hari sebelum jatuh temponya.
 * Kolom `billing_cycle` = `'akhir_bulan'` menandai mereka; jalur cron akhir-bulan
 * (`lib/cron/jobs/billing-akhir-bulan.js`) menagih & mengisolir mereka relatif ke akhir bulan.
 *
 * @param {object} user butuh `billing_cycle`.
 * @returns {boolean}
 */
function isEndOfMonthCustomer(user) {
    return !!user && String(user.billing_cycle || "").toLowerCase() === "akhir_bulan";
}

/**
 * Kohort akhir-bulan AKTIF untuk user ini = fitur menyala (`config.billingAkhirBulan.enabled`)
 * DAN pelanggan bertanda `akhir_bulan`.
 *
 * Ini SATU gerbang yang dipakai dua arah supaya tak ada pelanggan yang jatuh di celah:
 *   - job siklus STANDAR memanggilnya untuk MENGECUALIKAN kohort (biar tak diisolir tgl 12);
 *   - job billing-akhir-bulan memanggilnya untuk MENGKLAIM kohort.
 * Bila fitur OFF, keduanya sepakat: kohort diperlakukan seperti pelanggan biasa (perilaku lama).
 *
 * @param {object} user
 * @returns {boolean}
 */
function isEndOfMonthBillingActive(user) {
    const g = typeof global !== "undefined" ? global : {};
    const featOn = !!(g.config && g.config.billingAkhirBulan && g.config.billingAkhirBulan.enabled === true);
    // FAIL-CLOSED (#b304): eksklusi kohort dari job standar HANYA aktif bila job akhir-bulan
    // benar-benar TERJADWAL (cron.json `status_billing_akhir_bulan`). Tanpa syarat ini, "fitur
    // enabled tapi cron mati" akan mengecualikan kohort dari reminder/tenggang/isolir standar
    // SEKALIGUS tak menjadwalkan job akhir-bulan → nol jalur, bocor pendapatan senyap. Bila cron
    // mati, kohort JATUH-AMAN ke siklus standar (ditangani, bukan diabaikan). `global.cronConfig`
    // di-set oleh initializeAllCronTasks (lib/cron.js). initBillingAkhirBulanTask juga meneriakkan
    // peringatan keras saat enabled-tapi-tak-terjadwal.
    const cronOn = !!(g.cronConfig && g.cronConfig.status_billing_akhir_bulan === true);
    return featOn && cronOn && isEndOfMonthCustomer(user);
}

/**
 * Hari isolir KUSTOM paket pelanggan ini (#b305), atau null bila paket tak menyetelnya.
 * `isolir_day` = properti PAKET (packages.json), integer 1-28. null = ikut tanggal isolir GLOBAL.
 * @param {object} user butuh `subscription`.
 * @param {Array} [packages] default `global.packages`.
 * @returns {number|null}
 */
function getPackageIsolirDay(user, packages = (typeof global !== "undefined" ? global.packages : null)) {
    if (!user) return null;
    const pkg = (packages || []).find((p) => p && p.name === user.subscription);
    const d = pkg && pkg.isolir_day;
    return Number.isInteger(d) && d >= 1 && d <= 28 ? d : null;
}

/**
 * Isolir per-PAKET AKTIF untuk user ini = fitur menyala (`config.isolirPerPaket.enabled`) DAN job
 * terjadwal (`cronConfig.status_isolir_paket`, FAIL-CLOSED spt #b304) DAN paketnya punya `isolir_day`
 * DAN dia BUKAN pelanggan akhir-bulan (siklus akhir-bulan menang) DAN bukan infra.
 *
 * SATU gerbang dua arah: cron `isolir` standar memakainya untuk MENGECUALIKAN kohort ini; cron
 * `isolir-paket` memakainya untuk MENGKLAIM-nya. Fail-closed: bila cron mati, kohort jatuh-aman ke
 * isolir standar (ditangani, bukan diabaikan). Prioritas: akhir_bulan > isolir_day paket > global.
 * @param {object} user
 * @returns {boolean}
 */
function isPerPackageIsolirActive(user) {
    const g = typeof global !== "undefined" ? global : {};
    const featOn = !!(g.config && g.config.isolirPerPaket && g.config.isolirPerPaket.enabled === true);
    const cronOn = !!(g.cronConfig && g.cronConfig.status_isolir_paket === true);
    if (!featOn || !cronOn) return false;
    if (isInfrastructure(user)) return false;
    if (isEndOfMonthCustomer(user)) return false; // siklus akhir-bulan menang
    return getPackageIsolirDay(user) !== null;
}

module.exports = {
    ACCOUNT_TYPE,
    getAccountType,
    isInfrastructure,
    isBillableCustomer,
    partitionAccounts,
    getWhitelistedPackageNames,
    isPaketWhitelist,
    isEndOfMonthCustomer,
    isEndOfMonthBillingActive,
    getPackageIsolirDay,
    isPerPackageIsolirActive
};
