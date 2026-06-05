/**
 * Header Doc
 * Purpose: Driver brand HIOSO EPON — adaptor tipis yang membungkus implementasi SNMP di lib/olt-hioso.js
 *          ke kontrak OltDriver bersama (lib/olt-drivers/contract.js).
 * Caller: lib/olt-drivers/index.js (registry); tidak dipanggil langsung oleh route.
 * Deps: lib/olt-hioso.js (lazy-require di dalam fungsi untuk hindari siklus require dengan dispatcher).
 * MainFuncs: getOltData, getSingleOnuData, testConnection, matchIdentity.
 * SideEffects: tidak ada (delegasi murni; olt-hioso yang buka/tutup sesi SNMP).
 *
 * Kenapa lazy-require: olt-hioso.js (dispatcher getMultipleOltData) memanggil registry,
 * registry memuat driver ini, driver ini butuh olt-hioso. Lazy-require memutus siklus
 * load-time. Fase 2 akan membalik kepemilikan (driver yang punya impl SNMP), untuk
 * sekarang olt-hioso tetap source of truth supaya perilaku byte-identik & test tetap hijau.
 */

const { defaultCapabilities, IDENTIFIER, normalizeOnu } = require('./contract');

/** @returns {import('../olt-hioso')} */
function impl() {
    return require('../olt-hioso');
}

const capabilities = {
    ...defaultCapabilities(),
    // HIOSO tidak bisa membedakan LOS vs Dying Gasp via SNMP (kedua kondisi → phaseState=2,
    // lastDownCause=1). Karena itu butuh web scraper + syslog untuk akurasi.
    losViaSnmp: false,
    dyingGaspViaSnmp: false,
    needsWebScrape: true,
    needsSyslog: true,
    primaryIdentifier: IDENTIFIER.MAC,
};

/** @type {import('./contract').OltDriver} */
const driver = {
    brand: 'hioso',
    label: 'HIOSO EPON',
    // sysObjectID HIOSO berada di bawah enterprise 25355 (dipakai auto-deteksi Fase 1).
    enterpriseOids: ['25355'],
    capabilities,

    async getOltData(config) {
        const result = await impl().getOltData(config);
        if (result && result.status === 'success' && Array.isArray(result.onus)) {
            result.onus = result.onus.map(normalizeOnu);
        }
        return result;
    },

    getSingleOnuData(config, slotId, onuId) {
        return impl().getSingleOnuData(config, slotId, onuId);
    },

    async testConnection(config) {
        const result = await impl().getOltData(config);
        if (result && result.status === 'success') {
            return { ok: true, detectedBrand: 'hioso', onuCount: result.onus.length };
        }
        return { ok: false, message: (result && result.message) || 'Gagal koneksi ke OLT' };
    },

    /**
     * Matching identitas EPON: bandingkan 10 hex pertama MAC MikroTik dengan MAC ONU.
     * (Fase 2 GPON: tambah fallback serial di dispatcher saat MAC tak tersedia.)
     */
    matchIdentity(mikrotikMac, onu) {
        return impl().matchMAC(mikrotikMac, onu && onu.macAddress);
    },
};

module.exports = driver;
