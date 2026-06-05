/**
 * Analisa kolom satu base OID di OLT ZTE — walk penuh lalu group per kolom.
 * Untuk tiap kolom (OID tanpa index ONU): count, tipe, 3 sample, range integer.
 * Usage: node scripts/olt-zte-columns.js <baseOid> [host] [community] [port]
 */
const snmp = require('net-snmp');

const baseOid = process.argv[2];
const host = process.argv[3] || '103.171.83.121';
const community = process.argv[4] || 'onewanro';
const port = parseInt(process.argv[5], 10) || 1601;
const CAP = 6000;

if (!baseOid) { console.error('baseOid wajib'); process.exit(1); }

function colOf(oid) {
    // Kolom = OID tanpa index ONU. Index ONU ZTE = <ponIfIndex>.<onuId>,
    // ponIfIndex besar (≥6 digit, mis. 268566784), onuId kecil. Pangkas pola itu saja.
    return oid.replace(/\.\d{6,}\.\d+$/, '');
}

const session = snmp.createSession(host, community, {
    version: snmp.Version2c, port, timeout: 8000, retries: 1,
});

const cols = new Map(); // col -> {type, count, samples:[], ints:[]}
let total = 0, done = false;

function finish() {
    if (done) return; done = true;
    try { session.close(); } catch (e) { /* ignore */ }
    console.log(`\n[COLUMNS] base=${baseOid} total=${total} kolom=${cols.size}\n`);
    for (const [col, info] of cols) {
        let extra = '';
        if (info.ints.length) {
            const mn = Math.min(...info.ints), mx = Math.max(...info.ints);
            extra = `  int[min=${mn} max=${mx}]`;
        }
        console.log(`${col}  (${info.type}, n=${info.count})${extra}`);
        info.samples.slice(0, 3).forEach((s) => console.log(`     idx ${s.idx}  =  ${s.val.slice(0, 90)}`));
    }
    process.exit(0);
}

session.on('error', (e) => { console.error('session error:', e.message); finish(); });

session.walk(baseOid, 30, (varbinds) => {
    for (const vb of varbinds) {
        if (vb.type === snmp.ObjectType.EndOfMibView) { finish(); return; }
        total++;
        const col = colOf(vb.oid);
        const idx = vb.oid.slice(col.length + 1);
        let val = vb.value, isInt = false;
        const tname = snmp.ObjectType[vb.type] || String(vb.type);
        if (Buffer.isBuffer(val)) {
            val = `str="${val.toString('utf8').replace(/[\x00-\x1F\x7F]/g, '')}" hex=${val.toString('hex')}`;
        } else if (tname === 'Integer' || tname === 'Counter' || tname === 'Gauge') {
            isInt = true; val = String(val);
        } else { val = String(val); }
        if (!cols.has(col)) cols.set(col, { type: tname, count: 0, samples: [], ints: [] });
        const info = cols.get(col);
        info.count++;
        if (info.samples.length < 3) info.samples.push({ idx, val });
        if (isInt) { const n = parseInt(vb.value, 10); if (!Number.isNaN(n)) info.ints.push(n); }
        if (total >= CAP) { finish(); return; }
    }
}, (err) => { if (err) console.error('walk-error:', err.message); finish(); });
