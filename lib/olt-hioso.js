/**
 * Header Doc
 * Purpose: Driver SNMP OLT HIOSO (EPON) — membaca inventaris ONU beserta MAC, rxPower (redaman),
 *          phase-state (Online/LOS/Sync/Auth Fail/Offline) dan lastDownCause, lalu menggabungkan
 *          hasil banyak OLT jadi satu snapshot. Juga driver default untuk device brand 'auto'.
 *          KEJUJURAN DATA adalah bagian dari kontraknya: walk per-OID sengaja best-effort (satu OID
 *          rewel tak boleh menjatuhkan seluruh fetch), jadi hasil setengah jadi WAJIB ditandai —
 *          `onu.statusKnown=false` saat phaseState tak menyebut ONU itu, `incompleteWalks` +
 *          `failedWalks` di tingkat OLT, `failedOlts` di tingkat armada, dan status `error` bila
 *          SEMUA OLT gagal dibaca (bukan sukses berisi nol ONU, yang di hilir terbaca sebagai
 *          "semua pelanggan offline").
 *          GAGAL ≠ KOSONG: walk yang menolak dicatat terpisah dari walk yang memang tak berisi,
 *          supaya "OLT tak menjawab" tak tertukar dengan "OLT belum punya ONU".
 *          SEBAGIAN ≠ UTUH: snapshot gabungan yang kehilangan satu OLT tetap `success` (data OLT
 *          hidup masih berguna) TAPI wajib menyebut `failedOlts` — pemanggil tak bisa menyimpulkan
 *          kebutaan itu dari `onus`, dan tanpa daftar tsb pelanggan di balik OLT bisu divonis mati.
 *          PEMBATAS WAKTU IKUT KONFIGURASI: anggaran SNMP nyata = timeout × (1 + retries); pembatas
 *          darurat yang lebih pendek akan selalu menang duluan dan membuang seluruh verdict di atas.
 * Caller: `routes/olt.js` (dashboard monitor OLT), `lib/olt-optical-resolver.js` (bot teknisi),
 *         `lib/olt-rxpower-poller.js`, `lib/olt-drivers/*` (dispatch per-merk).
 * Deps: `net-snmp`.
 * MainFuncs: `getOltData`, `getMultipleOltData`, `getSingleOnuData`, `normalizeMAC`, `parseRxPower`.
 * SideEffects: Membuka sesi SNMP UDP ke OLT (read-only walk/get). Tidak menulis apa pun.
 *
 * Data yang diambil: MAC ONT, RX Power (redaman) dBm, status ONT, indikator Dying Gasp & LOS.
 */

const snmp = require('net-snmp');

// OID Map untuk HIOSO OLT
// Berdasarkan HIOSO MIB documentation dan testing
const HIOSO_OID = {
    enterpriseRoot: '1.3.6.1.4.1.25355',
    system: {
        hiosoRoot: '1.3.6.1.4.1.25355.3.1',
        ipAddress: '1.3.6.1.4.1.25355.3.1.1.0',
        subnetMask: '1.3.6.1.4.1.25355.3.1.2.0',
        gateway: '1.3.6.1.4.1.25355.3.1.3.0',
        firmwareVersion: '1.3.6.1.4.1.25355.3.1.8.1.1.2.1',
        mib2Root: '1.3.6.1.2.1.1',
        sysDescr: '1.3.6.1.2.1.1.1.0',
        sysName: '1.3.6.1.2.1.1.5.0',
    },
    onu: {
        name: '1.3.6.1.4.1.25355.3.2.6.3.2.1.37',
        mac: '1.3.6.1.4.1.25355.3.2.6.3.2.1.11',
        // Phase State: 1=working/online, 2=LOS/offline, 3=syncMib, 4=authFail, 5=offline
        phaseState: '1.3.6.1.4.1.25355.3.2.6.3.2.1.39',
        // Dying Gasp flag (tidak reliable, gunakan lastDownCause)
        dyingGasp: '1.3.6.1.4.1.25355.3.2.6.3.2.1.40',
        // Last Down Cause - KUNCI untuk membedakan LOS vs Dying Gasp:
        // 0 = Normal / No down
        // 1 = Power failure / Dying Gasp (adaptor mati)
        // 2 = LOS (Loss of Signal - fiber putus)
        // 3 = LOF (Loss of Frame)
        // 4 = LOA (Loss of Ack)
        // 5 = Deactivate
        lastDownCause: '1.3.6.1.4.1.25355.3.2.6.3.2.1.41',
        rxPower: '1.3.6.1.4.1.25355.3.2.6.14.2.1.8',
        txPower: '1.3.6.1.4.1.25355.3.2.6.14.2.1.4',
        distance: '1.3.6.1.4.1.25355.3.2.6.3.2.1.25',
    }
};

// Last Down Cause values
// CATATAN: Berdasarkan testing, OLT HIOSO tidak membedakan LOS vs Dying Gasp
// Kedua kondisi (fiber dicabut dan adaptor mati) menghasilkan lastDownCause = 1
// Jadi kita tidak bisa membedakan keduanya melalui SNMP

// Kolom yang MEMBAWA INVENTARIS/status ONU. Hanya kegagalan di sini yang boleh membatalkan
// pembacaan: `name` dan `lastDownCause` cuma hiasan, dan menghitung keduanya membuat OLT baru
// yang memang belum punya ONU divonis rusak cuma karena satu kolom hiasan timeout.
const INVENTORY_WALKS = ['mac', 'phaseState', 'rxPower'];

// net-snmp menyerah setelah timeout × (1 + retries) — `backoff` default 1.0, jadi tidak naik.
// Pembatas darurat WAJIB di atas anggaran itu; kalau lebih pendek ia selalu menang duluan dan
// seluruh verdict per-walk di bawah tak pernah sampai ke pemanggil. Slack dipakai untuk
// membongkar sesi setelah walk terakhir menyerah.
const SNMP_DEADLINE_SLACK_MS = 10000;

