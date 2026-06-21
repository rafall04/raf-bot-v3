/**
 * Header Doc
 * Purpose: Manajemen SERVICE-PORT OLT ZTE C320 (ZXAN) per-ONU via web — generator script + guard
 *          untuk tambah/hapus service-port dan list service-port sebuah ONU. CONFIG-WRITE
 *          PER-PELANGGAN (paling sensitif): WAJIB preview + konfirmasi + audit. Sintaks
 *          diverifikasi LIVE (`show running-config interface gpon-onu_X:Y`) di VANS C320 V2.1.0:
 *            interface gpon-onu_1/2/2:33
 *              service-port 1 vport 1 user-vlan 300 vlan 300
 *          tambah: `service-port <idx> vport <v> user-vlan <u> vlan <s>` ; hapus: `no service-port <idx>`.
 * Caller: routes/olt-provisioning.js (preview/apply/list service-port).
 * Deps: lib/olt-ssh-client (runOltCommands — host-lock, 1 sesi).
 * MainFuncs: validateOnuInterface, validateIndex, validateVlan, buildAddServicePort,
 *            buildDeleteServicePort, parseServicePorts, listServicePorts, executeServicePortScript.
 * SideEffects: executeServicePortScript menulis konfig ONU (`configure terminal` … [`write`]).
 *
 * KEAMANAN: interface ONU wajib format gpon-onu_<r>/<s>/<p>:<onu> (anti-injeksi), idx 1–32,
 * vport 1–8, vlan 1–4094. WAJIB lewat preview+konfirmasi+audit di route. Mengubah service-port
 * pelanggan AKTIF dapat memutus layanannya → guard "blokir hapus idx existing tanpa konfirmasi"
 * ditangani di route/UI; modul ini hanya generate + validasi bentuk.
 */
'use strict';

const { runOltCommands } = require('./olt-ssh-client');

const ONU_RE = /^gpon-onu_\d+\/\d+\/\d+:\d+$/;

function validateOnuInterface(raw) {
    const s = String(raw || '').trim();
    if (!ONU_RE.test(s)) return { ok: false, reason: 'Interface ONU harus format gpon-onu_<rack>/<slot>/<pon>:<onu>.' };
    return { ok: true, onu: s };
}

function validateRange(raw, min, max, field) {
    const trimmed = String(raw == null ? '' : raw).trim();
    if (!/^\d+$/.test(trimmed)) return { ok: false, reason: `${field} harus angka.` };
    const n = parseInt(trimmed, 10);
    if (n < min || n > max) return { ok: false, reason: `${field} harus ${min}–${max}.` };
    return { ok: true, value: n };
}

const validateIndex = (v) => validateRange(v, 1, 32, 'Index service-port');
const validateVport = (v) => validateRange(v, 1, 8, 'vport');
const validateVlan = (v, field) => validateRange(v, 1, 4094, field || 'VLAN');

function buildAddServicePort({ onu, index, vport, userVlan, svlan } = {}) {
    const o = validateOnuInterface(onu);
    if (!o.ok) return o;
    const idx = validateIndex(index);
    if (!idx.ok) return idx;
    const vp = validateVport(vport == null || vport === '' ? 1 : vport);
    if (!vp.ok) return vp;
    const uv = validateVlan(userVlan, 'user-vlan');
    if (!uv.ok) return uv;
    const sv = validateVlan(svlan, 'svlan');
    if (!sv.ok) return sv;
    return {
        ok: true,
        action: 'add-service-port',
        onu: o.onu,
        index: idx.value,
        commands: [
            'configure terminal',
            `interface ${o.onu}`,
            `service-port ${idx.value} vport ${vp.value} user-vlan ${uv.value} vlan ${sv.value}`,
            'exit',
            'end'
        ],
        summary: `Tambah service-port ${idx.value} (user-vlan ${uv.value}/vlan ${sv.value}) di ${o.onu}`
    };
}

function buildDeleteServicePort({ onu, index } = {}) {
    const o = validateOnuInterface(onu);
    if (!o.ok) return o;
    const idx = validateIndex(index);
    if (!idx.ok) return idx;
    return {
        ok: true,
        action: 'delete-service-port',
        onu: o.onu,
        index: idx.value,
        commands: ['configure terminal', `interface ${o.onu}`, `no service-port ${idx.value}`, 'exit', 'end'],
        summary: `Hapus service-port ${idx.value} di ${o.onu}`
    };
}

/**
 * Parse service-port + identitas dari output `show running-config interface gpon-onu_X:Y`.
 * @returns {{name:string|null, servicePorts:Array<{index,vport,userVlan,svlan}>}}
 */
function parseServicePorts(text) {
    const t = String(text || '');
    const name = (t.match(/^\s*name\s+(\S+)/m) || [])[1] || null;
    const servicePorts = [];
    const re = /service-port\s+(\d+)\s+vport\s+(\d+)\s+user-vlan\s+(\d+)\s+vlan\s+(\d+)/g;
    let m;
    while ((m = re.exec(t)) !== null) {
        servicePorts.push({ index: Number(m[1]), vport: Number(m[2]), userVlan: Number(m[3]), svlan: Number(m[4]) });
    }
    return { name, servicePorts };
}

/**
 * List service-port sebuah ONU (READ-ONLY).
 * @param {object} device
 * @param {string} onu interface gpon-onu_X:Y
 */
async function listServicePorts(device, onu) {
    const o = validateOnuInterface(onu);
    if (!o.ok) return { ok: false, reason: o.reason };
    const res = await runOltCommands(device, [`show running-config interface ${o.onu}`], {
        stopOnError: false,
        checkErrors: false,
        commandTimeoutMs: 20000,
        connectRetries: 1
    });
    const out = (res.results && res.results[0] && res.results[0].output) || '';
    return { ok: true, onu: o.onu, ...parseServicePorts(out) };
}

/**
 * Eksekusi script service-port (CONFIG-WRITE PER-PELANGGAN). stopOnError + autoConfirm;
 * save=true → tambah `write` (persist).
 */
async function executeServicePortScript(device, commands, { save = true } = {}) {
    const full = save ? [...commands, 'write'] : commands.slice();
    return runOltCommands(device, full, {
        stopOnError: true,
        autoConfirm: true,
        checkErrors: true,
        commandTimeoutMs: 20000,
        connectRetries: 1
    });
}

module.exports = {
    validateOnuInterface,
    validateIndex,
    validateVport,
    validateVlan,
    buildAddServicePort,
    buildDeleteServicePort,
    parseServicePorts,
    listServicePorts,
    executeServicePortScript
};
