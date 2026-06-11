/**
 * Header Doc
 * Purpose: Service provisioning ONU untuk OLT ZTE C320/C300 via SSH CLI — scan ONU belum
 *          teregistrasi (uncfg), okupansi ONU ID per port PON, render script registrasi dari
 *          template tipe modem, eksekusi registrasi, hapus ONU, status/optik ONU, dan
 *          capture running-config (bahan backup).
 * Caller: routes/olt-provisioning.js, lib/olt-backup.js.
 * Deps: ./olt-ssh-client (sesi shell + lock per host).
 * MainFuncs: listUncfgOnus, getPonOccupancy, registerOnu, deleteOnu, getOnuStatus,
 *            captureRunningConfig, renderScript, validateVars, __test (parser murni).
 * SideEffects: sesi SSH ke OLT (lewat olt-ssh-client); tidak menulis file/DB.
 *
 * KEAMANAN INJEKSI CLI: semua nilai variabel template WAJIB lolos validateVars —
 * newline ("\n") menyuntik perintah baru dan "?" memicu help inline ZXAN yang merusak
 * sesi; keduanya ditolak keras di sini, bukan hanya di route.
 */

'use strict';

const { runOltCommands, openOltShell, withHostLock, scriptToCommands } = require('./olt-ssh-client');

// ── Aturan validasi variabel template ────────────────────────────────────────
// Identifier ZTE (name/description/pppoe) tidak boleh mengandung spasi — CLI memotong
// argumen pada spasi; karakter non-printable / "?" / newline ditolak di semua field.

const PON_PORT_RE = /^\d{1,2}\/\d{1,2}\/\d{1,2}$/;
const SN_RE = /^[A-Za-z0-9]{8,16}$/;
const TOKEN_RE = /^[\x21-\x3E\x40-\x7E]{1,63}$/;   // printable ASCII tanpa spasi & tanpa '?'
const GENERIC_RE = /^[\x20-\x3E\x40-\x7E]{0,160}$/; // printable ASCII (spasi boleh), tanpa '?'

const VAR_RULES = {
    ponPort: { re: PON_PORT_RE, hint: 'format slot/kartu/port, contoh 1/3/16' },
    onuId: { int: [1, 128], hint: 'angka 1-128' },
    sn: { re: SN_RE, hint: 'serial number 8-16 alfanumerik, contoh ZTEGCCA16805' },
    onuType: { re: TOKEN_RE, hint: 'tipe ONU tanpa spasi, contoh ALL / F660 / F609' },
    name: { re: TOKEN_RE, hint: 'tanpa spasi (pakai tanda hubung), maks 63 karakter' },
    description: { re: TOKEN_RE, hint: 'tanpa spasi (pakai tanda hubung), maks 63 karakter' },
    pppoeUser: { re: TOKEN_RE, hint: 'tanpa spasi, maks 63 karakter' },
    pppoePassword: { re: TOKEN_RE, hint: 'tanpa spasi, maks 63 karakter' },
    pppoeVlan: { int: [1, 4094], hint: 'VLAN 1-4094' },
    hotspotVlan: { int: [1, 4094], hint: 'VLAN 1-4094' },
    tr069Vlan: { int: [1, 4094], hint: 'VLAN 1-4094' },
    extraVlan: { int: [1, 4094], hint: 'VLAN 1-4094' },
};

/**
 * Validasi + normalisasi variabel template. Field dikenal pakai aturan spesifik,
 * field lain (var custom profil) pakai aturan generik anti-injeksi.
 * @param {Record<string, any>} vars
 * @returns {{ok: boolean, errors: string[], values: Record<string, string>}}
 */
function validateVars(vars) {
    const errors = [];
    const values = {};
    for (const [key, rawVal] of Object.entries(vars || {})) {
        if (rawVal === undefined || rawVal === null) continue;
        const val = String(rawVal).trim();
        if (/[\r\n]/.test(val)) { errors.push(`${key}: tidak boleh mengandung baris baru`); continue; }
        if (val.includes('?')) { errors.push(`${key}: karakter '?' tidak diizinkan (memicu help CLI)`); continue; }
        const rule = VAR_RULES[key];
        if (rule && rule.int) {
            const n = parseInt(val, 10);
            if (!/^\d+$/.test(val) || n < rule.int[0] || n > rule.int[1]) {
                errors.push(`${key}: ${rule.hint}`);
                continue;
            }
            values[key] = String(n);
            continue;
        }
        if (rule && rule.re) {
            if (!rule.re.test(val)) { errors.push(`${key}: ${rule.hint}`); continue; }
            values[key] = val;
            continue;
        }
        if (!GENERIC_RE.test(val)) { errors.push(`${key}: karakter tidak diizinkan / terlalu panjang (maks 160)`); continue; }
        if (val) values[key] = val;
    }
    return { ok: errors.length === 0, errors, values };
}

