/**
 * Header Doc
 * Purpose: Helper SNMP promise-based bersama untuk driver OLT (get/walk, self-closing session).
 *          Dipakai driver brand non-HIOSO (mis. ZTE) & auto-deteksi brand di registry.
 * Caller: lib/olt-drivers/zte.js, lib/olt-drivers/index.js (detectBrand).
 * Deps: net-snmp.
 * MainFuncs: snmpGet, snmpWalk, buildSnmpConfig.
 * SideEffects: buka/tutup sesi UDP SNMP sementara per panggilan.
 */

const snmp = require('net-snmp');

/**
 * Normalisasi config device → opsi sesi net-snmp.
 * @param {object} cfg {host, port|snmpPort, community|snmpCommunity, timeout, retries}
 */
function buildSnmpConfig(cfg = {}) {
    return {
        host: cfg.host,
        community: cfg.community || cfg.snmpCommunity || 'public',
        port: cfg.port || cfg.snmpPort || 161,
        timeout: cfg.timeout || cfg.snmpTimeout || 15000,
        retries: cfg.retries != null ? cfg.retries : (cfg.snmpRetries != null ? cfg.snmpRetries : 1),
    };
}

function createSession(cfg) {
    const c = buildSnmpConfig(cfg);
    return snmp.createSession(c.host, c.community, {
        version: snmp.Version2c,
        port: c.port,
        timeout: c.timeout,
        retries: c.retries,
    });
}

/**
 * Decode satu varbind value → { type, value, raw } (raw = Buffer asli bila OctetString).
 */
function decodeVarbind(vb) {
    const type = snmp.ObjectType[vb.type] || String(vb.type);
    if (vb.value === null || vb.value === undefined) return { type, value: null, raw: null };
    if (Buffer.isBuffer(vb.value)) return { type, value: vb.value.toString('utf8'), raw: vb.value };
    if (type === 'TimeTicks') return { type, value: parseInt(vb.value.toString(), 10), raw: vb.value };
    return { type, value: vb.value.toString(), raw: vb.value };
}

/**
 * SNMP GET beberapa OID sekaligus.
 * @returns {Promise<Object<string,{type,value,raw}|null>>} map oid→decoded (null bila varbind error)
 */
function snmpGet(cfg, oids) {
    const list = Array.isArray(oids) ? oids : [oids];
    return new Promise((resolve, reject) => {
        const session = createSession(cfg);
        let settled = false;
        const done = (fn, arg) => { if (settled) return; settled = true; try { session.close(); } catch (_e) { /* ignore */ } fn(arg); };
        session.on('error', (e) => done(reject, e));
        session.get(list, (error, varbinds) => {
            if (error) return done(reject, error);
            const out = {};
            varbinds.forEach((vb, i) => {
                out[list[i]] = snmp.isVarbindError(vb) ? null : decodeVarbind(vb);
            });
            done(resolve, out);
        });
    });
}

/**
 * SNMP WALK satu base OID. Resolve array {oid, type, value, raw}.
 * @param {object} cfg
 * @param {string} baseOid
 * @param {object} [opts] {cap=8000, maxRepetitions=30}
 */
function snmpWalk(cfg, baseOid, opts = {}) {
    const cap = opts.cap || 8000;
    const maxRep = opts.maxRepetitions || 30;
    const normalizedBase = baseOid.startsWith('.') ? baseOid.slice(1) : baseOid;
    return new Promise((resolve, reject) => {
        const session = createSession(cfg);
        const rows = [];
        let settled = false;
        const done = (fn, arg) => { if (settled) return; settled = true; try { session.close(); } catch (_e) { /* ignore */ } fn(arg); };
        session.on('error', (e) => done(reject, e));

        const feed = (varbinds) => {
            for (const vb of varbinds) {
                if (vb.type === snmp.ObjectType.EndOfMibView ||
                    vb.type === snmp.ObjectType.NoSuchObject ||
                    vb.type === snmp.ObjectType.NoSuchInstance) {
                    done(resolve, rows); return true;
                }
                const oid = vb.oid.startsWith('.') ? vb.oid.slice(1) : vb.oid;
                if (!oid.startsWith(normalizedBase)) { done(resolve, rows); return true; }
                const d = decodeVarbind(vb);
                rows.push({ oid, type: d.type, value: d.value, raw: d.raw });
                if (rows.length >= cap) { done(resolve, rows); return true; }
            }
            return false;
        };

        session.walk(baseOid, maxRep, (varbinds) => { feed(varbinds); }, (err) => {
            if (err) return done(reject, err);
            done(resolve, rows);
        });
    });
}

module.exports = { snmpGet, snmpWalk, buildSnmpConfig };
