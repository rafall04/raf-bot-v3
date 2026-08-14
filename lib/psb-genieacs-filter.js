/**
 * Header Doc
 * Purpose: Normalisasi + filter murni (tanpa I/O) device GenieACS untuk alur PSB — bentuk kandidat
 *          modem ({deviceId, serialNumber, currentPPPUsername, registered/lastInform/lastBootstrap}),
 *          filter default/new/by-sn/by-pppoe, dan PENCARIAN SADAR-BENTUK-STIKER: SN Huawei tercetak
 *          di stiker sebagai `HWTC…` sedangkan ACS menyimpan 16-heksa (`48575443…` = ASCII "HWTC"),
 *          jadi pencocokan mengkonversi DUA ARAH — insiden Dander 2026-08-07: teknisi mengetik SN
 *          lengkap dari stiker dan modem bekas "tidak terdeteksi".
 * Caller: `lib/psb-genieacs-service.js` (wizard PSB DM + API), `routes/api-psb-routes.js` via service.
 * Deps: `lib/genieacs.extractPppoeUsername` (path PPPoE per-vendor).
 * MainFuncs: `normalizeGenieAcsPsbDevice`, `filterNormalizedPsbDevices`, `psbCandidateMatchesHint`,
 *            `snSearchVariants`, `getRegisteredInfo`, `isDefaultPppoeUsername`, `summarizePsbDevices`,
 *            `getMaxPppUptimeSeconds` (bukti "sesi PPPoE modem ini hidup" — dipakai gerbang
 *            LINTAS-AREA di `lib/psb-modem-provenance.js`; terekspos sbg `pppUptimeSeconds`).
 * SideEffects: tidak ada (murni).
 */
const { extractPppoeUsername, extractPppoeUsernames } = require('./genieacs');

function unwrapParameterValue(value) {
    if (value && typeof value === 'object' && value._value !== undefined) {
        return value._value;
    }

    if (value && typeof value === 'object' && value.value !== undefined) {
        return value.value;
    }

    return value;
}

function normalizeStringValue(value) {
    const unwrapped = unwrapParameterValue(value);
    if (typeof unwrapped !== 'string') {
        return null;
    }

    const trimmed = unwrapped.trim();
    return trimmed || null;
}

function getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
        if (!current || typeof current !== 'object') {
            return undefined;
        }

        if (Object.prototype.hasOwnProperty.call(current, part)) {
            current = current[part];
            continue;
        }

        const lowerPart = part.toLowerCase();
        const foundKey = Object.keys(current).find((key) => key.toLowerCase() === lowerPart);
        if (!foundKey) {
            return undefined;
        }

        current = current[foundKey];
    }

    return current;
}

function getCurrentPppoeUsername(device) {
    return normalizeStringValue(extractPppoeUsername(device));
}

// SEMUA username PPPoE di device (path config + pemindaian lintas-index dari lib/genieacs).
// Modem dengan WAN TR-069 terpisah bisa punya >1 WANPPPConnection; pencarian & deteksi modem
// polos wajib melihat semuanya, bukan hanya index 1 (insiden Dander 2026-08-07: by-PPPoE buta).
function getAllPppoeUsernames(device) {
    if (typeof extractPppoeUsernames === 'function') {
        const all = extractPppoeUsernames(device) || [];
        return [...new Set(all.map((value) => normalizeStringValue(value)).filter(Boolean))];
    }
    const single = getCurrentPppoeUsername(device);
    return single ? [single] : [];
}

function isDefaultPppoeUsername(username) {
    return !!username && username.trim().toLowerCase() === 'tes@hw';
}

