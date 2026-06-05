/**
 * Discovery walk OLT ZTE C320 — capture OID tree untuk bangun driver GPON.
 * Walk beberapa subtree kandidat, simpan tiap subtree ke file + ringkasan sample.
 * Usage: node scripts/olt-zte-discovery.js [host] [community] [port]
 *
 * READ-ONLY (getNext/bulk). Tidak mengubah apa pun di OLT.
 */
const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const host = process.argv[2] || '103.171.83.121';
const community = process.argv[3] || 'onewanro';
const port = parseInt(process.argv[4], 10) || 1601;

const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Subtree kandidat. Label deskriptif → base OID.
// Sumber: struktur umum ZXAN/ZTE GPON MIB (3902.1012 gpon, 3902.1015 zxAnPon,
// 3902.1082 product). Kita walk & lihat datanya nyata, bukan tebak.
const TARGETS = [
    ['ifDescr (1.3.6.1.2.1.2.2.1.2)', '1.3.6.1.2.1.2.2.1.2'],
    ['ifName (1.3.6.1.2.1.31.1.1.1.1)', '1.3.6.1.2.1.31.1.1.1.1'],
    ['gpon-onu-mgmt 3902.1012.3.28', '1.3.6.1.4.1.3902.1012.3.28'],
    ['gpon-optical 3902.1012.3.50', '1.3.6.1.4.1.3902.1012.3.50'],
    ['gpon-onu 3902.1012.3.11', '1.3.6.1.4.1.3902.1012.3.11'],
    ['zxAnPon 3902.1015', '1.3.6.1.4.1.3902.1015'],
];

const PER_BASE_CAP = 800; // batasi varbind per subtree biar tidak kebanjiran

function decodeValue(vb) {
    if (snmp.isVarbindError(vb)) return { type: 'ERR', value: snmp.varbindError(vb) };
    const t = snmp.ObjectType[vb.type] || vb.type;
    let v = vb.value;
    if (Buffer.isBuffer(v)) {
        const utf = v.toString('utf8').replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '');
        const hex = v.toString('hex');
        v = `str="${utf}" hex=${hex}`;
    }
    return { type: t, value: String(v) };
}

function walkBase(label, baseOid) {
    return new Promise((resolve) => {
        const session = snmp.createSession(host, community, {
            version: snmp.Version2c, port, timeout: 8000, retries: 1,
        });
        const rows = [];
        let done = false;
        const finish = () => {
            if (done) return; done = true;
            try { session.close(); } catch (e) { /* ignore */ }
            resolve({ label, baseOid, rows });
        };
        session.on('error', (e) => { rows.push(`# session-error: ${e.message}`); finish(); });

        const feed = (varbinds) => {
            for (const vb of varbinds) {
                if (vb.type === snmp.ObjectType.EndOfMibView) { finish(); return true; }
                const d = decodeValue(vb);
                rows.push(`${vb.oid}\t${d.type}\t${d.value}`);
                if (rows.length >= PER_BASE_CAP) { finish(); return true; }
            }
            return false;
        };
        session.walk(baseOid, 30, (vbs) => { feed(vbs); }, (err) => {
            if (err) rows.push(`# walk-error: ${err.message}`);
            finish();
        });
    });
}

(async () => {
    console.log(`[DISCOVERY] ${host}:${port} community=${community}`);
    const summary = [];
    for (const [label, base] of TARGETS) {
        process.stdout.write(`  walking ${label} ... `);
        const t0 = Date.now();
        const { rows } = await walkBase(label, base);
        const ms = Date.now() - t0;
        const safe = base.replace(/[^0-9]/g, '_');
        const file = path.join(OUT_DIR, `zte-${safe}.txt`);
        fs.writeFileSync(file, `# ${label}\n# base=${base}\n# count=${rows.length}\n\n${rows.join('\n')}\n`, 'utf8');
        const dataRows = rows.filter((r) => !r.startsWith('#'));
        console.log(`${dataRows.length} oids (${ms}ms) → ${path.relative(process.cwd(), file)}`);
        summary.push({ label, base, count: dataRows.length, sample: dataRows.slice(0, 3) });
    }
    console.log('\n[DISCOVERY] ringkasan:');
    summary.forEach((s) => {
        console.log(`\n### ${s.label} — ${s.count} oids`);
        s.sample.forEach((r) => console.log('   ' + r.slice(0, 160)));
    });
    process.exit(0);
})();
