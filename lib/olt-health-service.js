/**
 * Header Doc
 * Purpose: Snapshot KESEHATAN OLT ZTE C320 (ZXAN) untuk dashboard web — suhu/kipas, CPU/memori
 *          per-slot, status kartu, uplink fisik + L3, VLAN, identitas/uptime, plus alert turunan
 *          (overheat, kartu offline, CPU/mem tinggi, uplink down). READ-ONLY: hanya perintah `show`.
 * Caller: routes/olt-provisioning.js (GET /provision/devices/:id/health).
 * Deps: lib/olt-ssh-client (openOltShell, withHostLock). Tidak menulis file/DB/konfig OLT.
 * MainFuncs: getHealthSnapshot(device, opts), + parser murni (di-export untuk unit test).
 * SideEffects: SATU sesi SSH read-only per refresh (serial per host via withHostLock), cache TTL pendek.
 *
 * CATATAN KEAMANAN: dashboard berpotensi di-refresh banyak admin → WAJIB cache + host-lock supaya
 * tidak membuka banyak sesi SSH (firmware ZXAN mengunci SSH bila ditembak beruntun). Hanya perintah
 * `show` (tanpa config/write/reboot). Perintah uplink diturunkan dari `show card` (generic lintas-OLT).
 */
'use strict';

const { openOltShell, withHostLock } = require('./olt-ssh-client');

const CORE_COMMANDS = {
    system: 'show system-group',
    card: 'show card',
    processor: 'show processor',
    fan: 'show fan',
    ipIntf: 'show ip interface brief',
    vlan: 'show vlan summary'
};

const CACHE_TTL_MS = 60000;
const MAX_UPLINK_PROBE = 8;
const cache = new Map(); // host -> { at, snapshot }

const DEFAULT_THRESHOLDS = { cpuPct: 85, memPct: 85, uplinkUtilPct: 90, tempWarnMargin: 10 };

function num(v) {
    const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
    return Number.isNaN(n) ? null : n;
}

// ── Parser murni ─────────────────────────────────────────────────────────────

function parseSystemGroup(text) {
    const t = String(text || '');
    const pick = (re) => {
        const m = t.match(re);
        return m ? m[1].trim() : null;
    };
    const description = pick(/System Description:\s*(.+)/);
    return {
        description,
        version: description ? (description.match(/Version\s+(\S+)/) || [])[1] || null : null,
        uptime: pick(/Started before:\s*(.+)/),
        name: pick(/System name:\s*(.+)/),
        location: pick(/Location:\s*(.+)/),
        contact: pick(/Contact with:\s*(.+)/)
    };
}

function parseCard(text) {
    const rows = [];
    for (const line of String(text || '').split('\n')) {
        const t = line.trim();
        if (!t || /^Rack\b/i.test(t) || /^-+$/.test(t)) continue;
        const tok = t.split(/\s+/);
        if (tok.length < 5 || !/^\d+$/.test(tok[0])) continue;
        const status = tok[tok.length - 1];
        const middle = tok.slice(4, tok.length - 1);
        const realType = middle[0] && !/^\d+$/.test(middle[0]) && !/^V\d/.test(middle[0]) ? middle[0] : '';
        const port = middle.find((x) => /^\d+$/.test(x)) || null;
        rows.push({
            rack: num(tok[0]),
            shelf: num(tok[1]),
            slot: num(tok[2]),
            cfgType: tok[3],
            realType,
            port: port ? num(port) : null,
            status,
            ok: /inservice/i.test(status)
        });
    }
    return rows;
}

function parseProcessor(text) {
    const rows = [];
    for (const line of String(text || '').split('\n')) {
        const t = line.trim();
        if (!t || /^Rack\b/i.test(t) || /^-+$/.test(t)) continue;
        const tok = t.split(/\s+/);
        if (tok.length < 8 || !/^\d+$/.test(tok[0])) continue;
        rows.push({
            slot: num(tok[2]),
            cpu5s: num(tok[3]),
            cpu1m: num(tok[4]),
            cpu5m: num(tok[5]),
            phyMemMb: num(tok[6]),
            memPct: num(tok[7])
        });
    }
    return rows;
}

function parseFan(text) {
    const t = String(text || '');
    const pick = (re) => {
        const m = t.match(re);
        return m ? m[1].trim() : null;
    };
    const fans = [];
    const fanSection = t.split(/All fan units actual status:/i)[1];
    if (fanSection) {
        for (const line of fanSection.split('\n')) {
            const tok = line.trim().split(/\s+/);
            if (tok.length === 3 && /^\d+$/.test(tok[0]) && /^\d+$/.test(tok[2])) {
                fans.push({ id: num(tok[0]), speedLevel: num(tok[1]), rpm: num(tok[2]) });
            }
        }
    }
    return {
        envTempC: num(pick(/Environment Temperature\s*:\s*(-?\d+)/)),
        highTempC: num(pick(/HighTemperatureThreshold\s*:\s*(-?\d+)/)),
        criticalTempC: num(pick(/CriticalTemperatureThreshold\s*:\s*(-?\d+)/)),
        lowTempC: num(pick(/LowTemperatureThreshold\s*:\s*(-?\d+)/)),
        powerMode: pick(/EnvPowerMode\s*:\s*(.+)/),
        upperFanboard: pick(/Upper Fanboard Status\s*:\s*(\S+)/),
        fans
    };
}

