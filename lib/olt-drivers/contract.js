/**
 * Header Doc
 * Purpose: Kontrak bersama untuk semua driver OLT multi-merk — bentuk data ONU ternormalisasi,
 *          flag kapabilitas, dan helper koersi supaya setiap brand bicara "bahasa" yang sama.
 * Caller: lib/olt-drivers/* (tiap driver brand), lib/olt-drivers/index.js (registry), routes/olt.js.
 * Deps: tidak ada (murni definisi + helper sinkron).
 * MainFuncs: `defaultCapabilities`, `normalizeOnu`, `IDENTIFIER`.
 * SideEffects: tidak ada.
 *
 * CATATAN ARSITEKTUR (multi-merk OLT):
 * - Tiap driver brand WAJIB mengembalikan ONU dalam bentuk {@link OnuRecord} dari getOltData().
 * - EPON (HIOSO/VSOL/HSGQ) identitas utamanya MAC. GPON (ZTE C320/C300) identitas native-nya
 *   Serial Number; MAC dipakai bila driver bisa expose-nya. Karena itu OnuRecord punya DUA
 *   field identitas (macAddress + serial) dan capabilities.primaryIdentifier menandai mana yang utama.
 * - Matching pelanggan: MAC-first, fallback Serial (lihat capabilities.primaryIdentifier).
 */

/**
 * @typedef {Object} OnuRecord  Bentuk ONU ternormalisasi lintas-merk.
 * @property {string} id            ONU id dalam PON (mis. "4").
 * @property {string} slotId        Slot/PON id (EPON: slot; GPON: gpon-port). Disebut slotId demi kompat.
 * @property {string} name          Nama/deskripsi ONU, atau "N/A".
 * @property {string} macAddress    MAC ONU "XX:XX:..." atau "N/A" (EPON & GPON-yang-expose-MAC).
 * @property {string|null} serial   Serial Number ONU (GPON, mis. "ZTEGxxxxxxxx") atau null.
 * @property {string|null} description  Deskripsi admin ONU; di banyak ISP GPON = username PPPoE (key matching).
 * @property {string|null} ponName  Nama port PON human-readable (mis. "gpon_1/2/1") atau null.
 * @property {string} status        "Online" | "Offline" | "LOS" | "Dying Gasp" | "Sync" | "Auth Fail" | "N/A".
 * @property {boolean} statusKnown  false = walk status tak menyebut ONU ini, jadi `status`/`isLos`
 *                                  BUKAN pengamatan. Konsumen wajib cek sebelum menyimpulkan.
 * @property {boolean} isLos
 * @property {boolean} isDyingGasp
 * @property {string|null} lastDownCause  Kode mentah penyebab down dari OLT (semantik per-brand).
 * @property {string} rxPower       "-24.50 dBm" atau "N/A".
 * @property {string} [txPower]
 * @property {*} [raw]              Data mentah brand-specific untuk debugging (opsional).
 */

/**
 * @typedef {Object} OltCapabilities  Apa yang sanggup/dibutuhkan sebuah brand.
 * @property {boolean} losViaSnmp        Bisa pastikan LOS murni via SNMP.
 * @property {boolean} dyingGaspViaSnmp  Bisa bedakan Dying Gasp via SNMP (tanpa scrape/syslog).
 * @property {boolean} needsWebScrape    Butuh web log scraper untuk akurasi LOS vs Dying Gasp.
 * @property {boolean} needsSyslog       Terbantu/menerima syslog push untuk event realtime.
 * @property {'mac'|'serial'} primaryIdentifier  Identitas utama matching pelanggan.
 */

/**
 * @typedef {Object} OltDriver
 * @property {string} brand
 * @property {string} label
 * @property {string[]} enterpriseOids  Enterprise number(s) di sysObjectID untuk auto-deteksi (Fase 1).
 * @property {OltCapabilities} capabilities
 * @property {(config: object) => Promise<object>} getOltData
 * @property {(config: object, slotId: string|number, onuId: string|number) => Promise<object>} getSingleOnuData
 * @property {(config: object) => Promise<{ok: boolean, detectedBrand?: string, onuCount?: number, message?: string}>} testConnection
 * @property {(mikrotikMac: string, onu: OnuRecord) => boolean} matchIdentity
 */

const IDENTIFIER = Object.freeze({ MAC: 'mac', SERIAL: 'serial' });

/**
 * Kapabilitas default yang konservatif: anggap brand tak bisa apa-apa sampai driver
 * menyatakannya. Driver meng-override field yang relevan.
 * @returns {OltCapabilities}
 */
function defaultCapabilities() {
    return {
        losViaSnmp: false,
        dyingGaspViaSnmp: false,
        needsWebScrape: false,
        needsSyslog: false,
        primaryIdentifier: IDENTIFIER.MAC,
    };
}

/**
 * Pastikan sebuah objek ONU dari driver punya semua field {@link OnuRecord}.
 * Dipakai sebagai jaring pengaman supaya konsumen (routes/olt.js) bisa andalkan
 * `onu.serial` dll. tanpa cek undefined, apa pun brand-nya.
 * @param {Partial<OnuRecord>} onu
 * @returns {OnuRecord}
 */
function normalizeOnu(onu = {}) {
    return {
        id: onu.id != null ? String(onu.id) : 'N/A',
        slotId: onu.slotId != null ? String(onu.slotId) : 'N/A',
        name: onu.name || 'N/A',
        macAddress: onu.macAddress || 'N/A',
        serial: onu.serial || null,
        description: onu.description || null,
        ponName: onu.ponName || null,
        status: onu.status || 'N/A',
        // PENANDA KEJUJURAN — wajib ikut, jangan dibuang lagi. Dulu field ini tidak ada di literal
        // ini, sehingga `statusKnown:false` dari driver HIOSO lenyap begitu melewati normalizer,
        // dan SELURUH penjaga di hilir (isRxPowerValid, `status_known` di routes/olt.js, verdict
        // TIDAK_TERBACA di post-repair-verification) diam-diam mengambil cabang "boleh dipercaya".
        // Semantiknya dipertahankan: hanya `false` eksplisit yang berarti status tak terbaca, jadi
        // merk yang tak mengirim apa-apa tetap dianggap terbaca.
        statusKnown: onu.statusKnown !== false,
        isLos: !!onu.isLos,
        isDyingGasp: !!onu.isDyingGasp,
        lastDownCause: onu.lastDownCause != null ? onu.lastDownCause : null,
        rxPower: onu.rxPower || 'N/A',
        txPower: onu.txPower || 'N/A',
        attenuation: onu.attenuation || 'N/A',
        ...(onu.raw !== undefined ? { raw: onu.raw } : {}),
        // Pertahankan field tempelan dispatcher (olt_id/olt_name/olt_host) bila ada.
        ...(onu.olt_id !== undefined ? { olt_id: onu.olt_id } : {}),
        ...(onu.olt_name !== undefined ? { olt_name: onu.olt_name } : {}),
        ...(onu.olt_host !== undefined ? { olt_host: onu.olt_host } : {}),
    };
}

module.exports = { IDENTIFIER, defaultCapabilities, normalizeOnu };