/**
 * Render template script CLI: ganti placeholder {{key}} dengan nilai vars.
 * Placeholder tanpa nilai dilaporkan sebagai missing (eksekusi harus ditolak).
 * Single-pass — nilai yang mengandung "{{" TIDAK di-render ulang (anti injeksi rekursif).
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {{script: string, missing: string[], used: string[]}}
 */
function renderScript(template, vars) {
    const missing = new Set();
    const used = new Set();
    const script = String(template || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, key) => {
        const v = vars ? vars[key] : undefined;
        if (v === undefined || v === null || String(v) === '') { missing.add(key); return m; }
        used.add(key);
        return String(v);
    });
    return { script, missing: [...missing], used: [...used] };
}

/**
 * Daftar placeholder yang dipakai sebuah template (untuk UI form dinamis).
 * @param {string} template
 * @returns {string[]}
 */
function listPlaceholders(template) {
    const found = new Set();
    String(template || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, key) => { found.add(key); return m; });
    return [...found];
}

// ── Parser output CLI (murni, di-unit-test) ──────────────────────────────────

/**
 * Parse `show gpon onu uncfg` → daftar ONU yang terdeteksi tapi belum diregistrasi.
 * Contoh baris: "gpon-onu_1/3/16:8        ZTEGCCA16805        unknown"
 * @param {string} text
 * @returns {Array<{ponPort: string, sn: string, state: string}>}
 */
function parseUncfgOutput(text) {
    const out = [];
    const re = /gpon-onu_(\d{1,2}\/\d{1,2}\/\d{1,2}):\d+\s+([A-Za-z0-9]+)\s+(\S+)/g;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
        out.push({ ponPort: m[1], sn: m[2].toUpperCase(), state: m[3] });
    }
    return out;
}

/**
 * Parse `show running-config interface gpon-olt_x/y/z` → ONU yang sudah terdaftar.
 * Baris: "  onu 8 type ALL sn ZTEGCCA16805"
 * @param {string} text
 * @returns {Array<{onuId: number, type: string, sn: string}>}
 */
function parseOnuOccupancy(text) {
    const out = [];
    const re = /^\s*onu\s+(\d{1,3})\s+type\s+(\S+)\s+sn\s+(\S+)/gm;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
        out.push({ onuId: parseInt(m[1], 10), type: m[2], sn: m[3].toUpperCase() });
    }
    return out;
}

/**
 * Saran ONU ID terendah yang belum terpakai (1..max).
 * @param {number[]} usedIds
 * @param {number} [max=128]
 * @returns {number|null} null bila penuh
 */
function suggestOnuId(usedIds, max = 128) {
    const used = new Set((usedIds || []).map((n) => parseInt(n, 10)));
    for (let i = 1; i <= max; i++) {
        if (!used.has(i)) return i;
    }
    return null;
}

/**
 * Parse `show gpon onu detail-info gpon-onu_x/y/z:N` → field kunci status ONU.
 * Output ZXAN berbentuk "Label:   value" per baris.
 * @param {string} text
 * @returns {{name, type, state, configState, phaseState, serial, onlineDuration, distance}|null}
 */
function parseOnuDetail(text) {
    const src = String(text || '');
    if (!src.trim()) return null;
    const pick = (label) => {
        const re = new RegExp('^\\s*' + label + '\\s*:\\s*(.+)$', 'im');
        const m = src.match(re);
        return m ? m[1].trim() : null;
    };
    const detail = {
        name: pick('Name'),
        type: pick('Type'),
        state: pick('State'),
        configState: pick('Configuration state'),
        phaseState: pick('Phase state'),
        serial: pick('Serial number'),
        onlineDuration: pick('Online Duration'),
        distance: pick('ONU Distance'),
    };
    const hasAny = Object.values(detail).some((v) => v !== null);
    return hasAny ? detail : null;
}