function parseIpInterfaceBrief(text) {
    const rows = [];
    for (const line of String(text || '').split('\n')) {
        const t = line.trim();
        if (!t || /^Interface\b/i.test(t)) continue;
        const tok = t.split(/\s+/);
        if (tok.length < 6) continue;
        rows.push({ interface: tok[0], ip: tok[1], mask: tok[2], admin: tok[3], phy: tok[4], prot: tok[5] });
    }
    return rows;
}

function parseVlanSummary(text) {
    const t = String(text || '');
    const count = num((t.match(/All created vlan num:\s*(\d+)/) || [])[1]);
    const listLine = (t.match(/^\s*([\d, ]+)\s*$/m) || [])[1];
    const list = listLine
        ? listLine
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
        : [];
    return { count, list };
}

/**
 * Parse `show interface <port>`. Kembalikan null bila port invalid (output %Error) atau
 * bukan baris status interface — supaya probe port yang tak ter-pasang dilewati.
 */
function parsePhysInterface(text, name) {
    const t = String(text || '');
    if (/%\s*Error/i.test(t)) return null;
    const head = t.match(/(\S+)\s+is\s+(up|down),\s*line protocol is\s+(up|down)/i);
    if (!head) return null;
    const rate = (re) => {
        const m = t.match(re);
        return m ? { bps: num(m[1]), pps: num(m[2]) } : { bps: null, pps: null };
    };
    const inR = rate(/input rate\s*:\s*(\d+)\s*Bps,\s*(\d+)\s*pps/i);
    const outR = rate(/output rate\s*:\s*(\d+)\s*Bps,\s*(\d+)\s*pps/i);
    const util = t.match(/Interface utilization:\s*input\s*([\d.]+)%,\s*output\s*([\d.]+)%/i);
    return {
        name: name || head[1],
        up: /up/i.test(head[2]),
        protoUp: /up/i.test(head[3]),
        media: (t.match(/The port is (\w+)/i) || [])[1] || null,
        duplex: (t.match(/Duplex (\w+)/i) || [])[1] || null,
        inBps: inR.bps,
        inPps: inR.pps,
        outBps: outR.bps,
        outPps: outR.pps,
        utilIn: util ? parseFloat(util[1]) : null,
        utilOut: util ? parseFloat(util[2]) : null,
        crcError: num((t.match(/CRC-ERROR\s*:\s*(\d+)/i) || [])[1]),
        drops: num((t.match(/Droppeds\s*:\s*(\d+)/i) || [])[1])
    };
}

/**
 * Turunkan nama port uplink dari daftar kartu: kartu INSERVICE yang BUKAN line-card GPON
 * (tidak diawali "GT") dianggap kartu kontrol/uplink. Format port: gei_<rack>/<slot>/<n>.
 */
function deriveUplinkPorts(cards) {
    const ports = [];
    for (const c of cards) {
        if (!c.ok) continue;
        const type = c.realType || c.cfgType || '';
        if (/^GT/i.test(type)) continue; // line-card GPON → port-nya PON, bukan uplink
        const count = Math.min(c.port || 0, MAX_UPLINK_PROBE);
        for (let i = 1; i <= count; i++) ports.push(`gei_${c.rack || 1}/${c.slot}/${i}`);
    }
    return ports;
}

// ── Alert turunan ────────────────────────────────────────────────────────────