/**
 * Anggaran waktu SNMP nyata + slack. Diekspor supaya BISA DIKUNCI TES: pembatas darurat yang lebih
 * pendek dari `timeout × (1 + retries)` selalu menang duluan, dan seluruh verdict gagal-vs-kosong
 * di bawahnya berubah jadi kode mati tanpa satu pun tes berubah merah (persis yang terjadi dengan
 * pembatas tetap 60 detik melawan config produksi 30000×3 = 90 detik).
 * @param {number} timeout ms per request SNMP
 * @param {number} retries jumlah pengulangan per request
 * @returns {number} ms
 */
function snmpDeadlineMs(timeout, retries) {
    return timeout * (1 + retries) + SNMP_DEADLINE_SLACK_MS;
}

/**
 * Format MAC address dari hex string ke format standar
 * @param {string} hexString - MAC dalam format hex (12 karakter)
 * @returns {string} MAC dalam format XX:XX:XX:XX:XX:XX
 */
function formatMacAddress(hexString) {
    if (typeof hexString !== 'string' || hexString.length !== 12) {
        return hexString;
    }
    return hexString.match(/.{2}/g).join(':').toUpperCase();
}

/**
 * Normalisasi MAC address untuk matching
 * Menghapus separator dan uppercase
 * @param {string} mac - MAC address dalam berbagai format
 * @returns {string} MAC tanpa separator, uppercase
 */
function normalizeMAC(mac) {
    if (!mac || typeof mac !== 'string') return '';
    return mac.replace(/[:\-\s]/g, '').toUpperCase();
}

/**
 * Match MAC address antara MikroTik dan OLT
 * MAC di OLT berbeda 2 digit terakhir dengan MAC di MikroTik
 * 
 * @param {string} mikrotikMAC - MAC dari MikroTik PPPoE
 * @param {string} oltMAC - MAC dari OLT
 * @returns {boolean} true jika match (10 digit pertama sama)
 */
function matchMAC(mikrotikMAC, oltMAC) {
    const mikNorm = normalizeMAC(mikrotikMAC);
    const oltNorm = normalizeMAC(oltMAC);
    
    if (mikNorm.length < 10 || oltNorm.length < 10) return false;
    
    // Bandingkan 10 karakter pertama (5 oktet = 10 hex digit)
    return mikNorm.substring(0, 10) === oltNorm.substring(0, 10);
}

/**
 * Parse RX Power ke format dBm
 * @param {string|number} value - Nilai dari SNMP
 * @returns {string} Nilai dalam format "X.XX dBm" atau "N/A"
 */
function parseRxPower(value) {
    if (value === 'N/A' || value === null || value === undefined) return 'N/A';
    
    const parsedValue = parseFloat(value);
    if (isNaN(parsedValue)) return 'N/A';
    
    return parsedValue.toFixed(2) + ' dBm';
}

/**
 * Get ONU ID dari OID
 * Format OID: {baseOid}.{X}.{slot}.{onu}
 * @param {string} oid - Full OID string
 * @returns {string} ONU ID (bagian terakhir)
 */
function getOnuIdFromOid(oid) {
    const parts = oid.split('.');
    return parts[parts.length - 1];
}

/**
 * Get Slot ID dari OID
 * Format OID: {baseOid}.{X}.{slot}.{onu}
 * @param {string} oid - Full OID string
 * @returns {string} Slot ID (bagian kedua dari belakang)
 */
function getSlotIdFromOid(oid) {
    const parts = oid.split('.');
    if (parts.length >= 2) {
        return parts[parts.length - 2];
    }
    return 'UNKNOWN';
}

/**
 * Get full suffix dari OID (untuk query yang akurat)
 * Format OID: {baseOid}.{X}.{slot}.{onu}
 * @param {string} oid - Full OID string
 * @param {string} baseOid - Base OID yang digunakan
 * @returns {string} Full suffix (X.slot.onu)
 */

/**
 * Perform SNMP Walk dengan session
 * @param {Object} session - SNMP session
 * @param {string} baseOid - Base OID untuk walk
 * @param {number} maxOids - Maximum OIDs to collect
 * @returns {Promise<Array>} Array of {oid, value, type}
 */
async function performSnmpWalk(session, baseOid, maxOids = 5000) {
    return new Promise((resolve, reject) => {
        const results = [];
        let lastOid = '';
        const MAX_SAME_OID_REPEATS = 3;
        let sameOidRepeatCount = 0;

        const feedCb = (varbinds) => {
            if (results.length >= maxOids) {
                resolve(results);
                return;
            }

            for (let i = 0; i < varbinds.length; i++) {
                const varbind = varbinds[i];
                
                if (varbind.type === snmp.ObjectType.EndOfMibView || 
                    varbind.type === snmp.ObjectType.NoSuchObject || 
                    varbind.type === snmp.ObjectType.NoSuchInstance) {
                    resolve(results);
                    return;
                }

                if (varbind.oid === lastOid) {
                    sameOidRepeatCount++;
                    if (sameOidRepeatCount >= MAX_SAME_OID_REPEATS) {
                        reject(new Error(`OID loop detected at ${varbind.oid}`));
                        return;
                    }
                } else {
                    sameOidRepeatCount = 0;
                    lastOid = varbind.oid;
                }

                const normalizedBaseOid = baseOid.startsWith('.') ? baseOid.substring(1) : baseOid;
                const normalizedVarbindOid = varbind.oid.startsWith('.') ? varbind.oid.substring(1) : varbind.oid;

                if (!normalizedVarbindOid.startsWith(normalizedBaseOid)) {
                    resolve(results);
                    return;
                }

                let value = null;
                if (varbind.value !== null && varbind.value !== undefined) {
                    if (varbind.type === snmp.ObjectType.OctetString) {
                        try {
                            let strValue = varbind.value.toString('utf8');
                            strValue = strValue.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
                            if (strValue.toLowerCase() === 'na' || strValue === '') {
                                value = 'N/A';
                            } else {
                                value = strValue;
                            }
                        } catch (_e) {
                            value = varbind.value.toString('hex');
                        }
                    } else if (varbind.type === snmp.ObjectType.TimeTicks) {
                        value = parseInt(varbind.value.toString(), 10) / 100;
                    } else {
                        value = varbind.value.toString();
                    }
                }

                results.push({
                    oid: varbind.oid,
                    value: value,
                    type: snmp.ObjectType[varbind.type] || 'UNKNOWN_TYPE'
                });
            }
        };

        const doneCb = (error) => {
            if (error) {
                reject(error);
            } else {
                resolve(results);
            }
        };

        session.walk(baseOid, feedCb, doneCb);
    });
}