// ── Bukti "modem ini sedang memegang sesi PPPoE" ───────────────────────────────────────────────
// GenieACS dipakai BERSAMA oleh dua bot area, tapi daftar pelanggan & sesi router yang dipakai
// menilai kandidat hanya milik area sendiri. Terukur di ACS Dander 2026-08-14: dari 160 device,
// 97 adalah modem pelanggan HIDUP di Tanjungharjo dan gerbang Dander meloloskan SEMUANYA sebagai
// "♻️ BEKAS — boleh dipakai". Realm tak bisa membedakan (kedua area memakai @rafcybernet), dan
// `ConnectionStatus` hanya terbaca di ~68% device.
// Yang terbaca di 160/160 device adalah `Uptime` milik WANPPPConnection — dan semuanya > 0.
// Uptime > 0 berarti sesi PPPoE modem ini BERHASIL terbentuk di suatu router, apa pun areanya:
// bukti lintas-area yang berasal dari sumber yang sama-sama dilihat kedua bot.
// Mengembalikan `null` bila TAK TERBACA — "tidak tahu" harus bisa dibedakan dari "tidak ada sesi".
function unwrapAcsValue(node) {
    if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, '_value')) return node._value;
    return undefined;
}

function getMaxPppUptimeSeconds(device) {
    let maks = null;
    const telusuriWpc = (wpc) => {
        if (!wpc || typeof wpc !== 'object') return;
        for (const idx of Object.keys(wpc)) {
            if (!/^\d+$/.test(idx)) continue;
            const nilai = Number(unwrapAcsValue((wpc[idx] || {}).Uptime));
            if (Number.isFinite(nilai) && (maks === null || nilai > maks)) maks = nilai;
        }
    };
    const wanDevice = ((device || {}).InternetGatewayDevice || {}).WANDevice || {};
    for (const i of Object.keys(wanDevice)) {
        if (!/^\d+$/.test(i)) continue;
        const wcd = (wanDevice[i] || {}).WANConnectionDevice || {};
        for (const j of Object.keys(wcd)) {
            if (!/^\d+$/.test(j)) continue;
            telusuriWpc((wcd[j] || {}).WANPPPConnection);
        }
    }
    // Modem ber-datamodel TR-181 menaruhnya di `Device.PPP.Interface.{i}.Uptime`.
    const ppp = (((device || {}).Device || {}).PPP || {}).Interface || {};
    for (const k of Object.keys(ppp)) {
        if (!/^\d+$/.test(k)) continue;
        const nilai = Number(unwrapAcsValue((ppp[k] || {}).Uptime));
        if (Number.isFinite(nilai) && (maks === null || nilai > maks)) maks = nilai;
    }
    return maks;
}

// ── Pencocokan SN sadar-bentuk-stiker ──────────────────────────────────────────
// Stiker modem Huawei mencetak `HWTC49B734AD` (4 huruf vendor + 8 heksa); TR-069 melaporkan SN yang
// sama sebagai 16-heksa penuh (`4857544349B734AD`, 8 heksa pertama = ASCII huruf vendor). Teknisi
// mengetik apa yang dia BACA di stiker, jadi pencarian wajib mengkonversi dua arah — substring mentah
// saja membuat "SN lengkap dari stiker" tak pernah ketemu (insiden Dander 2026-08-07).

// Pembersih input/nilai SN: buang pemisah yang lazim diketik/di-print (spasi, titik dua, garis).
function stripSnSeparators(value) {
    return String(value === null || value === undefined ? '' : value).trim().replace(/[\s:._\-]/g, '');
}

// `HWTC49B7…` → `4857544349b7…` (huruf vendor → heksa ASCII). null bila bukan pola stiker.
// Sisa setelah 4 huruf boleh PARSIAL (teknisi kadang mengetik potongan awal stiker).
// PENTING: ASCII dihitung dari huruf KAPITAL. Diukur di ACS produksi Dander 2026-08-08 — 156/156
// modem Huawei menyimpan prefix `48575443` = ASCII "HWTC" kapital. Memakai huruf kecil menghasilkan
// `68777463` (ASCII "hwtc") yang tak cocok dengan device mana pun — bug senyap: pencarian masih
// "jalan" lewat arah sebaliknya (heksa device → bentuk stiker), jadi kesalahan ini tak terlihat
// dari hasil akhir, tapi ia menyuntikkan varian sampah ke dalam pencocokan.
function stickerHintToHex(value) {
    const v = stripSnSeparators(value).toLowerCase();
    const m = v.match(/^([a-z]{4})([0-9a-f]*)$/);
    if (!m) return null;
    let hex = '';
    for (const ch of m[1].toUpperCase()) {
        hex += ch.charCodeAt(0).toString(16).padStart(2, '0');
    }
    return hex + m[2];
}