/**
 * Parse `show pon power attenuation gpon-onu_x/y/z:N`.
 * Contoh:
 *   up    Rx :-14.500(dbm)   Tx : 2.491(dbm)    16.991(db)
 *   down  Tx : 6.770(dbm)    Rx :-17.962(dbm)   24.732(db)
 * @param {string} text
 * @returns {{up: {oltRx, onuTx, attenuation}, down: {oltTx, onuRx, attenuation}}|null}
 */
function parsePonPower(text) {
    const src = String(text || '');
    const num = '(-?\\d+(?:\\.\\d+)?)';
    const upM = src.match(new RegExp('up\\s+Rx\\s*:\\s*' + num + '\\(dbm\\)\\s+Tx\\s*:\\s*' + num + '\\(dbm\\)\\s+' + num + '\\(db\\)', 'i'));
    const downM = src.match(new RegExp('down\\s+Tx\\s*:\\s*' + num + '\\(dbm\\)\\s+Rx\\s*:\\s*' + num + '\\(dbm\\)\\s+' + num + '\\(db\\)', 'i'));
    if (!upM && !downM) return null;
    return {
        up: upM ? { oltRx: parseFloat(upM[1]), onuTx: parseFloat(upM[2]), attenuation: parseFloat(upM[3]) } : null,
        down: downM ? { oltTx: parseFloat(downM[1]), onuRx: parseFloat(downM[2]), attenuation: parseFloat(downM[3]) } : null,
    };
}

// ── Operasi OLT (SSH) ────────────────────────────────────────────────────────

/**
 * Scan ONU yang terdeteksi di OLT tapi belum diregistrasi.
 * @param {object} device
 * @returns {Promise<{onus: Array, raw: string}>}
 */
async function listUncfgOnus(device) {
    const res = await runOltCommands(device, ['show gpon onu uncfg'], { checkErrors: false });
    const raw = res.results.length ? res.results[0].output : '';
    return { onus: parseUncfgOutput(raw), raw };
}

/**
 * Okupansi ONU ID pada satu port PON + saran ID kosong terendah.
 * @param {object} device
 * @param {string} ponPort "1/3/16"
 * @returns {Promise<{used: Array, usedIds: number[], suggestedId: number|null, raw: string}>}
 */
async function getPonOccupancy(device, ponPort) {
    if (!PON_PORT_RE.test(String(ponPort || ''))) throw new Error('Format port PON tidak valid (contoh: 1/3/16)');
    const res = await runOltCommands(device, [`show running-config interface gpon-olt_${ponPort}`], { checkErrors: false, commandTimeoutMs: 30000 });
    const raw = res.results.length ? res.results[0].output : '';
    const used = parseOnuOccupancy(raw);
    const usedIds = used.map((u) => u.onuId);
    return { used, usedIds, suggestedId: suggestOnuId(usedIds), raw };
}

/**
 * Registrasi ONU: render template profil tipe modem lalu eksekusi via SSH.
 * Eksekusi berhenti di perintah pertama yang error; hasil per-perintah dikembalikan
 * supaya UI bisa menunjukkan persis baris mana yang gagal.
 *
 * @param {object} device
 * @param {string} template  scriptTemplate dari profil tipe modem
 * @param {Record<string, any>} vars  sudah termasuk ponPort/onuId/sn/name/dst.
 * @returns {Promise<{ok, script, commands, results, failedIndex}>}
 */
async function registerOnu(device, template, vars) {
    const v = validateVars(vars);
    if (!v.ok) {
        const err = new Error('Variabel registrasi tidak valid: ' + v.errors.join('; '));
        err.validationErrors = v.errors;
        throw err;
    }
    const { script, missing } = renderScript(template, v.values);
    if (missing.length) {
        const err = new Error('Placeholder template belum terisi: ' + missing.join(', '));
        err.missingVars = missing;
        throw err;
    }
    const commands = scriptToCommands(script);
    if (!commands.length) throw new Error('Script registrasi kosong');
    const exec = await runOltCommands(device, commands, { commandTimeoutMs: 25000 });
    return { ok: exec.ok, script, commands, results: exec.results, failedIndex: exec.failedIndex };
}

