/**
 * Header Doc
 * Purpose: Service provisioning ONU untuk OLT ZTE C320/C300 via SSH CLI — scan ONU belum
 *          teregistrasi (uncfg), okupansi ONU ID per port PON, render script registrasi dari
 *          template tipe modem, eksekusi registrasi, hapus ONU, status/optik ONU, dan
 *          capture running-config (bahan backup).
 * Caller: routes/olt-provisioning.js, lib/olt-backup.js.
 * Deps: ./olt-ssh-client (sesi shell + lock per host).
 * MainFuncs: listUncfgOnus, getPonOccupancy, registerOnu, deleteOnu, getOnuStatus,
 *            getOltFacts (port PON/tipe ONU/profil/VLAN utk dropdown), getOnuFullConfig,
 *            persistConfig (write), captureRunningConfig, renderScript, validateVars,
 *            classifyVendorTier, applyTr069Addon, removeTr069Addon (retrofit ACS/TR069).
 * SideEffects: sesi SSH ke OLT (lewat olt-ssh-client); tidak menulis file/DB.
 *
 * KEAMANAN INJEKSI CLI: semua nilai variabel template WAJIB lolos validateVars —
 * newline ("\n") menyuntik perintah baru dan "?" memicu help inline ZXAN yang merusak
 * sesi; keduanya ditolak keras di sini, bukan hanya di route.
 */

'use strict';

const { runOltCommands, openOltShell, withHostLock, scriptToCommands, detectCliError } = require('./olt-ssh-client');

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
    mgmtVlan: { int: [1, 4094], hint: 'VLAN manajemen ACS 1-4094' },
    tr069SpIdx: { int: [1, 8], hint: 'index service-port TR069 (1-8)' },
    acsUrl: { re: /^https?:\/\/[\w.-]+(?::\d{1,5})?(?:\/[\w.~%/-]*)?$/, hint: 'URL ACS, contoh http://172.17.11.2:7547' },
    acsUsername: { re: TOKEN_RE, hint: 'username ACS tanpa spasi' },
    acsPassword: { re: TOKEN_RE, hint: 'password ACS tanpa spasi' },
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
 * Output ZXAN berbentuk "Label:   value" per baris (label diverifikasi live C320 V2.1.0:
 * "Config state" — bukan "Configuration state"; "Admin state" terpisah dari "State").
 * @param {string} text
 * @returns {{name, type, state, adminState, configState, phaseState, serial, onlineDuration, distance}|null}
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
        adminState: pick('Admin state'),
        configState: pick('Config(?:uration)? state'),
        phaseState: pick('Phase state'),
        serial: pick('Serial number'),
        onlineDuration: pick('Online Duration'),
        distance: pick('ONU Distance'),
    };
    const hasAny = Object.values(detail).some((v) => v !== null);
    return hasAny ? detail : null;
}

/**
 * Parse `show card` → kartu GPON line (CfgType GTxx) beserta daftar port PON-nya.
 * Contoh baris (verif live): "1    1     2    GTGH    GTGHG    16    V1.0.0  V2.1.0  INSERVICE"
 * Penamaan interface C320: gpon-olt_<rack>/<slot>/<port>.
 * @param {string} text
 * @returns {Array<{slotPrefix: string, cfgType: string, ports: number, status: string, ponPorts: string[]}>}
 */
function parseCardPonPorts(text) {
    const out = [];
    const re = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(GT\w+)\s+(\S*)\s+(\d+)\s+\S*\s*\S*\s*(\w+)\s*$/gm;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
        const rack = m[1];
        const slot = m[3];
        const ports = parseInt(m[6], 10) || 0;
        const slotPrefix = `${rack}/${slot}`;
        out.push({
            slotPrefix,
            cfgType: m[4],
            ports,
            status: m[7],
            ponPorts: Array.from({ length: ports }, (_v, i) => `${slotPrefix}/${i + 1}`),
        });
    }
    return out;
}

/**
 * Parse `show onu-type gpon` → daftar nama tipe ONU terdaftar di OLT.
 * @param {string} text
 * @returns {Array<{name: string, description: string}>}
 */
function parseOnuTypeNames(text) {
    const out = [];
    const blocks = String(text || '').split(/(?=ONU type name\s*:)/i);
    for (const b of blocks) {
        const nm = b.match(/ONU type name\s*:\s*(\S+)/i);
        if (!nm) continue;
        const dm = b.match(/Description\s*:\s*(.*)/i);
        out.push({ name: nm[1], description: dm ? dm[1].trim() : '' });
    }
    return out;
}