// `4857544349b734ad` → `hwtc49b734ad` bila 8 heksa pertama ter-decode jadi 4 huruf. null selain itu.
function hexToStickerForm(value) {
    const v = stripSnSeparators(value).toLowerCase();
    if (!/^[0-9a-f]{8,}$/.test(v)) return null;
    let vendor = '';
    for (let i = 0; i < 8; i += 2) {
        vendor += String.fromCharCode(parseInt(v.slice(i, i + 2), 16));
    }
    if (!/^[a-z]{4}$/i.test(vendor)) return null;
    return `${vendor.toLowerCase()}${v.slice(8)}`;
}

// Semua bentuk sepadan dari satu nilai SN/hint (lowercase): mentah, tanpa-pemisah, konversi
// stiker→heksa, dan konversi heksa→stiker. Dipakai simetris di sisi hint DAN sisi device.
function snSearchVariants(value) {
    const raw = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
    if (!raw) return [];
    const variants = new Set([raw]);
    const stripped = stripSnSeparators(raw);
    if (stripped) variants.add(stripped);
    const asHex = stickerHintToHex(stripped);
    if (asHex) variants.add(asHex);
    const asSticker = hexToStickerForm(stripped);
    if (asSticker) variants.add(asSticker);
    return [...variants];
}

// True bila salah satu varian hint menjadi substring salah satu varian haystack.
function variantIncludes(haystackVariants, needleVariants) {
    return needleVariants.some((needle) => haystackVariants.some((hay) => hay.includes(needle)));
}

// Cocokkan SN device (bentuk apa pun yang dilaporkan ACS) dengan filter/hint dari manusia.
function serialMatchesFilter(serialNumber, filter) {
    const needles = snSearchVariants(filter);
    if (!needles.length) return false;
    return variantIncludes(snSearchVariants(serialNumber), needles);
}

// Pencocokan kandidat utk perintah `cari <kata>` wizard PSB: SN (sadar-stiker), device id, dan
// username PPPoE yang sedang tertulis di modem (kunci modem copotan — nama pemilik lama).
function psbCandidateMatchesHint(device, hint) {
    const needles = snSearchVariants(hint);
    if (!needles.length || !device) return false;
    const pppoeValues = Array.isArray(device.allPPPUsernames) && device.allPPPUsernames.length
        ? device.allPPPUsernames
        : [device.currentPPPUsername];
    const haystacks = [
        ...snSearchVariants(device.serialNumber),
        ...snSearchVariants(device.deviceId),
        ...pppoeValues.flatMap((username) => snSearchVariants(username)),
    ];
    return variantIncludes(haystacks, needles);
}

function parseGenieacsTimestamp(value) {
    const rawValue = unwrapParameterValue(value);

    if (rawValue === null || rawValue === undefined || rawValue === '') {
        return null;
    }

    if (rawValue instanceof Date) {
        const time = rawValue.getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof rawValue === 'number') {
        if (!Number.isFinite(rawValue) || rawValue <= 0) {
            return null;
        }
        return rawValue > 1000000000000 ? rawValue : rawValue * 1000;
    }

    if (typeof rawValue === 'string') {
        const parsed = Date.parse(rawValue);
        return Number.isFinite(parsed) ? parsed : null;
    }

    const parsed = Date.parse(String(rawValue));
    return Number.isFinite(parsed) ? parsed : null;
}