/**
 * Get OLT data via SNMP
 * @param {Object} config - OLT configuration {host, port, community, timeout, retries}
 * @returns {Promise<Object>} OLT data with ONUs
 */
async function getOltData(config) {
    const { host, port = 161, community = 'public', timeout = 15000, retries = 2 } = config;

    // Bentuk hasil GAGAL yang seragam. Dulu tiap jalan keluar menyusun objeknya sendiri dan empat
    // dari tujuh lupa membawa `incompleteWalks`/`failedWalks`, sehingga pemanggil tak bisa
    // membedakan "tak ada walk yang gagal" dari "driver tidak bercerita".
    const failure = (message, extra = {}) => ({
        status: 'error',
        message,
        onus: [],
        systemInfo: {},
        incompleteWalks: [],
        failedWalks: [],
        ...extra
    });

    if (!host) {
        return failure('Host OLT tidak dikonfigurasi');
    }

    const session = snmp.createSession(host, community, {
        version: snmp.Version2c,
        timeout: timeout,
        retries: retries,
        port: port
    });

    let sessionClosed = false;
    const closeSession = () => {
        if (!sessionClosed && session) {
            sessionClosed = true;
            try {
                session.close();
            } catch (_e) {
                // Ignore close errors
            }
        }
    };

    // Ditandai juga dari LUAR executor (jalur pembatas darurat), supaya pekerjaan yang terlanjur
    // jalan tahu hasilnya sudah tak dipakai dan tidak ikut mencetak vonis tentang OLT.
    let settled = false;

    // Anggaran waktu, bukan angka bulat — lihat SNMP_DEADLINE_SLACK_MS. Timer-nya DIBERSIHKAN di
    // `finally` di bawah; sebelumnya ia hidup terus sampai tuntas dan menahan event loop tiap panggilan.
    const deadlineMs = snmpDeadlineMs(timeout, retries);
    let deadlineTimer = null;
    const timeoutPromise = new Promise((_, reject) => {
        deadlineTimer = setTimeout(() => {
            reject(new Error(`OLT tidak menjawab SNMP dalam ${Math.round(deadlineMs / 1000)} detik`));
        }, deadlineMs);
    });

    // Jalur cepat kegagalan soket. net-snmp memanggil `this.emit(error)` di onError — objek Error
    // jadi NAMA event, jadi listener 'error' di bawah TAK PERNAH menyala untuk kegagalan soket
    // (ENETUNREACH/EHOSTUNREACH, persis gejala "Destination Host Unreachable"). Karena itu dgram-nya
    // didengarkan langsung: host mati gagal dalam milidetik, bukan setelah seluruh anggaran habis.
    let signalSocketFailure = () => {};
    const socketFailurePromise = new Promise((resolve) => {
        signalSocketFailure = (err) => {
            const reason = (err && err.message) || String(err || 'soket gagal');
            resolve(failure(`Gagal koneksi SNMP ke ${host}: ${reason}`));
        };
    });
    session.on('error', signalSocketFailure);
    try {
        if (session.dgram && typeof session.dgram.on === 'function') {
            session.dgram.on('error', signalSocketFailure);
        }
    } catch (_e) {
        // Versi net-snmp tanpa dgram publik — biarkan kegagalan muncul lewat walk yang menolak.
    }

    const dataPromise = new Promise(async (resolve) => {
        try {
            const oltData = {
                status: 'success',
                timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                systemInfo: {},
                onus: []
            };

            // GAGAL ≠ KOSONG. Satu walk yang rewel tak boleh menjatuhkan seluruh fetch, tapi
            // menelannya jadi `[]` (perilaku lama) menghapus beda antara "OLT tak menjawab" dan
            // "OLT memang tak punya ONU" — dua hal yang penanganannya berlawanan. Kegagalan kini
            // dicatat berikut ALASANNYA, bukan disamarkan.
            const runWalk = (name, oid) => performSnmpWalk(session, oid)
                .then((rows) => ({ name, rows, failed: false, reason: null }))
                .catch((err) => ({
                    name,
                    rows: [],
                    failed: true,
                    reason: (err && err.message) || 'gagal tanpa keterangan'
                }));

            // Daftar walk dipegang sebagai SATU array; jangan disusun ulang dari variabel hasil
            // destructure — pembilang dan penyebut "semua walk gagal" harus mustahil melenceng.
            const walks = await Promise.all([
                runWalk('mac', HIOSO_OID.onu.mac),
                runWalk('rxPower', HIOSO_OID.onu.rxPower),
                runWalk('phaseState', HIOSO_OID.onu.phaseState),
                runWalk('lastDownCause', HIOSO_OID.onu.lastDownCause),
                runWalk('name', HIOSO_OID.onu.name),
            ]);

            // Pembatas darurat sudah menang duluan → hasil ini takkan dipakai. Berhenti DIAM-DIAM:
            // menutup sesi membuat net-snmp membatalkan semua request dengan "Socket forcibly
            // closed", dan mencetak itu sebagai sebab kegagalan OLT sama dengan menyalahkan diri
            // sendiri di log yang justru dibaca orang saat mendiagnosis.
            if (settled) return;

            const rowsOf = (name) => (walks.find((w) => w.name === name) || { rows: [] }).rows;
            const failedWalks = walks.filter((w) => w.failed).map((w) => w.name);
            const failureDetail = walks
                .filter((w) => w.failed)
                .map((w) => `${w.name} (${w.reason})`)
                .join(', ');

            const onuMacResults = rowsOf('mac');
            const onuRxPowerResults = rowsOf('rxPower');
            const onuPhaseStateResults = rowsOf('phaseState');
            const onuLastDownCauseResults = rowsOf('lastDownCause');
            const onuNameResults = rowsOf('name');

            // Kolom yang tak menghasilkan baris — entah gagal entah memang kosong — ditandai supaya
            // UI tak menyajikan hasil setengah jadi sebagai hasil utuh. Yang paling menyesatkan:
            // rxPower sukses tapi phaseState gagal → redaman terisi, status tak diketahui, dan
            // pembaca menyimpulkan "sinyal bagus". Penjaganya `onu.statusKnown` di bawah.
            const incompleteWalks = INVENTORY_WALKS.filter((name) => rowsOf(name).length === 0);

            // DUA log terpisah, sengaja. Menggabungkannya melahirkan kalimat bohong: daftar kolom
            // KOSONG disandingkan dengan bendera "ada yang gagal" terbaca seolah kolom-kolom itulah
            // yang gagal. Lagipula `name`/`lastDownCause` tak masuk incompleteWalks, jadi dulu
            // kegagalan keduanya tak pernah tercetak sama sekali.
            if (failedWalks.length > 0) {
                console.warn(`[OLT] ${host}: walk GAGAL — ${failureDetail}.`);
            }
            const emptyNotFailed = incompleteWalks.filter((name) => !failedWalks.includes(name));
            if (emptyNotFailed.length > 0) {
                console.warn(`[OLT] ${host}: walk KOSONG tapi tidak gagal — ${emptyNotFailed.join(', ')}.`);
            }

            // MAC kosong AKIBAT kegagalan = pembacaan gagal, bukan "OLT tanpa ONU". Hanya kolom
            // pembawa inventaris yang dihitung (lihat INVENTORY_WALKS): OLT baru yang memang belum
            // punya ONU tidak boleh divonis rusak cuma karena kolom `name` timeout. Kalau SEMUA
            // walk gagal, headline-nya beda karena penanganannya beda — perangkatnya yang bisu.
            const failedInventoryWalks = failedWalks.filter((name) => INVENTORY_WALKS.includes(name));
            const allWalksFailed = failedWalks.length === walks.length;
            if (onuMacResults.length === 0 && (failedInventoryWalks.length > 0 || allWalksFailed)) {
                const message = allWalksFailed
                    ? `OLT tidak menjawab SNMP: ${failureDetail}`
                    : `Pembacaan OLT gagal pada walk: ${failureDetail}`;
                console.error(`[OLT] ${host}: ${message} — pembacaan DITOLAK.`);
                closeSession();
                resolve(failure(message, { incompleteWalks, failedWalks }));
                return;
            }

            // WALK MAC KOSONG PADAHAL KOLOM LAIN BERISI = PEMBACAAN GAGAL, bukan "OLT tanpa ONU".
            // MAC adalah kunci identitas ONU di HIOSO, dan filter di bawah membuang setiap ONU yang
            // MAC-nya 'N/A' — jadi satu OID yang gagal MENGHAPUS SELURUH INVENTARIS, lalu snapshot
            // "sukses berisi nol ONU" itu di hilir terbaca sebagai "semua pelanggan mati".
            // Terjadi nyata di Tanjungharjo 2026-07-31: 96 pelanggan tampil Offline selama ~8 menit
            // padahal OLT sehat (walk yang sama dari proses terpisah membaca 105 ONU).
            const otherColumnsFilled = onuPhaseStateResults.length > 0
                || onuRxPowerResults.length > 0
                || onuNameResults.length > 0
                || onuLastDownCauseResults.length > 0;
            if (onuMacResults.length === 0 && otherColumnsFilled) {
                console.error(`[OLT] ${host}: walk MAC kosong padahal kolom lain berisi — pembacaan DITOLAK (bukan "semua ONU hilang").`);
                closeSession();
                resolve(failure(
                    'Pembacaan OLT tidak utuh: daftar MAC ONU kosong padahal kolom lain terbaca',
                    { incompleteWalks, failedWalks }
                ));
                return;
            }

            // Build ONU map
            const onuMap = new Map();

            const getOrCreateOnu = (oid) => {
                const onuId = getOnuIdFromOid(oid);
                const slotId = getSlotIdFromOid(oid);
                const key = `${slotId}_${onuId}`;
                
                if (!onuMap.has(key)) {
                    onuMap.set(key, {
                        id: onuId,
                        slotId: slotId,
                        name: 'N/A',
                        macAddress: 'N/A',
                        status: 'N/A',
                        // statusKnown=false sampai walk phaseState benar-benar menyebut ONU ini.
                        // Walk yang gagal tidak menjatuhkan seluruh fetch (hanya dicatat di
                        // `failedWalks`); tanpa penanda ini, walk phaseState yang timeout
                        // menghasilkan ONU "status N/A, isLos=false, rxPower terisi" — persis
                        // tampilan ONU sehat, padahal statusnya justru TIDAK diketahui.
                        statusKnown: false,
                        isLos: false,
                        isDyingGasp: false,
                        lastDownCause: null,
                        rxPower: 'N/A'
                    });
                }
                return onuMap.get(key);
            };

            // Process MAC addresses
            onuMacResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                const formattedMac = formatMacAddress(item.value);
                if (formattedMac !== 'N/A' && formattedMac.length === 17) {
                    onu.macAddress = formattedMac;
                }
            });

            // Process RX Power
            onuRxPowerResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                onu.rxPower = parseRxPower(item.value);
            });

            // Process Phase State: 1=working/online, 2=LOS/offline, 3=syncMib, 4=authFail, 5=offline
            // PENTING: phaseState = 2 bisa berarti LOS atau Dying Gasp
            // Gunakan lastDownCause untuk membedakan
            onuPhaseStateResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                onu.phaseStateRaw = item.value;
                onu.statusKnown = true;
                switch (item.value) {
                    case '1':
                        onu.status = 'Online';
                        break;
                    case '2':
                        // Sementara set sebagai Offline, akan di-finalize berdasarkan lastDownCause
                        onu.status = 'Offline';
                        break;
                    case '3':
                        onu.status = 'Sync';
                        break;
                    case '4':
                        onu.status = 'Auth Fail';
                        break;
                    case '5':
                    default:
                        onu.status = 'Offline';
                        break;
                }
            });

            // Process Last Down Cause - KUNCI untuk membedakan LOS vs Dying Gasp
            // 0 = Normal, 1 = Power failure (Dying Gasp), 2 = LOS, dll
            onuLastDownCauseResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                onu.lastDownCause = item.value;
            });

            // Process Names
            onuNameResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                if (item.value && item.value !== 'N/A') {
                    onu.name = item.value;
                }
            });

            // Finalize status berdasarkan phaseState dan lastDownCause
            // CATATAN: OLT HIOSO tidak membedakan LOS vs Dying Gasp melalui SNMP
            // Kedua kondisi menghasilkan phaseState=2 dan lastDownCause=1
            // Jadi kita gunakan status generik "LOS" untuk semua kondisi offline
            onuMap.forEach(onu => {
                if (onu.phaseStateRaw === '2') {
                    // ONT offline - tidak bisa membedakan LOS vs Dying Gasp
                    onu.isDyingGasp = false;
                    onu.isLos = true;
                    onu.status = 'LOS';
                }
            });

            // Convert map to array and sort
            oltData.onus = Array.from(onuMap.values())
                .filter(onu => onu.macAddress !== 'N/A') // Only include ONUs with valid MAC
                .sort((a, b) => {
                    const slotA = parseInt(a.slotId) || 0;
                    const slotB = parseInt(b.slotId) || 0;
                    if (slotA !== slotB) return slotA - slotB;
                    return parseInt(a.id) - parseInt(b.id);
                });

            // BARIS MAC ADA TAPI TAK SATU PUN LOLOS JADI ONU = nilai MAC-nya tak terbaca, bukan
            // "OLT tanpa pelanggan". Filter di atas membuang MAC 'N/A', dan `performSnmpWalk`
            // memetakan OctetString biner yang hancur saat pembersihan control-char ke 'N/A' —
            // jadi menghitung BARIS MENTAH saja membiarkan kasus ini lolos jadi "sukses berisi nol
            // ONU", wajah yang sama dengan insiden Tanjungharjo. Yang dihitung harus yang selamat.
            if (onuMacResults.length > 0 && oltData.onus.length === 0) {
                console.error(`[OLT] ${host}: ${onuMacResults.length} baris MAC terbaca tapi tak satu pun sah — pembacaan DITOLAK.`);
                closeSession();
                resolve(failure(
                    `Pembacaan OLT tidak utuh: ${onuMacResults.length} baris MAC terbaca tapi tak ada yang berbentuk MAC sah`,
                    { incompleteWalks, failedWalks }
                ));
                return;
            }

            oltData.incompleteWalks = incompleteWalks;
            oltData.failedWalks = failedWalks;

            closeSession();
            resolve(oltData);

        } catch (error) {
            closeSession();
            resolve(failure(`Error processing data: ${error.message}`));
        }
    });

    try {
        // `settled` ditandai SEBELUM sesi ditutup: penutupan itulah yang membuat net-snmp menolak
        // semua walk yang masih menggantung, dan tanpa penanda ini pekerjaan yatim di dalam
        // executor ikut mencetak "SEMUA walk gagal (Socket forcibly closed)" setelah fungsi ini
        // sudah menjawab — log yang menuduh OLT padahal kitalah yang menutup soketnya.
        const result = await Promise.race([dataPromise, socketFailurePromise, timeoutPromise]);
        settled = true;
        closeSession();
        return result;
    } catch (error) {
        settled = true;
        closeSession();
        return failure(error.message);
    } finally {
        clearTimeout(deadlineTimer);
    }
}

