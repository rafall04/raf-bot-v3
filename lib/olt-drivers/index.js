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
const zte = require('./zte');
const { snmpGet } = require('./snmp-util');

/** @type {Record<string, import('./contract').OltDriver>} */
const DRIVERS = {
    [hioso.brand]: hioso,
    [zte.brand]: zte,
    // Fase 3: vsol, hsgq, generic-epon.
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
 * Deteksi HIOSO lewat halaman WEB-nya, TANPA SNMP.
 * Halaman `/onuConfigPonList.asp` + tabel `ponListTable` khas HIOSO — ZTE tidak punya.
 * @returns {Promise<boolean>} true bila jelas HIOSO
 */
async function sepertinyaHioso(config) {
    if (!config || !config.host || !config.webUsername) return false;
    try {
        const web = require('../olt-web-optical');
        const hal = await web.fetchPage(config, '/onuConfigPonList.asp');
        if (!hal || !hal.ok || !hal.body) return false;
        return /ponListTable/i.test(hal.body);
    } catch (_e) {
        return false;
    }
}

/**
 * Auto-deteksi brand.
 *
 * !! WEB DICOBA DULUAN (#b283). SNMP membuat OLT HIOSO hang, jadi merek itu harus bisa
 * dikenali tanpa satu paket SNMP pun. Probe SNMP (sysObjectID/sysDescr) baru dipakai kalau
 * web tak menjawab — yaitu untuk OLT yang memang BUKAN HIOSO (mis. ZTE), tempat SNMP aman.
 * Ini satu-satunya sisa jalur yang secara teori bisa menyentuh HIOSO, dan hanya terpicu
 * tombol Test Connection manual pada device ber-brand `auto`.
 *
 * @param {object} config {host, webUsername/webPassword, community/snmpCommunity, port, ...}
 * @returns {Promise<string>} brand terdeteksi (key registry)
 */
async function detectBrand(config) {
    const SYS_OBJECT_ID = '1.3.6.1.2.1.1.2.0';
    const SYS_DESCR = '1.3.6.1.2.1.1.1.0';
    // Tanpa host tak ada yang bisa di-probe → pakai default (hindari hang resolusi DNS).
    if (!config || !config.host) return DEFAULT_BRAND;
    // Merek yang sudah jelas disebut tak perlu di-probe sama sekali.
    if (config.brand && config.brand !== 'auto' && DRIVERS[config.brand]) return config.brand;
    if (await sepertinyaHioso(config)) return 'hioso';
    try {
        const res = await snmpGet(config, [SYS_OBJECT_ID, SYS_DESCR]);
        const soid = res[SYS_OBJECT_ID] ? String(res[SYS_OBJECT_ID].value) : '';
        const descr = res[SYS_DESCR] ? String(res[SYS_DESCR].value) : '';
        const m = soid.match(/1\.3\.6\.1\.4\.1\.(\d+)/);
        const ent = m ? m[1] : null;
        if (ent) {
            for (const d of Object.values(DRIVERS)) {
                if (Array.isArray(d.enterpriseOids) && d.enterpriseOids.includes(ent)) {
                    return d.brand;
                }
            }
        }
        // Fallback: cocokkan nama brand di sysDescr.
        for (const d of Object.values(DRIVERS)) {
            if (descr && new RegExp(d.brand, 'i').test(descr)) return d.brand;
        }
    } catch (_e) {
        // Tak terjangkau / community salah → pakai default; biar caller yang lapor error koneksi.
    }
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