function getRegisteredInfo(device, options = {}) {
    const { allowLastInformFallback = false } = options;

    // Sumber utama = field root `_registered` GenieACS (waktu registrasi PERTAMA; terisi & queryable
    // di lapangan — verified live ACS). `Events.Registered` sering KOSONG pada ONU Huawei/ZTE, jadi
    // hanya dipakai sebagai fallback. Inilah akar bug "modem baru tidak terdeteksi" pada filter `new`.
    let registeredTimestamp = parseGenieacsTimestamp(device && device._registered);
    let registrationSource = registeredTimestamp ? 'registered_root' : null;

    if (!registeredTimestamp) {
        const registeredCandidate =
            getNestedValue(device, 'Events.Registered')
            ?? device['Events.Registered']
            ?? undefined;
        registeredTimestamp = parseGenieacsTimestamp(registeredCandidate);
        if (registeredTimestamp) {
            registrationSource = 'events_registered';
        }
    }

    if (!registeredTimestamp && allowLastInformFallback) {
        registeredTimestamp = parseGenieacsTimestamp(device._lastInform);
        if (registeredTimestamp) {
            registrationSource = 'last_inform';
        }
    }

    return {
        registeredTimestamp: registeredTimestamp || null,
        registeredDate: registeredTimestamp ? new Date(registeredTimestamp).toISOString() : null,
        registrationSource,
    };
}

function pickFirstString(...values) {
    for (const value of values) {
        const normalized = normalizeStringValue(value);
        if (normalized) {
            return normalized;
        }
    }
    return null;
}

function getDeviceSerialNumber(device, extractParameterValue) {
    return pickFirstString(
        getNestedValue(device, 'Device.DeviceInfo.SerialNumber'),
        getNestedValue(device, 'InternetGatewayDevice.DeviceInfo.SerialNumber'),
        typeof extractParameterValue === 'function' ? extractParameterValue(device, 'serialNumber') : null,
        getNestedValue(device, 'VirtualParameters.getSerialNumber'),
        getNestedValue(device, 'VirtualParameters.serialNumber'),
        device._serialNumber
    );
}

function normalizeGenieAcsPsbDevice(device, extractParameterValue, options = {}) {
    const currentPPPUsername = getCurrentPppoeUsername(device);
    const allPPPUsernames = getAllPppoeUsernames(device);
    const serialNumber = getDeviceSerialNumber(device, extractParameterValue);
    const model = pickFirstString(
        getNestedValue(device, 'Device.DeviceInfo.ModelName'),
        getNestedValue(device, 'InternetGatewayDevice.DeviceInfo.ModelName'),
        getNestedValue(device, 'Device.DeviceInfo.ProductClass'),
        getNestedValue(device, 'InternetGatewayDevice.DeviceInfo.ProductClass')
    );
    const manufacturer = pickFirstString(
        getNestedValue(device, 'Device.DeviceInfo.Manufacturer'),
        getNestedValue(device, 'InternetGatewayDevice.DeviceInfo.Manufacturer')
    );
    const registeredInfo = getRegisteredInfo(device, options);
    const lastInformTimestamp = parseGenieacsTimestamp(device._lastInform);
    // `_lastBootstrap` = kapan device terakhir kirim "0 BOOTSTRAP" (kontak pertama ATAU factory
    // reset). Untuk modem BEKAS yang di-reset teknisi, inilah satu-satunya stempel waktu yang
    // ikut segar — `_registered` tetap kuno karena record ACS-nya tidak pernah dihapus.
    const lastBootstrapTimestamp = parseGenieacsTimestamp(device && device._lastBootstrap);

    return {
        deviceId: device && device._id ? String(device._id) : null,
        serialNumber: serialNumber || 'N/A',
        model: model || 'N/A',
        manufacturer: manufacturer || 'N/A',
        currentPPPUsername,
        allPPPUsernames,
        // Detik. > 0 = sesi PPPoE modem ini SEDANG hidup di suatu router (area mana pun).
        // `null` = tak terbaca → jangan diperlakukan sebagai "tidak ada sesi".
        pppUptimeSeconds: getMaxPppUptimeSeconds(device),
        lastInform: lastInformTimestamp ? new Date(lastInformTimestamp).toISOString() : null,
        lastBootstrap: lastBootstrapTimestamp ? new Date(lastBootstrapTimestamp).toISOString() : null,
        lastBootstrapTimestamp: lastBootstrapTimestamp || null,
        registeredDate: registeredInfo.registeredDate,
        registeredTimestamp: registeredInfo.registeredTimestamp,
        registrationSource: registeredInfo.registrationSource,
    };
}