/**
 * Match OLT data dengan data pelanggan
 * @param {Array} oltOnus - Array of ONUs from OLT
 * @param {Array} mikrotikMacs - Array of {pppoe_username, mac} from MikroTik
 * @param {Array} users - Array of users from database
 * @returns {Array} Matched data with customer info
 */
function matchOltWithCustomers(oltOnus, mikrotikMacs, users) {
    const result = [];

    for (const onu of oltOnus) {
        // Find matching MikroTik MAC
        const mikrotikMatch = mikrotikMacs.find(m => matchMAC(m.mac, onu.macAddress));
        
        if (mikrotikMatch) {
            // Find user by pppoe_username
            const user = users.find(u => u.pppoe_username === mikrotikMatch.pppoe_username);
            
            if (user) {
                result.push({
                    user_id: user.id,
                    customer_name: user.name,
                    pppoe_username: user.pppoe_username,
                    mac_mikrotik: mikrotikMatch.mac,
                    mac_olt: onu.macAddress,
                    rx_power: onu.rxPower,
                    olt_status: onu.status,
                    is_dying_gasp: onu.isDyingGasp,
                    is_los: onu.isLos,
                    last_down_cause: onu.lastDownCause,
                    slot_id: onu.slotId,
                    onu_id: onu.id
                });
            }
        }
    }

    return result;
}

