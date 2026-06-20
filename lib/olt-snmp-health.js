/**
 * Header Doc
 * Purpose: Snapshot kesehatan OLT ZTE C320 via SNMP (BEBAS-LOCKOUT, lebih aman dari SSH untuk
 *          polling berulang). Identitas+uptime, suhu+ambang, kipas RPM, CPU/memori/status
 *          per-kartu, dan monitor power/lingkungan (EMU dry-contact). OID ZTE enterprise
 *          diverifikasi LIVE vs CLI `show fan`/`show processor`/`show card` (VANS 172.17.1.2).
 * Caller: lib/olt-health-service.js (sumber utama bulk; SSH melengkapi uplink/L3/VLAN).
 * Deps: net-snmp. Read-only (snmp get/walk), tidak menulis apa pun ke OLT.
 * MainFuncs: getSnmpHealth(device), + decoder murni (di-export untuk unit test).
 * SideEffects: Query SNMP UDP read-only ke OLT.
 *
 * Catatan platform (C320 V2.1.0, verif live): MIB standar HOST-RESOURCES (storage) &
 * ENTITY-SENSOR TIDAK didukung; semua via enterprise 3902.1082. Penyimpanan/flash & voltase
 * PSU internal TIDAK diekspos firmware ini (storage=null). EMU = 8 input dry-contact eksternal
 * (rectifier/AC/baterai) — di VANS belum dikabeli (mapping=255). IF-MIB ifDescr kosong → uplink
 * per-port tidak diambil via SNMP (dipenuhi jalur SSH yang hanya melaporkan port terpasang).
 */
'use strict';

const snmp = require('net-snmp');

const ENT = '1.3.6.1.4.1.3902.1082';
const OID = {
    sysDescr: '1.3.6.1.2.1.1.1.0',
    sysContact: '1.3.6.1.2.1.1.4.0',
    sysName: '1.3.6.1.2.1.1.5.0',
    sysLocation: '1.3.6.1.2.1.1.6.0',
    sysUptime: '1.3.6.1.2.1.1.3.0',
    // Lingkungan: suhu + ambang (sensor 1.1)
    tempCur: ENT + '.10.10.2.1.5.1.3.1.1',
    tempHigh: ENT + '.10.10.2.1.5.1.4.1.1',
    tempCrit: ENT + '.10.10.2.1.5.1.5.1.1',
    tempLow: ENT + '.10.10.2.1.5.1.6.1.1',
    // Kolom tabel kartu (suffix berakhir .<slot>)
    cardRealType: ENT + '.10.1.2.4.1.4',
    cardPort: ENT + '.10.1.2.4.1.7',
    cardCpu: ENT + '.10.1.2.4.1.9',
    cardMemPct: ENT + '.10.1.2.4.1.11',
    cardStatus: ENT + '.10.1.2.4.1.13', // 1=inservice, 2=offline
    cardPhyMem: ENT + '.10.1.2.4.1.19',
    // Kipas RPM aktual (suffix berakhir .<fanId>)
    fanRpm: ENT + '.10.10.2.4.11.1.7',
    // EMU power/lingkungan: katalog nama + kanal state/mapping
    emuName: ENT + '.10.10.2.5.2.1.2', // .<1..26> nama kondisi
    emuState: ENT + '.10.10.2.5.3.1.2', // .<ch> 0=normal
    emuMap: ENT + '.10.10.2.5.3.1.5' // .<ch> 255=tak terpetakan
};

function toStr(v) {
    return Buffer.isBuffer(v) ? v.toString().replace(/\0+$/, '') : v == null ? null : String(v);
}
function toNum(v) {
    const n = parseInt(toStr(v), 10);
    return Number.isNaN(n) ? null : n;
}
function lastIndex(suffix) {
    const parts = String(suffix).split('.');
    return parts[parts.length - 1];
}

function snmpGet(session, oids) {
    return new Promise((resolve) => {
        session.get(oids, (err, vbs) => {
            const m = {};
            if (!err && Array.isArray(vbs)) {
                vbs.forEach((vb, i) => {
                    if (!snmp.isVarbindError(vb)) m[oids[i]] = vb.value;
                });
            }
            resolve(m);
        });
    });
}

/** Walk satu kolom; kembalikan map suffix(setelah base)→value. */
function snmpWalkColumn(session, base) {
    return new Promise((resolve) => {
        const out = {};
        session.subtree(
            base,
            20,
            (vbs) => {
                for (const vb of vbs) {
                    if (snmp.isVarbindError(vb)) continue;
                    if (vb.oid.length <= base.length) continue;
                    out[vb.oid.slice(base.length + 1)] = vb.value;
                }
            },
            () => resolve(out)
        );
    });
}

// ── Decoder murni (di-export untuk unit test) ────────────────────────────────

function decodeCards({ realType, port, cpu, memPct, status, phyMem }) {
    const slots = new Set([...Object.keys(realType || {}), ...Object.keys(status || {})].map(lastIndex));
    const at = (col, slot) => {
        for (const [suf, val] of Object.entries(col || {})) if (lastIndex(suf) === slot) return val;
        return undefined;
    };
    const cards = [];
    for (const slot of [...slots].sort((a, b) => Number(a) - Number(b))) {
        const st = toNum(at(status, slot));
        cards.push({
            slot: Number(slot),
            realType: toStr(at(realType, slot)) || '',
            port: toNum(at(port, slot)),
            cpu5m: toNum(at(cpu, slot)),
            memPct: toNum(at(memPct, slot)),
            phyMemMb: toNum(at(phyMem, slot)),
            statusCode: st,
            status: st === 1 ? 'INSERVICE' : st === 2 ? 'OFFLINE' : 'UNKNOWN',
            ok: st === 1
        });
    }
    return cards.filter((c) => c.realType || c.statusCode != null);
}

