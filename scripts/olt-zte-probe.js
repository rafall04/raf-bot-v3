/**
 * Probe identifikasi cepat OLT (sebelum walk besar).
 * Usage: node scripts/olt-zte-probe.js [host] [community] [port]
 */
const snmp = require('net-snmp');

const host = process.argv[2] || '103.171.83.121';
const community = process.argv[3] || 'onewanro';
const port = parseInt(process.argv[4], 10) || 1601;

const OIDS = {
    sysDescr: '1.3.6.1.2.1.1.1.0',
    sysObjectID: '1.3.6.1.2.1.1.2.0',
    sysUpTime: '1.3.6.1.2.1.1.3.0',
    sysContact: '1.3.6.1.2.1.1.4.0',
    sysName: '1.3.6.1.2.1.1.5.0',
    sysLocation: '1.3.6.1.2.1.1.6.0',
};

console.log(`[PROBE] target=${host}:${port} community=${community} v2c`);

const session = snmp.createSession(host, community, {
    version: snmp.Version2c,
    port,
    timeout: 8000,
    retries: 1,
});

const oids = Object.values(OIDS);
const keys = Object.keys(OIDS);

session.get(oids, (error, varbinds) => {
    if (error) {
        console.error('[PROBE] ERROR:', error.message);
        session.close();
        process.exit(2);
    }
    varbinds.forEach((vb, i) => {
        if (snmp.isVarbindError(vb)) {
            console.log(`  ${keys[i].padEnd(12)} : <${snmp.varbindError(vb)}>`);
        } else {
            let val = vb.value;
            if (Buffer.isBuffer(val)) val = val.toString('utf8');
            console.log(`  ${keys[i].padEnd(12)} : ${val}`);
        }
    });

    // Ekstrak enterprise number dari sysObjectID untuk tebak brand.
    const soid = varbinds[1] && !snmp.isVarbindError(varbinds[1]) ? String(varbinds[1].value) : '';
    const m = soid.match(/^1\.3\.6\.1\.4\.1\.(\d+)/);
    if (m) {
        const ent = m[1];
        const map = { '3902': 'ZTE (ZXAN)', '25355': 'HIOSO', '17409': 'VSOL?', '5875': 'BDCOM-family?' };
        console.log(`\n[PROBE] enterprise=${ent} → ${map[ent] || 'UNKNOWN (perlu cek MIB)'}`);
    }
    session.close();
    process.exit(0);
});

session.on('error', (e) => {
    console.error('[PROBE] session error:', e.message);
});