/**
 * Get single ONU data via SNMP - menggunakan performSnmpWalk yang sama dengan getOltData
 * Ini lebih reliable karena menggunakan metode yang sudah terbukti berhasil
 * 
 * @param {Object} config - OLT configuration {host, port, community, timeout, retries}
 * @param {string|number} slotId - Slot ID dari ONT
 * @param {string|number} onuId - ONU ID dari ONT
 * @returns {Promise<Object>} Single ONU data {rxPower, status, isLos, isDyingGasp}
 */
async function getSingleOnuData(config, slotId, onuId) {
    const { host, port = 161, community = 'public', timeout = 10000, retries = 1 } = config;

    if (!host || !slotId || !onuId) {
        return {
            status: 'error',
            message: 'Parameter tidak lengkap (host, slotId, onuId diperlukan)',
            data: null
        };
    }

    const targetSlotId = String(slotId);
    const targetOnuId = String(onuId);
    const targetKey = `${targetSlotId}.${targetOnuId}`;
    
    console.log(`[OLT] getSingleOnuData: slot=${targetSlotId}, onu=${targetOnuId}, key=${targetKey}`);

    const session = snmp.createSession(host, community, {
        version: snmp.Version2c,
        timeout: timeout,
        retries: retries,
        port: port
    });

    // Anggaran waktu nyata (timeout × percobaan), bukan angka bulat — alasan sama seperti di
    // getOltData: pembatas yang lebih pendek dari anggaran SNMP selalu menang duluan dan
    // membuang verdict per-walk di bawahnya.
    const deadlineMs = snmpDeadlineMs(timeout, retries);
    let deadlineTimer = null;
    const timeoutPromise = new Promise((_, reject) => {
        deadlineTimer = setTimeout(() => {
            reject(new Error(`OLT tidak menjawab SNMP dalam ${Math.round(deadlineMs / 1000)} detik`));
        }, deadlineMs);
    });

    const dataPromise = new Promise(async (resolve) => {
        let sessionClosed = false;

        const closeSession = () => {
            if (!sessionClosed && session) {
                sessionClosed = true;
                try { session.close(); } catch (_e) { /* ignore */ }
            }
        };

        session.on('error', (err) => {
            closeSession();
            resolve({
                status: 'error',
                message: `Gagal koneksi SNMP: ${err.message}`,
                data: null
            });
        });

        try {
            // GAGAL ≠ KOSONG, sama seperti getOltData. Menelan kegagalan jadi `[]` di sini membuat
            // OLT yang tak menjawab menghasilkan `{rxPower:'N/A', status:'N/A', isLos:false}` —
            // pembacaan buta yang berwajah persis modem sehat, lalu disajikan sebagai hasil
            // "Refresh Redaman" yang sukses.
            const runWalk = (name, oid) => performSnmpWalk(session, oid, 2000)
                .then((rows) => ({ name, rows, failed: false, reason: null }))
                .catch((err) => ({
                    name,
                    rows: [],
                    failed: true,
                    reason: (err && err.message) || 'gagal tanpa keterangan'
                }));

            const walks = await Promise.all([
                runWalk('rxPower', HIOSO_OID.onu.rxPower),
                runWalk('phaseState', HIOSO_OID.onu.phaseState),
                runWalk('lastDownCause', HIOSO_OID.onu.lastDownCause),
            ]);

            closeSession();

            const [rxPowerResults, phaseStateResults, lastDownCauseResults] = walks.map((w) => w.rows);
            const failedWalks = walks.filter((w) => w.failed);

            console.log(`[OLT] Walk results: rxPower=${rxPowerResults.length}, phaseState=${phaseStateResults.length}, lastDownCause=${lastDownCauseResults.length}`);

            // phaseState adalah SATU-SATUNYA sumber status di sini. Kalau walk-nya menolak, kita
            // buta — bukan sedang menatap modem mati. Menolak lebih jujur daripada mengarang
            // `status:'N/A', isLos:false`, yang di hilir dibaca sebagai "ONU tak bermasalah".
            const statusWalkFailed = failedWalks.some((w) => w.name === 'phaseState');
            if (statusWalkFailed) {
                const detail = failedWalks.map((w) => `${w.name} (${w.reason})`).join(', ');
                console.error(`[OLT] ${host} ${targetKey}: walk status gagal — ${detail}; pembacaan DITOLAK.`);
                resolve({
                    status: 'error',
                    message: `Pembacaan ONU gagal pada walk: ${detail}`,
                    data: null
                });
                return;
            }

            const result = {
                rxPower: 'N/A',
                status: 'N/A',
                // Walk status BERHASIL (dijaga di atas), tapi belum tentu menyebut ONU ini.
                // Penanda yang sama dengan getOltData supaya pemanggil bisa membedakan
                // "ONU ini offline" dari "ONU ini tak disebut OLT".
                statusKnown: false,
                isLos: false,
                isDyingGasp: false,
                lastDownCause: null
            };

            // Helper untuk cek apakah OID match dengan target slot.onu
            const isTargetOnu = (oid) => {
                const parts = oid.split('.');
                const onuIdFromOid = parts[parts.length - 1];
                const slotIdFromOid = parts[parts.length - 2];
                return slotIdFromOid === targetSlotId && onuIdFromOid === targetOnuId;
            };

            // Process RX Power - cari yang match dengan target
            for (const item of rxPowerResults) {
                if (isTargetOnu(item.oid)) {
                    result.rxPower = parseRxPower(item.value);
                    console.log(`[OLT] Found rxPower for ${targetKey}: ${result.rxPower}`);
                    break;
                }
            }

            // Process Phase State
            let phaseStateValue = null;
            for (const item of phaseStateResults) {
                if (isTargetOnu(item.oid)) {
                    phaseStateValue = item.value;
                    result.statusKnown = true;
                    switch (item.value) {
                        case '1':
                            result.status = 'Online';
                            break;
                        case '2':
                            // Sementara set sebagai Offline, akan di-finalize berdasarkan lastDownCause
                            result.status = 'Offline';
                            break;
                        case '3':
                            result.status = 'Sync';
                            break;
                        case '4':
                            result.status = 'Auth Fail';
                            break;
                        case '5':
                        default:
                            result.status = 'Offline';
                            break;
                    }
                    console.log(`[OLT] Found phaseState for ${targetKey}: ${item.value}`);
                    break;
                }
            }

            // Process Last Down Cause
            for (const item of lastDownCauseResults) {
                if (isTargetOnu(item.oid)) {
                    result.lastDownCause = item.value;
                    console.log(`[OLT] Found lastDownCause for ${targetKey}: ${item.value}`);
                    break;
                }
            }
            
            // Finalize status berdasarkan phaseState
            // CATATAN: OLT HIOSO tidak membedakan LOS vs Dying Gasp melalui SNMP
            // Kedua kondisi menghasilkan phaseState=2 dan lastDownCause=1
            // Jadi kita gunakan status generik "LOS" untuk semua kondisi offline
            if (phaseStateValue === '2') {
                // ONT offline - tidak bisa membedakan LOS vs Dying Gasp
                result.isDyingGasp = false;
                result.isLos = true;
                result.status = 'LOS';
                console.log(`[OLT] ${targetKey}: LOS/Offline (phaseState=2)`);
            }

            console.log(`[OLT] Final result for ${targetKey}:`, result);

            resolve({
                status: 'success',
                timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                data: result
            });

        } catch (error) {
            closeSession();
            console.error(`[OLT] Error in getSingleOnuData:`, error);
            resolve({
                status: 'error',
                message: error.message,
                data: null
            });
        }
    });

    try {
        return await Promise.race([dataPromise, timeoutPromise]);
    } catch (error) {
        // `session.isClosed` tidak ada di net-snmp (selalu undefined), jadi penjaga lama tak pernah
        // menjaga apa pun. Tutup langsung — close ganda sudah ditelan try/catch di dalam.
        try { session.close(); } catch (_e) { /* ignore */ }
        return {
            status: 'error',
            message: error.message,
            data: null
        };
    } finally {
        clearTimeout(deadlineTimer);
    }
}

