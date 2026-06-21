/**
 * Header Doc
 * Purpose: Manajemen VLAN OLT ZTE C320 (ZXAN) via web — generator script CLI + guard untuk
 *          buat/hapus VLAN dan tambah/lepas VLAN pada trunk uplink. CONFIG-WRITE: WAJIB dipakai
 *          dengan preview + konfirmasi + audit + rollback di route. Sintaks diverifikasi LIVE
 *          (`show vlan`, `show running-config interface gei_...`) di VANS C320 V2.1.0.
 * Caller: routes/olt-provisioning.js (preview/apply VLAN).
 * Deps: lib/olt-ssh-client (runOltCommands — host-lock, 1 sesi).
 * MainFuncs: validateVlanId, sanitizeLabel, validateUplinkPort, buildCreateVlan, buildDeleteVlan,
 *            buildTrunk, executeVlanScript.
 * SideEffects: executeVlanScript menulis konfig OLT (`configure terminal` … [`write`]).
 *
 * KEAMANAN: id 2–4094 (tolak 1 reserved), label anti-injeksi (huruf/angka/_-., tanpa spasi/
 * newline/`?`/kutip), port trunk wajib format gei_x/y/z. Service-port (per-ONU/pelanggan) TIDAK
 * di sini — itu butuh recon per-ONU + maintenance window (lihat SYSTEM_MAP).
 */
'use strict';

const { runOltCommands } = require('./olt-ssh-client');

const RESERVED_VLANS = new Set([1]);
const LABEL_RE = /^[A-Za-z0-9_\-.]+$/; // satu token; sesuai konvensi `name`/`description` ZXAN

function validateVlanId(raw) {
    const trimmed = String(raw == null ? '' : raw).trim();
    const id = parseInt(trimmed, 10);
    if (!/^\d+$/.test(trimmed)) return { ok: false, reason: 'VLAN id harus angka.' };
    if (id < 2 || id > 4094) return { ok: false, reason: 'VLAN id harus 2–4094.' };
    if (RESERVED_VLANS.has(id)) return { ok: false, reason: `VLAN ${id} reserved — tidak boleh diubah.` };
    return { ok: true, id };
}

function sanitizeLabel(raw, field) {
    if (raw == null || String(raw).trim() === '') return { ok: true, value: '' };
    const s = String(raw).trim();
    if (s.length > 32) return { ok: false, reason: `${field} maksimal 32 karakter.` };
    if (!LABEL_RE.test(s))
        return { ok: false, reason: `${field} hanya boleh huruf/angka/_-. (tanpa spasi, anti-injeksi).` };
    return { ok: true, value: s };
}

function validateUplinkPort(raw) {
    const p = String(raw || '').trim();
    if (!/^gei_\d+\/\d+\/\d+$/.test(p))
        return { ok: false, reason: 'Port uplink harus format gei_<rack>/<slot>/<port>.' };
    return { ok: true, port: p };
}

function buildCreateVlan({ id, name, description } = {}) {
    const vid = validateVlanId(id);
    if (!vid.ok) return vid;
    const nm = sanitizeLabel(name, 'Nama');
    if (!nm.ok) return nm;
    const ds = sanitizeLabel(description, 'Deskripsi');
    if (!ds.ok) return ds;
    const commands = ['configure terminal', `vlan ${vid.id}`];
    if (nm.value) commands.push(`name ${nm.value}`);
    if (ds.value) commands.push(`description ${ds.value}`);
    commands.push('exit', 'end');
    return {
        ok: true,
        action: 'create-vlan',
        vlanId: vid.id,
        commands,
        summary: `Buat VLAN ${vid.id}${nm.value ? ` (${nm.value})` : ''}`
    };
}

function buildDeleteVlan({ id } = {}) {
    const vid = validateVlanId(id);
    if (!vid.ok) return vid;
    return {
        ok: true,
        action: 'delete-vlan',
        vlanId: vid.id,
        commands: ['configure terminal', `no vlan ${vid.id}`, 'end'],
        summary: `Hapus VLAN ${vid.id}`
    };
}

function buildTrunk({ port, id, action } = {}) {
    const vid = validateVlanId(id);
    if (!vid.ok) return vid;
    const pt = validateUplinkPort(port);
    if (!pt.ok) return pt;
    if (action !== 'add' && action !== 'remove') return { ok: false, reason: 'Aksi trunk harus "add" atau "remove".' };
    const line = action === 'add' ? `switchport vlan ${vid.id} tag` : `no switchport vlan ${vid.id} tag`;
    return {
        ok: true,
        action: `trunk-${action}`,
        vlanId: vid.id,
        port: pt.port,
        commands: ['configure terminal', `interface ${pt.port}`, line, 'exit', 'end'],
        summary: `${action === 'add' ? 'Tambah' : 'Lepas'} VLAN ${vid.id} ${action === 'add' ? 'ke' : 'dari'} trunk ${pt.port}`
    };
}

/**
 * Daftar VLAN (READ-ONLY) dari `show vlan summary`.
 * @returns {Promise<{count:number|null, list:string[]}>}
 */
async function listVlans(device) {
    const res = await runOltCommands(device, ['show vlan summary'], {
        stopOnError: false,
        checkErrors: false,
        commandTimeoutMs: 15000,
        connectRetries: 1
    });
    const out = (res.results && res.results[0] && res.results[0].output) || '';
    const count = parseInt((out.match(/All created vlan num:\s*(\d+)/) || [])[1], 10);
    const listLine = (out.match(/^\s*([\d, ]+)\s*$/m) || [])[1];
    const list = listLine
        ? listLine
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
        : [];
    return { count: Number.isNaN(count) ? null : count, list };
}

/**
 * Eksekusi script VLAN (CONFIG-WRITE). stopOnError=true (berhenti di error pertama → cegah
 * konfig setengah-jadi), autoConfirm (jawab [yes/no]), save=true → tambah `write` agar persist.
 * @returns {Promise<{ok:boolean, results:Array, failedIndex:number|null, prompt:string}>}
 */
async function executeVlanScript(device, commands, { save = true } = {}) {
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
    validateVlanId,
    sanitizeLabel,
    validateUplinkPort,
    buildCreateVlan,
    buildDeleteVlan,
    buildTrunk,
    listVlans,
    executeVlanScript,
    RESERVED_VLANS
};
