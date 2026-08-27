/**
 * Header Doc
 * Purpose: Driver brand HIOSO EPON. **Membaca lewat WEB, TIDAK PERNAH lewat SNMP.**
 *
 *          !! SNMP MEMBUAT OLT HIOSO HANG (keputusan pemilik, terbukti di lapangan). ZTE aman
 *          dengan SNMP — larangan ini khusus HIOSO. Karena itu penjagaannya ditaruh di DRIVER,
 *          bukan di tiap pemanggil: terukur ada 6 titik panggil SNMP langsung hanya di
 *          `routes/olt.js`, dan menambal satu per satu berarti titik ke-7 lahir terbuka lagi.
 *          Dengan driver ini, merek HIOSO tak punya jalan ke SNMP dari mana pun.
 *
 *          Sumber data: `lib/olt-web-optical` (halaman web OLT). Kredensial web diambil dari
 *          `config` bila ada; kalau tidak, perangkatnya dicari sendiri di `olt-manager`
 *          berdasarkan host — supaya pemanggil lama yang hanya merakit config SNMP tetap
 *          bekerja tanpa harus diubah semua.
 *
 *          Kalau kredensial web TIDAK ADA, driver ini **gagal terang-terangan** dan TIDAK
 *          jatuh balik ke SNMP. Diam-diam kembali ke SNMP persis kelas kesalahan yang
 *          larangan ini hendak cegah.
 * Caller: lib/olt-drivers/index.js (registry) → dipakai `olt-hioso` dispatcher & routes/olt.js.
 * Deps: `../olt-web-optical` (getWebOpticalSnapshot, bacaOnuSegar), `../olt-manager`
 *       (resolusi perangkat dari host), `./contract` (normalizeOnu). Lazy-require semuanya
 *       untuk memutus siklus load-time dengan dispatcher.
 * MainFuncs: getOltData, getSingleOnuData, testConnection, matchIdentity.
 * SideEffects: HTTP GET read-only ke web OLT. Tidak membuka sesi SNMP sama sekali.
 */

const { defaultCapabilities, IDENTIFIER, normalizeOnu } = require('./contract');

/** @returns {import('../olt-hioso')} — HANYA untuk helper murni (matchMAC), bukan SNMP. */
function impl() {
    return require('../olt-hioso');
}

function web() {
    return require('../olt-web-optical');
}

/** Lengkapi config dengan kredensial web milik perangkat ini (dicari dari host). */
function perangkatWeb(config) {
    const host = config && config.host;
    let dev = null;
    try {
        const daftar = require('../olt-manager').getOltDevices() || [];
        dev = daftar.find((d) => d && String(d.host) === String(host)) || null;
    } catch (_e) {
        dev = null;
    }
    return {
        id: (config && config.id) || (dev && dev.id) || null,
        name: (config && config.name) || (dev && dev.name) || String(host || ''),
        host,
        webUsername: (config && config.webUsername) || (dev && dev.webUsername) || '',
        webPassword: (config && config.webPassword) || (dev && dev.webPassword) || '',
        webPort: (config && config.webPort) || (dev && dev.webPort) || 80,
        webTimeoutMs: (config && config.webTimeoutMs) || (dev && dev.webTimeoutMs) || undefined,
        brand: 'hioso',
    };
}

function gagalTanpaKredensial(host) {
    return {
        status: 'error',
        message: `Kredensial web OLT ${host || '?'} belum diisi. HIOSO dibaca lewat web — SNMP tidak dipakai `
            + `karena membuat OLT hang. Isi webUsername/webPassword pada perangkat ini.`,
        onus: [],
        data: null,
    };
}

const capabilities = {
    ...defaultCapabilities(),
    // HIOSO tidak bisa membedakan LOS vs Dying Gasp via SNMP (kedua kondisi → phaseState=2,
    // lastDownCause=1) — dan SNMP-nya memang tak dipakai lagi. Pembedanya: web scraper + syslog.
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
    // sysObjectID HIOSO di bawah enterprise 25355 — dipakai auto-deteksi merek, bukan pembacaan data.
    enterpriseOids: ['25355'],
    capabilities,

    async getOltData(config) {
        const dev = perangkatWeb(config);
        if (!dev.webUsername) return gagalTanpaKredensial(dev.host);
        try {
            const snap = await web().getWebOpticalSnapshot({ getDevices: () => [dev] });
            if (!snap || snap.status !== 'success') {
                return { status: 'error', message: (snap && snap.message) || 'Gagal membaca web OLT', onus: [] };
            }
            if (Array.isArray(snap.failedOlts) && snap.failedOlts.length) {
                const f = snap.failedOlts[0];
                return { status: 'error', message: `OLT tak terbaca lewat web: ${(f && f.message) || 'tidak diketahui'}`, onus: [] };
            }
            return {
                status: 'success',
                timestamp: snap.timestamp,
                fetchedAt: snap.fetchedAt,
                onus: (snap.onus || []).map(normalizeOnu),
                systemInfo: snap.systemInfo || {},
                incompleteWalks: [],
                failedWalks: [],
            };
        } catch (e) {
            return { status: 'error', message: (e && e.message) || 'Gagal membaca web OLT', onus: [] };
        }
    },

    async getSingleOnuData(config, slotId, onuId) {
        const dev = perangkatWeb(config);
        if (!dev.webUsername) return gagalTanpaKredensial(dev.host);
        if (slotId == null || onuId == null) {
            return { status: 'error', message: 'Parameter tidak lengkap (slotId, onuId diperlukan)', data: null };
        }
        // Halaman OLT memakai penomoran `0/1/<slot>:<onu>`.
        const pon = `0/1/${slotId}`;
        const idOnu = `${pon}:${onuId}`;
        try {
            const r = await web().bacaOnuSegar(dev, pon, idOnu);
            if (!r || !r.ok) {
                return { status: 'error', message: (r && r.err) || 'ONU tak terbaca di web OLT', data: null };
            }
            // ONU yang tak menjawab tidak punya rxPower sah — jangan mengarang angka.
            const online = r.rxPower != null;
            return {
                status: 'success',
                timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                data: {
                    rxPower: online ? r.rxPower : 'N/A',
                    txPower: r.txPower != null ? r.txPower : 'N/A',
                    status: online ? 'Online' : 'Offline',
                    statusKnown: true,
                    // Pembeda LOS vs dying-gasp BUKAN milik jalur ini — pemiliknya log web
                    // (`olt-log-scraper`) + syslog. Lihat #b279.
                    isLos: false,
                    isDyingGasp: false,
                    lastDownCause: null,
                    slotId: String(slotId),
                    id: String(onuId),
                    onuId: idOnu,
                    sumber: 'web',
                },
            };
        } catch (e) {
            return { status: 'error', message: (e && e.message) || 'Gagal membaca ONU di web OLT', data: null };
        }
    },

    async testConnection(config) {
        const result = await driver.getOltData(config);
        if (result && result.status === 'success') {
            return { ok: true, detectedBrand: 'hioso', onuCount: (result.onus || []).length };
        }
        return { ok: false, message: (result && result.message) || 'Gagal koneksi ke OLT' };
    },

    /** Matching identitas EPON: 10 hex pertama MAC MikroTik vs MAC ONU. Helper murni, bukan SNMP. */
    matchIdentity(mikrotikMac, onu) {
        return impl().matchMAC(mikrotikMac, onu && onu.macAddress);
    },
};

module.exports = driver;