/**
 * Get data dari multiple OLT secara parallel
 * @param {Array} oltDevices - Array of OLT device configs
 * @returns {Promise<Object>} Merged OLT data
 */
async function getMultipleOltData(oltDevices) {
    if (!Array.isArray(oltDevices) || oltDevices.length === 0) {
        return {
            status: 'error',
            message: 'No OLT devices configured',
            onus: [],
            systemInfo: {},
            oltResults: []
        };
    }
    
    console.log(`[OLT] Querying ${oltDevices.length} OLT device(s) in parallel...`);
    
    // Query semua OLT secara parallel
    const promises = oltDevices.map(async (olt) => {
        try {
            const config = {
                host: olt.host,
                port: olt.snmpPort || 161,
                community: olt.snmpCommunity || 'public',
                timeout: olt.snmpTimeout || 15000,
                retries: olt.snmpRetries || 2
            };

            // Dispatch per-merk: device.brand → driver. Default (auto) = HIOSO.
            const driver = require('./olt-drivers').resolveDriver(olt);
            const result = await driver.getOltData(config);
            
            // Add OLT info to each ONU
            if (result.status === 'success' && result.onus) {
                result.onus.forEach(onu => {
                    onu.olt_id = olt.id;
                    onu.olt_name = olt.name;
                    onu.olt_host = olt.host;
                    onu.olt_brand = olt.brand || 'auto';
                });
            }
            
            return {
                oltId: olt.id,
                oltName: olt.name,
                oltHost: olt.host,
                status: result.status,
                message: result.message,
                onus: result.onus || [],
                systemInfo: result.systemInfo || {},
                incompleteWalks: result.incompleteWalks || [],
                failedWalks: result.failedWalks || []
            };
        } catch (error) {
            console.error(`[OLT] Error querying ${olt.name}:`, error.message);
            return {
                oltId: olt.id,
                oltName: olt.name,
                oltHost: olt.host,
                status: 'error',
                message: error.message,
                onus: [],
                systemInfo: {},
                // Ikut dibawa walau kosong: bentuk hasil harus sama di semua jalan keluar, supaya
                // `[]` selalu berarti "tak ada yang gagal" dan tak pernah "tak ada yang bercerita".
                incompleteWalks: [],
                failedWalks: []
            };
        }
    });
    
    const results = await Promise.all(promises);
    
    // Merge semua ONUs dari semua OLT
    const allOnus = [];
    results.forEach(result => {
        if (result.status === 'success' && result.onus.length > 0) {
            allOnus.push(...result.onus);
            console.log(`[OLT] [${result.oltName}] Got ${result.onus.length} ONUs`);
        } else if (result.status === 'error') {
            console.error(`[OLT] [${result.oltName}] Error: ${result.message}`);
        }
    });
    
    console.log(`[OLT] Total ONUs from all OLTs: ${allOnus.length}`);

    // OLT yang TIDAK TERBACA ronde ini. Ini kunci kejujuran di tingkat armada: snapshot gabungan
    // wajib menyatakan matanya yang buta sebelah, karena pemanggil TIDAK BISA menyimpulkannya dari
    // `onus` — ONU pelanggan yang OLT-nya bisu tampak persis sama dengan ONU yang benar-benar
    // hilang dari OLT yang sehat. Tanpa daftar ini, satu OLT mati di antara OLT hidup membuat
    // seluruh pelanggannya divonis "Offline" (insiden Dander 192.168.11.2, 53 dari 58 pelanggan).
    const failedOlts = results
        .filter((result) => result.status === 'error')
        .map((result) => ({
            oltId: result.oltId,
            oltName: result.oltName,
            oltHost: result.oltHost,
            message: result.message
        }));

    // Merk/OLT yang walk-nya tak lengkap / gagal — dipakai UI untuk menandai data setengah jadi.
    const perOltWalks = (field) => results
        .filter((result) => Array.isArray(result[field]) && result[field].length > 0)
        .map((result) => ({ oltId: result.oltId, oltName: result.oltName, walks: result[field] }));

    // SEMUA OLT gagal ≠ "semua ONU hilang". Dulu fungsi ini selalu balas `success` dengan daftar
    // ONU kosong, sehingga pemanggil menyimpulkan setiap pelanggan tidak ditemukan di OLT alias
    // offline — kegagalan alat baca disajikan sebagai vonis tentang jaringan pelanggan.
    const allFailed = results.length > 0 && results.every((result) => result.status === 'error');
    if (allFailed) {
        return {
            status: 'error',
            message: `Semua OLT gagal dibaca (${results.map((r) => r.oltName || r.oltHost).join(', ')})`,
            timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
            fetchedAt: new Date().toISOString(),
            onus: [],
            systemInfo: {},
            incompleteWalks: perOltWalks('incompleteWalks'),
            failedWalks: perOltWalks('failedWalks'),
            failedOlts,
            oltResults: results
        };
    }

    if (failedOlts.length > 0) {
        console.warn(`[OLT] Snapshot SEBAGIAN: ${failedOlts.length} dari ${results.length} OLT tidak terbaca`
            + ` (${failedOlts.map((f) => f.oltName || f.oltHost).join(', ')}) — pelanggan di baliknya TIDAK boleh dibaca sebagai offline.`);
    }

    return {
        status: 'success',
        timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        // Stempel yang bisa dihitung umurnya oleh pemanggil (yang di atas untuk mata manusia).
        fetchedAt: new Date().toISOString(),
        onus: allOnus,
        systemInfo: {},
        incompleteWalks: perOltWalks('incompleteWalks'),
        failedWalks: perOltWalks('failedWalks'),
        // Sengaja tetap `success`: data OLT yang hidup tetap berguna dan tak boleh ikut dibuang.
        // Yang berubah, snapshot ini kini JUJUR soal cakupannya — lihat `failedOlts`.
        failedOlts,
        oltResults: results // Detail per OLT
    };
}