function filterNormalizedPsbDevices(devices, options = {}) {
    const {
        filterType = 'default',
        serialNumberFilter = null,
        pppoeUsernameFilter = null,
        now = Date.now(),
        newWindowMs = 86700000,
    } = options;

    const normalizedSerialFilter = typeof serialNumberFilter === 'string' && serialNumberFilter.trim()
        ? serialNumberFilter.trim().toLowerCase()
        : null;
    const normalizedPppoeFilter = typeof pppoeUsernameFilter === 'string' && pppoeUsernameFilter.trim()
        ? pppoeUsernameFilter.trim().toLowerCase()
        : null;

    let filtered = Array.isArray(devices) ? [...devices] : [];

    // PPPoE dibandingkan ke SEMUA username yang terbaca (lintas-index), bukan hanya index 1 —
    // modem dgn WAN TR-069 terpisah menaruh PPPoE pelanggan di WANConnectionDevice lain.
    const devicePppoeValues = (device) => {
        if (Array.isArray(device.allPPPUsernames) && device.allPPPUsernames.length) {
            return device.allPPPUsernames;
        }
        return typeof device.currentPPPUsername === 'string' && device.currentPPPUsername
            ? [device.currentPPPUsername]
            : [];
    };

    if (filterType === 'default') {
        filtered = filtered.filter((device) => devicePppoeValues(device).some(isDefaultPppoeUsername));
    } else if (filterType === 'new') {
        const threshold = now - newWindowMs;
        filtered = filtered.filter((device) =>
            typeof device.registeredTimestamp === 'number'
            && device.registeredTimestamp > threshold
        );
    } else if (filterType === 'by-pppoe' && normalizedPppoeFilter) {
        filtered = filtered.filter((device) =>
            devicePppoeValues(device).some((username) => username.toLowerCase().includes(normalizedPppoeFilter))
        );
    }

    if (normalizedSerialFilter) {
        // Sadar-bentuk-stiker: filter `HWTC…` harus menemukan device yang ACS-nya menyimpan 16-heksa
        // (dan sebaliknya) — jangan pernah kembali ke substring mentah satu-arah.
        filtered = filtered.filter((device) => serialMatchesFilter(device.serialNumber, normalizedSerialFilter));
    }

    return filtered;
}

function summarizePsbDevices(devices) {
    const normalizedDevices = Array.isArray(devices) ? devices : [];
    return {
        total: normalizedDevices.length,
        withoutPppoeUsername: normalizedDevices.filter((device) => !device.currentPPPUsername).length,
        withoutRegisteredDate: normalizedDevices.filter((device) => !device.registeredTimestamp).length,
    };
}

module.exports = {
    getCurrentPppoeUsername,
    getAllPppoeUsernames,
    getMaxPppUptimeSeconds,
    isDefaultPppoeUsername,
    parseGenieacsTimestamp,
    getRegisteredInfo,
    getDeviceSerialNumber,
    normalizeGenieAcsPsbDevice,
    filterNormalizedPsbDevices,
    summarizePsbDevices,
    stripSnSeparators,
    stickerHintToHex,
    hexToStickerForm,
    snSearchVariants,
    serialMatchesFilter,
    psbCandidateMatchesHint,
};