function decodeFans(rpmMap) {
    return Object.entries(rpmMap || {})
        .map(([suf, val]) => ({ id: Number(lastIndex(suf)), rpm: toNum(val) }))
        .filter((f) => f.rpm != null)
        .sort((a, b) => a.id - b.id);
}

function decodeTemperature(scalars) {
    return {
        envTempC: toNum(scalars[OID.tempCur]),
        highTempC: toNum(scalars[OID.tempHigh]),
        criticalTempC: toNum(scalars[OID.tempCrit]),
        lowTempC: toNum(scalars[OID.tempLow])
    };
}

/**
 * EMU = monitor power/lingkungan (8 input dry-contact). Kanal aktif (state!=0) jadi alarm
 * bernama bila terpetakan ke katalog (mapping bukan 255/0); selain itu label generik.
 */
function decodePowerEnv(nameMap, stateMap, mapMap) {
    const names = {};
    for (const [suf, val] of Object.entries(nameMap || {})) names[lastIndex(suf)] = toStr(val);
    const mapByCh = {};
    for (const [suf, val] of Object.entries(mapMap || {})) mapByCh[lastIndex(suf)] = toNum(val);
    const channels = [];
    const activeAlarms = [];
    for (const [suf, val] of Object.entries(stateMap || {})) {
        const ch = lastIndex(suf);
        const state = toNum(val);
        const mapped = mapByCh[ch];
        const isMapped = mapped != null && mapped !== 255 && mapped !== 0;
        const label = isMapped && names[String(mapped)] ? names[String(mapped)] : `Input ${ch}`;
        const active = state != null && state !== 0;
        channels.push({ channel: Number(ch), label, mapped: isMapped, active });
        if (active) activeAlarms.push(label);
    }
    return {
        catalog: Object.keys(names).length,
        mappedCount: channels.filter((c) => c.mapped).length,
        channels: channels.sort((a, b) => a.channel - b.channel),
        activeAlarms
    };
}

function decodeIdentity(scalars) {
    const descr = toStr(scalars[OID.sysDescr]);
    let uptime = null;
    const up = scalars[OID.sysUptime];
    if (up != null) {
        const ticks = Number(up);
        if (!Number.isNaN(ticks)) {
            const sec = Math.floor(ticks / 100);
            uptime = `${Math.floor(sec / 86400)} hari, ${Math.floor((sec % 86400) / 3600)} jam, ${Math.floor((sec % 3600) / 60)} menit`;
        }
    }
    return {
        description: descr,
        version: descr ? (descr.match(/Version\s+(\S+)/) || [])[1] || null : null,
        uptime,
        name: toStr(scalars[OID.sysName]),
        location: toStr(scalars[OID.sysLocation]),
        contact: toStr(scalars[OID.sysContact])
    };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Ambil snapshot kesehatan via SNMP. Kembalikan null bila SNMP tak terjangkau (caller boleh
 * fallback ke SSH). Read-only — tak ada risiko lockout SSH.
 * @param {object} device {host, snmpPort, snmpCommunity, snmpTimeout, snmpRetries}
 */
async function getSnmpHealth(device) {
    const session = snmp.createSession(device.host, device.snmpCommunity || 'public', {
        port: parseInt(device.snmpPort, 10) || 161,
        version: snmp.Version2c,
        timeout: parseInt(device.snmpTimeout, 10) || 8000,
        retries: parseInt(device.snmpRetries, 10) >= 0 ? parseInt(device.snmpRetries, 10) : 1
    });
    try {
        const scalars = await snmpGet(session, [
            OID.sysDescr,
            OID.sysContact,
            OID.sysName,
            OID.sysLocation,
            OID.sysUptime,
            OID.tempCur,
            OID.tempHigh,
            OID.tempCrit,
            OID.tempLow
        ]);
        if (!Object.keys(scalars).length) return null; // SNMP mati/community salah → fallback SSH

        const [realType, port, cpu, memPct, status, phyMem, fanRpm, emuName, emuState, emuMap] = await Promise.all([
            snmpWalkColumn(session, OID.cardRealType),
            snmpWalkColumn(session, OID.cardPort),
            snmpWalkColumn(session, OID.cardCpu),
            snmpWalkColumn(session, OID.cardMemPct),
            snmpWalkColumn(session, OID.cardStatus),
            snmpWalkColumn(session, OID.cardPhyMem),
            snmpWalkColumn(session, OID.fanRpm),
            snmpWalkColumn(session, OID.emuName),
            snmpWalkColumn(session, OID.emuState),
            snmpWalkColumn(session, OID.emuMap)
        ]);

        const cards = decodeCards({ realType, port, cpu, memPct, status, phyMem });
        const temperature = decodeTemperature(scalars);
        temperature.fans = decodeFans(fanRpm);

        return {
            source: 'snmp',
            identity: decodeIdentity(scalars),
            temperature,
            cards,
            processors: cards
                .filter((c) => c.ok && (c.cpu5m != null || c.memPct != null))
                .map((c) => ({
                    slot: c.slot,
                    cpu5s: c.cpu5m,
                    cpu1m: c.cpu5m,
                    cpu5m: c.cpu5m,
                    memPct: c.memPct,
                    phyMemMb: c.phyMemMb
                })),
            powerEnv: decodePowerEnv(emuName, emuState, emuMap),
            storage: null // tak diekspos firmware ZXAN ini (CLI maupun SNMP)
        };
    } catch (_e) {
        return null;
    } finally {
        try {
            session.close();
        } catch (_e) {
            /* abaikan */
        }
    }
}

module.exports = {
    getSnmpHealth,
    OID,
    decodeCards,
    decodeFans,
    decodeTemperature,
    decodePowerEnv,
    decodeIdentity
};