/**
 * Get single ONU data dengan cache strategy
 * Cek cache dulu untuk tahu ONU ada di OLT mana, baru query specific OLT
 * Fallback ke query all OLT jika cache miss
 * 
 * @param {string} mac - MAC address ONT (untuk lookup cache)
 * @param {string|number} slotId - Slot ID dari ONT
 * @param {string|number} onuId - ONU ID dari ONT
 * @returns {Promise<Object>} Single ONU data
 */
async function getSingleOnuDataWithCache(mac, slotId, onuId) {
    const oltManager = require('./olt-manager');
    const { resolveDriver } = require('./olt-drivers');

    // Normalize MAC
    const normalizedMac = normalizeMAC(mac);
    
    // Cek cache untuk tahu ONU ada di OLT mana
    const cachedOlt = oltManager.getOltFromMac(normalizedMac);
    
    if (cachedOlt) {
        // Cache hit - query specific OLT
        console.log(`[OLT] Cache hit for MAC ${normalizedMac}: ${cachedOlt.oltName}`);
        
        const oltDevice = oltManager.getOltDevice(cachedOlt.oltId);
        if (oltDevice) {
            const config = {
                host: oltDevice.host,
                port: oltDevice.snmpPort || 161,
                community: oltDevice.snmpCommunity || 'public',
                timeout: oltDevice.snmpTimeout || 10000,
                retries: oltDevice.snmpRetries || 1
            };

            const result = await resolveDriver(oltDevice).getSingleOnuData(config, slotId, onuId);

            // `success` saja BELUM cukup. OLT bisa menjawab tanpa menyebut ONU ini sama sekali,
            // dan hasil itu berbentuk `{status:'N/A', isLos:false, rxPower:'N/A'}` — berwajah modem
            // yang tak bermasalah. Jalur fallback di bawah sudah lama menyaring yang serupa; jalur
            // cache-hit — yang justru jalur normal karena cache MAC biasanya panas — dulu tidak.
            const readable = result.status === 'success'
                && result.data
                && result.data.statusKnown !== false;
            if (readable) {
                return result;
            }

            console.log(`[OLT] Cache hit but query failed/unreadable, falling back to query all OLTs`);
        }
    }
    
    // Cache miss atau query failed - query all OLTs
    console.log(`[OLT] Cache miss for MAC ${normalizedMac}, querying all OLTs...`);
    
    const oltDevices = oltManager.getOltDevices();
    
    // Query semua OLT secara parallel
    const promises = oltDevices.map(async (olt) => {
        const config = {
            host: olt.host,
            port: olt.snmpPort || 161,
            community: olt.snmpCommunity || 'public',
            timeout: olt.snmpTimeout || 10000,
            retries: olt.snmpRetries || 1
        };
        
        try {
            const result = await resolveDriver(olt).getSingleOnuData(config, slotId, onuId);
            if (result.status === 'success' && result.data && result.data.rxPower !== 'N/A') {
                // Found! Update cache
                oltManager.updateMacCache(normalizedMac, olt.id, olt.name, olt.host);
                oltManager.saveMacCache();
                
                console.log(`[OLT] Found ONT in ${olt.name}, updating cache`);
                return result;
            }
            return null;
        } catch (error) {
            console.error(`[OLT] Error querying ${olt.name}:`, error.message);
            return null;
        }
    });
    
    const results = await Promise.all(promises);
    
    // Return first successful result
    const successResult = results.find(r => r !== null);
    if (successResult) {
        return successResult;
    }
    
    // Tidak ditemukan di semua OLT
    return {
        status: 'error',
        message: 'Data ONT tidak ditemukan di semua OLT',
        data: null
    };
}

module.exports = {
    getOltData,
    getSingleOnuData,
    getMultipleOltData,
    getSingleOnuDataWithCache,
    snmpDeadlineMs,
    INVENTORY_WALKS,
    matchOltWithCustomers,
    matchMAC,
    normalizeMAC,
    formatMacAddress,
    HIOSO_OID
};
