/**
 * Header Doc
 * Purpose: Registry + resolver driver OLT multi-merk. Memetakan device.brand → driver yang tepat,
 *          menyediakan daftar brand untuk UI, dan titik tunggal auto-deteksi brand (Fase 1).
 * Caller: lib/olt-hioso.js (dispatcher getMultipleOltData/getSingleOnuDataWithCache), routes/olt.js.
 * Deps: ./hioso (driver brand), ./contract.
 * MainFuncs: resolveDriver, getDriver, listDrivers, detectBrand, registerDriver.
 * SideEffects: tidak ada (registry in-memory; driver baru didaftarkan saat module load).
 *
 * Cara nambah brand baru (Fase 2+): buat lib/olt-drivers/<brand>.js sesuai kontrak,
 * lalu daftarkan di DRIVERS di bawah. Tidak perlu menyentuh route atau dispatcher.
 */

const hioso = require('./hioso');

/** @type {Record<string, import('./contract').OltDriver>} */
const DRIVERS = {
    [hioso.brand]: hioso,
    // Fase 2: zte (GPON C320/C300). Fase 3: vsol, hsgq, generic-epon.
};

// Brand default saat device belum/auto: untuk sekarang HIOSO (satu-satunya driver).
// Fase 1: 'auto' akan di-resolve lewat detectBrand() berbasis sysObjectID, lalu
// hasilnya disimpan ke config supaya query berikutnya skip probing.
const DEFAULT_BRAND = 'hioso';

/**
 * Normalisasi nilai brand dari config ke key registry.
 * undefined / '' / 'auto' → DEFAULT_BRAND.
 * @param {string} [brand]
 * @returns {string}
 */
function normalizeBrand(brand) {
    const b = String(brand || '').trim().toLowerCase();
    if (!b || b === 'auto') return DEFAULT_BRAND;
    return b;
}

/**
 * Ambil driver dari nama brand. Brand tak dikenal → fallback DEFAULT_BRAND
 * (lebih baik tetap jalan dengan HIOSO daripada crash; salah-config terlihat di log brand).
 * @param {string} [brand]
 * @returns {import('./contract').OltDriver}
 */
function getDriver(brand) {
    return DRIVERS[normalizeBrand(brand)] || DRIVERS[DEFAULT_BRAND];
}

/**
 * Resolve driver untuk sebuah device entry (atau string brand langsung).
 * @param {object|string} [device]
 * @returns {import('./contract').OltDriver}
 */
function resolveDriver(device) {
    if (!device) return DRIVERS[DEFAULT_BRAND];
    if (typeof device === 'string') return getDriver(device);
    return getDriver(device.brand);
}

/**
 * Daftar brand terdaftar untuk dropdown UI / API.
 * @returns {Array<{brand: string, label: string, capabilities: object}>}
 */
function listDrivers() {
    return Object.values(DRIVERS).map((d) => ({
        brand: d.brand,
        label: d.label,
        capabilities: d.capabilities,
    }));
}

/**
 * Auto-deteksi brand via SNMP sysObjectID (1.3.6.1.2.1.1.2.0).
 * STUB Fase 0: selalu kembalikan DEFAULT_BRAND. Fase 1 akan probe enterprise number
 * dari sysObjectID dan map ke driver.enterpriseOids.
 * @param {object} _config
 * @returns {Promise<string>}
 */
async function detectBrand(_config) {
    return DEFAULT_BRAND;
}

/**
 * Daftarkan driver brand baru (dipakai Fase 2+ atau test).
 * @param {import('./contract').OltDriver} driver
 */
function registerDriver(driver) {
    if (!driver || !driver.brand) {
        throw new Error('registerDriver: driver wajib punya field brand');
    }
    DRIVERS[driver.brand] = driver;
}

module.exports = {
    DEFAULT_BRAND,
    getDriver,
    resolveDriver,
    listDrivers,
    detectBrand,
    registerDriver,
    normalizeBrand,
};