/**
 * Parse `show gpon profile tcont` / `show gpon profile traffic` → nama profil.
 * Format live: "Profile name :INET" (spasi sebelum titik dua bervariasi).
 * @param {string} text
 * @returns {string[]}
 */
function parseProfileNames(text) {
    const out = [];
    const re = /Profile name\s*:\s*(\S+)/gi;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
        if (!out.includes(m[1])) out.push(m[1]);
    }
    return out;
}

/**
 * Parse `show vlan summary` → daftar VLAN id (string). Range "a-b" diekspansi bila
 * rentangnya kecil (≤64), selain itu token range dibiarkan apa adanya.
 * @param {string} text
 * @returns {string[]}
 */
function parseVlanSummary(text) {
    const src = String(text || '');
    const m = src.match(/following\s*:\s*([\s\S]*)/i);
    const body = m ? m[1] : src;
    const tokens = body.match(/\d+(?:-\d+)?/g) || [];
    const out = [];
    for (const t of tokens) {
        const range = t.match(/^(\d+)-(\d+)$/);
        if (range) {
            const a = parseInt(range[1], 10);
            const b = parseInt(range[2], 10);
            if (b > a && b - a <= 64) {
                for (let v = a; v <= b; v++) out.push(String(v));
            } else {
                out.push(t);
            }
            continue;
        }
        out.push(t);
    }
    return [...new Set(out)];
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
 * Enumerasi SEMUA ONU teregistrasi di OLT (lintas port PON) dalam SATU sesi SSH —
 * `show card` utk daftar port, lalu `show running-config interface gpon-olt_x/y/z` per
 * port. Dipakai status ACS & rollout bulk. Menghindari spam koneksi (1 sesi, banyak show).
 * @param {object} device
 * @returns {Promise<Array<{id, ponPort, onuId, type, sn}>>}
 */
async function listAllOnus(device) {
    return withHostLock(device && device.host, async () => {
        const session = await openOltShell(device, { commandTimeoutMs: 30000 });
        try {
            const cardOut = await session.exec('show card', { timeoutMs: 30000 });
            const ports = parseCardPonPorts(cardOut).flatMap((c) => c.ponPorts);
            const onus = [];
            for (const ponPort of ports) {
                const out = await session.exec(`show running-config interface gpon-olt_${ponPort}`, { timeoutMs: 30000 });
                for (const o of parseOnuOccupancy(out)) {
                    onus.push({ id: `${ponPort}:${o.onuId}`, ponPort, onuId: o.onuId, type: o.type, sn: o.sn });
                }
            }
            return onus;
        } finally {
            session.close();
        }
    });
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
 * Simpan running-config ke flash (`write`). Pada C320 dengan ratusan ONU proses ini
 * bisa lama (build internal) — timeout total panjang + idle guard.
 * @param {object} device
 * @returns {Promise<{saved: boolean, output: string, error: string|null}>}
 */
async function persistConfig(device) {
    try {
        const exec = await runOltCommands(device, ['write'], {
            autoConfirm: true,
            commandTimeoutMs: 600000,
            checkErrors: true,
        });
        const out = exec.results[0] ? exec.results[0].output : '';
        return { saved: exec.ok, output: out, error: exec.ok ? null : (exec.results[0] && exec.results[0].error) || 'write gagal' };
    } catch (e) {
        return { saved: false, output: '', error: e.message };
    }
}

/**
 * Registrasi ONU: render template profil tipe modem lalu eksekusi via SSH.
 * Eksekusi berhenti di perintah pertama yang error; hasil per-perintah dikembalikan
 * supaya UI bisa menunjukkan persis baris mana yang gagal.
 *
 * @param {object} device
 * @param {string} template  scriptTemplate dari profil tipe modem
 * @param {Record<string, any>} vars  sudah termasuk ponPort/onuId/sn/name/dst.
 * @param {object} [opts]  {saveConfig:false} — true: jalankan `write` setelah sukses
 *                         (config ZXAN TIDAK persist melewati reboot tanpa write).
 * @returns {Promise<{ok, script, commands, results, failedIndex, persist}>}
 */
async function registerOnu(device, template, vars, opts = {}) {
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
    let persist = null;
    if (exec.ok && opts.saveConfig === true) {
        persist = await persistConfig(device);
    }
    return { ok: exec.ok, script, commands, results: exec.results, failedIndex: exec.failedIndex, persist };
}

/**
 * Hapus registrasi ONU (`no onu N` pada interface gpon-olt). Dipakai untuk rollback
 * registrasi gagal ataupun pencabutan pelanggan.
 * @param {object} device
 * @param {string} ponPort
 * @param {number|string} onuId
 * @returns {Promise<{ok, results, failedIndex}>}
 */
async function deleteOnu(device, ponPort, onuId, opts = {}) {
    if (!PON_PORT_RE.test(String(ponPort || ''))) throw new Error('Format port PON tidak valid (contoh: 1/3/16)');
    const id = parseInt(onuId, 10);
    if (!Number.isInteger(id) || id < 1 || id > 128) throw new Error('ONU ID harus 1-128');
    const commands = ['conf t', `int gpon-olt_${ponPort}`, `no onu ${id}`, 'end'];
    // Sebagian firmware minta konfirmasi yes/no saat hapus ONU → autoConfirm.
    const exec = await runOltCommands(device, commands, { autoConfirm: true, commandTimeoutMs: 25000 });
    let persist = null;
    if (exec.ok && opts.saveConfig === true) {
        persist = await persistConfig(device);
    }
    return { ok: exec.ok, results: exec.results, failedIndex: exec.failedIndex, persist };
}

/**
 * Fakta OLT untuk dropdown form registrasi: port PON (show card), tipe ONU terdaftar,
 * profil T-CONT, profil traffic (downstream), dan VLAN yang ada — SATU sesi SSH.
 * @param {object} device
 * @returns {Promise<{ponPorts, cards, onuTypes, tcontProfiles, trafficProfiles, vlans}>}
 */
async function getOltFacts(device) {
    const res = await runOltCommands(device, [
        'show card',
        'show onu-type gpon',
        'show gpon profile tcont',
        'show gpon profile traffic',
        'show vlan summary',
    ], { checkErrors: false, stopOnError: false, commandTimeoutMs: 30000 });
    const out = (i) => (res.results[i] ? res.results[i].output : '');
    const cards = parseCardPonPorts(out(0));
    return {
        cards,
        ponPorts: cards.flatMap((c) => c.ponPorts),
        onuTypes: parseOnuTypeNames(out(1)),
        tcontProfiles: parseProfileNames(out(2)),
        trafficProfiles: parseProfileNames(out(3)),
        vlans: parseVlanSummary(out(4)),
    };
}

/**
 * Konfigurasi lengkap satu ONU (untuk viewer/audit): bagian interface gpon-onu
 * (tcont/gemport/service-port) + bagian pon-onu-mng (`show onu running config`).
 * @param {object} device
 * @param {string} ponPort
 * @param {number|string} onuId
 * @returns {Promise<{interfaceConfig: string, onuMngConfig: string}>}
 */
async function getOnuFullConfig(device, ponPort, onuId) {
    if (!PON_PORT_RE.test(String(ponPort || ''))) throw new Error('Format port PON tidak valid (contoh: 1/3/16)');
    const id = parseInt(onuId, 10);
    if (!Number.isInteger(id) || id < 1 || id > 128) throw new Error('ONU ID harus 1-128');
    const target = `gpon-onu_${ponPort}:${id}`;
    const res = await runOltCommands(device, [
        `show running-config interface ${target}`,
        `show onu running config ${target}`,
    ], { checkErrors: false, stopOnError: false, commandTimeoutMs: 30000 });
    return {
        interfaceConfig: res.results[0] ? res.results[0].output : '',
        onuMngConfig: res.results[1] ? res.results[1].output : '',
    };
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
 * Capture seluruh running-config OLT (bahan backup). VERIF LIVE C320 V2.1.0 + 610 ONU:
 * output streaming kontinu tapi build-nya ~15-20 MENIT — karena itu timeout berbasis
 * IDLE (gagal hanya bila output berhenti mengalir), dengan pagar total 45 menit.
 * @param {object} device
 * @param {object} [opts] {timeoutMs (total), idleTimeoutMs}
 * @returns {Promise<string>} teks konfigurasi
 */
async function captureRunningConfig(device, opts = {}) {
    return withHostLock(device && device.host, async () => {
        const session = await openOltShell(device, { commandTimeoutMs: 30000 });
        try {
            const out = await session.exec('show running-config', {
                timeoutMs: opts.timeoutMs || 2700000,       // pagar total 45 menit
                idleTimeoutMs: opts.idleTimeoutMs || 120000, // gagal bila sunyi 2 menit
            });
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
 * Suruh OLT meng-upload startup-config (startrun.dat) ke server FTP via CLI.
 * VERIF LIVE C320 V2.1.0: sukses ditandai "....Successfully"; gagal "Initiate a FTP
 * transfer failed" (route/server tak terjangkau) atau %Code/%Error. Nama file tujuan
 * TIDAK bisa custom (%Code 65639) — selalu startrun.dat (rename di sisi penerima).
 * CATATAN: yang di-backup = STARTUP config (hasil `write` terakhir), bukan running.
 *
 * @param {object} device
 * @param {{selfHost: string, ftpUser: string, ftpPass: string, remoteDir: string}} ftp
 * @returns {Promise<{ok: boolean, output: string, error: string|null}>}
 */
async function uploadStartupViaFtp(device, ftp) {
    if (!ftp || !ftp.selfHost || !ftp.ftpUser || !ftp.ftpPass) {
        throw new Error('Parameter FTP tidak lengkap (selfHost/ftpUser/ftpPass)');
    }
    const cmd = `file upload cfg-startup startrun.dat ftp ipaddress ${ftp.selfHost} path ${ftp.remoteDir || 'RAF'} user ${ftp.ftpUser} password ${ftp.ftpPass}`;
    const res = await runOltCommands(device, [cmd], { checkErrors: true, commandTimeoutMs: 300000 });
    const out = res.results[0] ? res.results[0].output : '';
    const cliErr = res.results[0] ? res.results[0].error : null;
    if (cliErr) return { ok: false, output: out, error: cliErr };
    if (/successfully/i.test(out)) return { ok: true, output: out, error: null };
    if (/failed/i.test(out)) return { ok: false, output: out, error: out.split('\n').find((l) => /failed/i.test(l)) || 'transfer gagal' };
    return { ok: false, output: out, error: 'Tidak ada konfirmasi "Successfully" dari OLT' };
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

// ── ACS / TR069 (retrofit ADITIF ke ONU yang sudah teregistrasi) ──────────────

// Klasifikasi vendor dari prefix SN → menentukan metode fix ACS. VERIF LIVE VANS
// (2026-06-16): hanya ZTE asli (ZTEG) yang patuh OMCI `tr069-mgmt` (OLT-push). Clone
// (RTEG/ZICG/ZXIC/CIOT) & Huawei TIDAK — harus diset di modem (in-band). Prefix hanya
// PETUNJUK; kebenaran final = inform di GenieACS (ZTEG ex-ISP terkunci bisa ber-SN
// ZTEG tapi tetap tak inform → route harus verifikasi inform, bukan "command OK").
const VENDOR_TIERS = {
    ZTEG: { vendor: 'ZTE', tier: 'zte', method: 'olt-push' },
    HWTC: { vendor: 'Huawei', tier: 'huawei', method: 'manual' },
    RTEG: { vendor: 'OEM/ZTE-clone', tier: 'clone', method: 'in-band' },
    ZICG: { vendor: 'OEM/ZTE-clone', tier: 'clone', method: 'in-band' },
    ZXIC: { vendor: 'OEM/ZTE-clone', tier: 'clone', method: 'in-band' },
    CIOT: { vendor: 'OEM/ZTE-clone', tier: 'clone', method: 'in-band' },
};

/**
 * Klasifikasi vendor ONU dari serial number (prefix 4 huruf).
 * @param {string} sn
 * @returns {{prefix, vendor, tier, method, oltPushable}}
 */
function classifyVendorTier(sn) {
    const prefix = String(sn || '').toUpperCase().slice(0, 4);
    const t = VENDOR_TIERS[prefix] || { vendor: 'Unknown', tier: 'unknown', method: 'manual' };
    return { prefix, ...t, oltPushable: t.tier === 'zte' };
}

// Blok TR069 ADITIF — hanya MENAMBAH jalur ACS, tidak mengubah service internet/hotspot
// yang sudah ada. Terverifikasi live di ZTE F670L (VANS, inform <20 dtk).
const TR069_ADDON_TEMPLATE = [
    'conf t',
    'int gpon-onu_{{ponPort}}:{{onuId}}',
    'service-port {{tr069SpIdx}} vport 1 user-vlan {{mgmtVlan}} vlan {{mgmtVlan}}',
    '!',
    'pon-onu-mng gpon-onu_{{ponPort}}:{{onuId}}',
    'service TR069 gemport 1 vlan {{mgmtVlan}}',
    'tr069-mgmt 1 state unlock',
    'tr069-mgmt 1 acs {{acsUrl}} validate basic username {{acsUsername}} password {{acsPassword}}',
    'tr069-mgmt 1 tag pri 0 vlan {{mgmtVlan}}',
    'end',
].join('\n');

/** Susun vars template TR069 dari setting ACS per-OLT. */
function buildTr069Vars(ponPort, onuId, acs, opts = {}) {
    return {
        ponPort: String(ponPort),
        onuId: String(parseInt(onuId, 10)),
        acsUrl: acs && acs.url,
        acsUsername: acs && acs.user,
        acsPassword: acs && acs.pass,
        mgmtVlan: String((acs && acs.mgmtVlan) || 100),
        tr069SpIdx: String(opts.tr069SpIdx || 3),
    };
}

/**
 * Pasang blok TR069 (ACS) aditif ke ONU yang sudah teregistrasi. HANYA cocok untuk ONU
 * ZTE asli (lihat classifyVendorTier) — pemanggil WAJIB cek oltPushable lebih dulu.
 * @param {object} device
 * @param {string} ponPort  "1/2/1"
 * @param {number|string} onuId
 * @param {{url, user, pass, mgmtVlan}} acs
 * @param {object} [opts] {tr069SpIdx=3, saveConfig=false}
 * @returns {Promise<{ok, script, commands, results, failedIndex, persist}>}
 */
async function applyTr069Addon(device, ponPort, onuId, acs, opts = {}) {
    if (!PON_PORT_RE.test(String(ponPort || ''))) throw new Error('Format port PON tidak valid (contoh: 1/2/1)');
    const id = parseInt(onuId, 10);
    if (!Number.isInteger(id) || id < 1 || id > 128) throw new Error('ONU ID harus 1-128');
    if (!acs || !acs.url || !acs.user || !acs.pass) throw new Error('Setting ACS belum lengkap (url/user/pass)');
    const v = validateVars(buildTr069Vars(ponPort, id, acs, opts));
    if (!v.ok) { const e = new Error('Setting ACS tidak valid: ' + v.errors.join('; ')); e.validationErrors = v.errors; throw e; }
    const { script, missing } = renderScript(TR069_ADDON_TEMPLATE, v.values);
    if (missing.length) { const e = new Error('Setting ACS belum terisi: ' + missing.join(', ')); e.missingVars = missing; throw e; }
    const commands = scriptToCommands(script);
    const exec = await runOltCommands(device, commands, { commandTimeoutMs: 25000, autoConfirm: true });
    let persist = null;
    if (exec.ok && opts.saveConfig === true) persist = await persistConfig(device);
    return { ok: exec.ok, script, commands, results: exec.results, failedIndex: exec.failedIndex, persist };
}

/**
 * Lepas blok TR069 (rollback): matikan agen + buang service/service-port TR069. Aman
 * untuk dijalankan di ONU yang belum punya TR069 (perintah `no ...` tinggal no-op/diabaikan
 * — pakai stopOnError:false). Baris `tr069-mgmt 1 acs ...` bisa tetap tersimpan tapi inert.
 * @param {object} device
 * @param {string} ponPort
 * @param {number|string} onuId
 * @param {object} [opts] {tr069SpIdx=3, saveConfig=false}
 * @returns {Promise<{ok, results, persist}>}
 */
async function removeTr069Addon(device, ponPort, onuId, opts = {}) {
    if (!PON_PORT_RE.test(String(ponPort || ''))) throw new Error('Format port PON tidak valid (contoh: 1/2/1)');
    const id = parseInt(onuId, 10);
    if (!Number.isInteger(id) || id < 1 || id > 128) throw new Error('ONU ID harus 1-128');
    const spIdx = parseInt(opts.tr069SpIdx || 3, 10);
    const target = `gpon-onu_${ponPort}:${id}`;
    const commands = [
        'conf t', `int ${target}`, `no service-port ${spIdx}`, 'exit',
        `pon-onu-mng ${target}`, 'tr069-mgmt 1 state lock', 'no service TR069', 'end',
    ];
    const exec = await runOltCommands(device, commands, { commandTimeoutMs: 25000, autoConfirm: true, stopOnError: false, checkErrors: true });
    let persist = null;
    if (opts.saveConfig === true) persist = await persistConfig(device);
    return { ok: exec.failedIndex === null, results: exec.results, persist };
}

/**
 * Pasang blok TR069 ke BANYAK ONU dalam SATU sesi SSH (anti spam-koneksi ZXAN). Toleran-error
 * per ONU (kegagalan 1 ONU tidak menggugurkan sisanya). `write` dilakukan SEKALI di akhir
 * (di sesi yang sama — bukan via persistConfig, untuk hindari deadlock withHostLock).
 * Pemanggil WAJIB sudah menyaring targets ke ONU ZTE asli (oltPushable).
 * @param {object} device
 * @param {Array<{ponPort, onuId, sn}>} targets
 * @param {{url, user, pass, mgmtVlan}} acs
 * @param {object} [opts] {tr069SpIdx=3, saveConfig=false}
 * @returns {Promise<{results, okCount, failCount, persist}>}
 */
async function applyTr069AddonBulk(device, targets, acs, opts = {}) {
    if (!acs || !acs.url || !acs.user || !acs.pass) throw new Error('Setting ACS belum lengkap (url/user/pass)');
    const mgmtVlan = String(acs.mgmtVlan || 100);
    const spIdx = String(opts.tr069SpIdx || 3);
    return withHostLock(device && device.host, async () => {
        const session = await openOltShell(device, { commandTimeoutMs: 25000 });
        const results = [];
        let persist = null;
        try {
            for (const t of (targets || [])) {
                const id = parseInt(t.onuId, 10);
                if (!PON_PORT_RE.test(String(t.ponPort || '')) || !Number.isInteger(id) || id < 1 || id > 128) {
                    results.push({ id: `${t.ponPort}:${t.onuId}`, sn: t.sn, ok: false, error: 'target tidak valid' });
                    continue;
                }
                const target = `gpon-onu_${t.ponPort}:${id}`;
                const cmds = [
                    'conf t', `int ${target}`,
                    `service-port ${spIdx} vport 1 user-vlan ${mgmtVlan} vlan ${mgmtVlan}`, 'exit',
                    `pon-onu-mng ${target}`, `service TR069 gemport 1 vlan ${mgmtVlan}`,
                    'tr069-mgmt 1 state unlock',
                    `tr069-mgmt 1 acs ${acs.url} validate basic username ${acs.user} password ${acs.pass}`,
                    `tr069-mgmt 1 tag pri 0 vlan ${mgmtVlan}`, 'end',
                ];
                let err = null;
                for (const c of cmds) {
                    try {
                        const out = await session.exec(c, { timeoutMs: 25000, autoConfirm: true });
                        const e = detectCliError(out);
                        if (e) { err = e; break; }
                    } catch (ex) { err = ex.message; break; }
                }
                // Bila gagal di tengah konteks, paksa kembali ke privileged sebelum ONU berikutnya.
                if (err) { try { await session.exec('end', { timeoutMs: 8000 }); } catch (_e) { /* abaikan */ } }
                results.push({ id: `${t.ponPort}:${id}`, sn: t.sn, ok: !err, error: err });
            }
            if (opts.saveConfig === true) {
                try {
                    const wout = await session.exec('write', { timeoutMs: 600000, autoConfirm: true });
                    persist = { saved: !detectCliError(wout), output: wout };
                } catch (e) { persist = { saved: false, error: e.message }; }
            }
        } finally {
            session.close();
        }
        return {
            results,
            okCount: results.filter((r) => r.ok).length,
            failCount: results.filter((r) => !r.ok).length,
            persist,
        };
    });
}

module.exports = {
    listUncfgOnus,
    listAllOnus,
    getPonOccupancy,
    registerOnu,
    deleteOnu,
    getOnuStatus,
    getOltFacts,
    getOnuFullConfig,
    persistConfig,
    captureRunningConfig,
    uploadStartupViaFtp,
    testSshConnection,
    renderScript,
    validateVars,
    listPlaceholders,
    suggestOnuId,
    classifyVendorTier,
    applyTr069Addon,
    applyTr069AddonBulk,
    removeTr069Addon,
    buildTr069Vars,
    TR069_ADDON_TEMPLATE,
    __test: {
        parseUncfgOutput,
        parseOnuOccupancy,
        parseOnuDetail,
        parsePonPower,
        parseCardPonPorts,
        parseOnuTypeNames,
        parseProfileNames,
        parseVlanSummary,
        suggestOnuId,
        renderScript,
        validateVars,
        listPlaceholders,
        classifyVendorTier,
        buildTr069Vars,
        TR069_ADDON_TEMPLATE,
        PON_PORT_RE,
        SN_RE,
    },
};