/**
 * Hapus registrasi ONU (`no onu N` pada interface gpon-olt). Dipakai untuk rollback
 * registrasi gagal ataupun pencabutan pelanggan.
 * @param {object} device
 * @param {string} ponPort
 * @param {number|string} onuId
 * @returns {Promise<{ok, results, failedIndex}>}
 */
async function deleteOnu(device, ponPort, onuId) {
    if (!PON_PORT_RE.test(String(ponPort || ''))) throw new Error('Format port PON tidak valid (contoh: 1/3/16)');
    const id = parseInt(onuId, 10);
    if (!Number.isInteger(id) || id < 1 || id > 128) throw new Error('ONU ID harus 1-128');
    const commands = ['conf t', `int gpon-olt_${ponPort}`, `no onu ${id}`, 'end'];
    // Sebagian firmware minta konfirmasi yes/no saat hapus ONU → autoConfirm.
    const exec = await runOltCommands(device, commands, { autoConfirm: true, commandTimeoutMs: 25000 });
    return { ok: exec.ok, results: exec.results, failedIndex: exec.failedIndex };
}

/**
 * Status ONU pasca-registrasi: detail-info + optik (redaman) dalam satu sesi.
 * @param {object} device
 * @param {string} ponPort
 * @param {number|string} onuId
 * @returns {Promise<{detail, power, rawDetail, rawPower}>}
 */
async function getOnuStatus(device, ponPort, onuId) {
    if (!PON_PORT_RE.test(String(ponPort || ''))) throw new Error('Format port PON tidak valid (contoh: 1/3/16)');
    const id = parseInt(onuId, 10);
    if (!Number.isInteger(id) || id < 1 || id > 128) throw new Error('ONU ID harus 1-128');
    const target = `gpon-onu_${ponPort}:${id}`;
    const res = await runOltCommands(device, [
        `show gpon onu detail-info ${target}`,
        `show pon power attenuation ${target}`,
    ], { checkErrors: false, stopOnError: false, commandTimeoutMs: 25000 });
    const rawDetail = res.results[0] ? res.results[0].output : '';
    const rawPower = res.results[1] ? res.results[1].output : '';
    return {
        detail: parseOnuDetail(rawDetail),
        power: parsePonPower(rawPower),
        rawDetail,
        rawPower,
    };
}

/**
 * Capture seluruh running-config OLT (bahan backup). Output bisa ribuan baris —
 * timeout per perintah dinaikkan.
 * @param {object} device
 * @param {object} [opts] {timeoutMs}
 * @returns {Promise<string>} teks konfigurasi
 */
async function captureRunningConfig(device, opts = {}) {
    return withHostLock(device && device.host, async () => {
        const session = await openOltShell(device, { commandTimeoutMs: opts.timeoutMs || 180000 });
        try {
            const out = await session.exec('show running-config', { timeoutMs: opts.timeoutMs || 180000 });
            if (!out || out.trim().length < 50) {
                throw new Error('Output running-config kosong/terlalu pendek — kemungkinan perintah gagal');
            }
            return out;
        } finally {
            session.close();
        }
    });
}

/**
 * Test koneksi SSH: connect + deteksi prompt (tanpa menjalankan perintah konfigurasi).
 * @param {object} device
 * @returns {Promise<{ok: boolean, prompt?: string, message: string}>}
 */
async function testSshConnection(device) {
    try {
        const result = await withHostLock(device && device.host, async () => {
            const session = await openOltShell(device);
            const prompt = session.prompt;
            session.close();
            return prompt;
        });
        return { ok: true, prompt: result, message: `Terhubung. Prompt: ${result}` };
    } catch (e) {
        return { ok: false, message: e.message };
    }
}

module.exports = {
    listUncfgOnus,
    getPonOccupancy,
    registerOnu,
    deleteOnu,
    getOnuStatus,
    captureRunningConfig,
    testSshConnection,
    renderScript,
    validateVars,
    listPlaceholders,
    suggestOnuId,
    __test: {
        parseUncfgOutput,
        parseOnuOccupancy,
        parseOnuDetail,
        parsePonPower,
        suggestOnuId,
        renderScript,
        validateVars,
        listPlaceholders,
        PON_PORT_RE,
        SN_RE,
    },
};