function deriveAlerts(snapshot, thresholds = DEFAULT_THRESHOLDS) {
    const alerts = [];
    const add = (level, message) => alerts.push({ level, message });

    const tmp = snapshot.temperature;
    if (tmp && tmp.envTempC != null) {
        if (tmp.criticalTempC != null && tmp.envTempC >= tmp.criticalTempC) {
            add('critical', `Suhu ${tmp.envTempC}°C ≥ ambang KRITIS ${tmp.criticalTempC}°C`);
        } else if (tmp.highTempC != null && tmp.envTempC >= tmp.highTempC) {
            add('critical', `Suhu ${tmp.envTempC}°C ≥ ambang tinggi ${tmp.highTempC}°C`);
        } else if (tmp.highTempC != null && tmp.envTempC >= tmp.highTempC - thresholds.tempWarnMargin) {
            add('warn', `Suhu ${tmp.envTempC}°C mendekati ambang tinggi ${tmp.highTempC}°C`);
        }
    }
    for (const c of snapshot.cards || []) {
        if (!c.ok) add('warn', `Kartu slot ${c.slot} (${c.cfgType || c.realType || '-'}) status ${c.status}`);
    }
    for (const p of snapshot.processors || []) {
        if (p.cpu5m != null && p.cpu5m > thresholds.cpuPct) add('warn', `CPU slot ${p.slot} ${p.cpu5m}% (5m) tinggi`);
        if (p.memPct != null && p.memPct > thresholds.memPct) add('warn', `Memori slot ${p.slot} ${p.memPct}% tinggi`);
    }
    for (const u of snapshot.uplinks || []) {
        if (!u.up || !u.protoUp) add('critical', `Uplink ${u.name} DOWN`);
        else if (
            (u.utilIn != null && u.utilIn > thresholds.uplinkUtilPct) ||
            (u.utilOut != null && u.utilOut > thresholds.uplinkUtilPct)
        ) {
            add('warn', `Uplink ${u.name} hampir penuh (in ${u.utilIn}% / out ${u.utilOut}%)`);
        }
    }
    return alerts;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

function getThresholds() {
    const cfg = (global.config && global.config.olt && global.config.olt.healthThresholds) || {};
    return { ...DEFAULT_THRESHOLDS, ...cfg };
}

/**
 * Ambil snapshot kesehatan OLT. SATU sesi SSH read-only, serial per host, dengan cache TTL.
 * @param {object} device {host, sshPort, sshUsername, sshPassword}
 * @param {object} [opts] {force=false, ttlMs}
 * @returns {Promise<object>} snapshot { ok, fetchedAt, identity, temperature, cards, processors, uplinks, l3, vlans, storage, alerts, errors }
 */
async function getHealthSnapshot(device, opts = {}) {
    const host = device && device.host;
    const ttl = opts.ttlMs || CACHE_TTL_MS;
    const cached = host && cache.get(host);
    if (!opts.force && cached && Date.now() - cached.at < ttl) {
        return { ...cached.snapshot, cached: true };
    }

    return withHostLock(host, async () => {
        // Cek ulang cache di dalam lock (request paralel cukup 1 yang menembak OLT).
        const again = host && cache.get(host);
        if (!opts.force && again && Date.now() - again.at < ttl) {
            return { ...again.snapshot, cached: true };
        }

        const errors = [];
        let session = null;
        try {
            session = await openOltShell(device, { connectRetries: 1 });
        } catch (e) {
            const snap = { ok: false, fetchedAt: new Date().toISOString(), error: e.message, alerts: [] };
            return snap;
        }

        const safeExec = async (cmd) => {
            try {
                return await session.exec(cmd, { timeoutMs: 15000 });
            } catch (e) {
                errors.push({ cmd, error: e.message });
                return '';
            }
        };

        try {
            const cardRaw = await safeExec(CORE_COMMANDS.card);
            const cards = parseCard(cardRaw);

            const [sysRaw, procRaw, fanRaw, ipRaw, vlanRaw] = [
                await safeExec(CORE_COMMANDS.system),
                await safeExec(CORE_COMMANDS.processor),
                await safeExec(CORE_COMMANDS.fan),
                await safeExec(CORE_COMMANDS.ipIntf),
                await safeExec(CORE_COMMANDS.vlan)
            ];

            const uplinks = [];
            for (const port of deriveUplinkPorts(cards)) {
                const out = await safeExec(`show interface ${port}`);
                const parsed = parsePhysInterface(out, port);
                if (parsed) uplinks.push(parsed);
            }

            const snapshot = {
                ok: true,
                fetchedAt: new Date().toISOString(),
                identity: parseSystemGroup(sysRaw),
                temperature: parseFan(fanRaw),
                cards,
                processors: parseProcessor(procRaw),
                uplinks,
                l3: parseIpInterfaceBrief(ipRaw),
                vlans: parseVlanSummary(vlanRaw),
                storage: null, // belum tersedia via CLI ZXAN ini — kandidat SNMP
                errors
            };
            snapshot.alerts = deriveAlerts(snapshot, getThresholds());

            if (host) cache.set(host, { at: Date.now(), snapshot });
            return snapshot;
        } finally {
            try {
                session.close();
            } catch (_e) {
                /* abaikan */
            }
        }
    });
}

function resetHealthCache() {
    cache.clear();
}

module.exports = {
    getHealthSnapshot,
    deriveAlerts,
    deriveUplinkPorts,
    resetHealthCache,
    CORE_COMMANDS,
    DEFAULT_THRESHOLDS,
    // parser murni (untuk unit test)
    parseSystemGroup,
    parseCard,
    parseProcessor,
    parseFan,
    parseIpInterfaceBrief,
    parseVlanSummary,
    parsePhysInterface
};
