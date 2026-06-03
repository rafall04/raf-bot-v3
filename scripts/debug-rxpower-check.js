/**
 * DEBUG RXPOWER CHECK - Cek apakah rxPower bisa membedakan LOS vs Dying Gasp
 * 
 * Hipotesis baru:
 * - LOS (fiber dicabut): ONT masih hidup, tapi rxPower = N/A atau sangat rendah
 * - Dying Gasp (adaptor mati): ONT mati, rxPower = N/A
 * 
 * Mungkin tidak bisa dibedakan dari rxPower saja...
 * 
 * Pendekatan alternatif:
 * - Cek apakah ada OID alarm yang berbeda
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log('=== DEBUG RXPOWER & ALARM CHECK ===');
console.log('Host:', oltConfig.host);
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 1,
    port: oltConfig.port || 161
});

const SUFFIX = '1.1.4';

// OIDs to check
const oids = [
    // RX Power
    `1.3.6.1.4.1.25355.3.2.6.14.2.1.8.${SUFFIX}`,
    // TX Power
    `1.3.6.1.4.1.25355.3.2.6.14.2.1.4.${SUFFIX}`,
    // Phase State
    `1.3.6.1.4.1.25355.3.2.6.3.2.1.39.${SUFFIX}`,
    // Dying Gasp flag
    `1.3.6.1.4.1.25355.3.2.6.3.2.1.40.${SUFFIX}`,
    // Last Down Cause
    `1.3.6.1.4.1.25355.3.2.6.3.2.1.41.${SUFFIX}`,
    // OID 42 (unknown)
    `1.3.6.1.4.1.25355.3.2.6.3.2.1.42.${SUFFIX}`,
];

const oidNames = ['rxPower', 'txPower', 'phaseState', 'dyingGasp', 'lastDownCause', 'oid42'];

console.log('Querying key OIDs...');
console.log('');

session.get(oids, (err, varbinds) => {
    if (err) {
        console.log('SNMP Error:', err.message);
        session.close();
        process.exit(1);
    }
    
    console.log('=== HASIL ===');
    console.log('');
    
    const results = {};
    
    varbinds.forEach((vb, i) => {
        let value = 'N/A';
        
        if (vb.type === snmp.ObjectType.NoSuchInstance) {
            value = 'NoSuchInstance';
        } else if (vb.type === snmp.ObjectType.NoSuchObject) {
            value = 'NoSuchObject';
        } else if (vb.type === snmp.ObjectType.OctetString) {
            const str = vb.value.toString().trim();
            if (str.toLowerCase() === 'na' || str === '') {
                value = 'N/A (string)';
            } else {
                value = str;
            }
        } else {
            value = vb.value?.toString() || 'null';
        }
        
        results[oidNames[i]] = value;
        console.log(`${oidNames[i].padEnd(15)}: ${value}`);
    });
    
    console.log('');
    console.log('=== ANALISIS ===');
    console.log('');
    console.log('Kondisi saat ini (fiber dicabut = LOS):');
    console.log('- phaseState = 2 (offline)');
    console.log('- dyingGasp = 0');
    console.log('- lastDownCause = 1');
    console.log('');
    console.log('Kondisi sebelumnya (adaptor dicabut = Dying Gasp):');
    console.log('- phaseState = 2 (offline)');
    console.log('- dyingGasp = 0');
    console.log('- lastDownCause = 1');
    console.log('');
    console.log('KESIMPULAN:');
    console.log('OLT HIOSO TIDAK MEMBEDAKAN LOS vs Dying Gasp melalui SNMP!');
    console.log('');
    console.log('Kedua kondisi menghasilkan nilai yang SAMA:');
    console.log('- phaseState = 2');
    console.log('- lastDownCause = 1');
    console.log('');
    console.log('REKOMENDASI:');
    console.log('Gunakan status generik "Offline" untuk kedua kondisi,');
    console.log('atau tampilkan sebagai "LOS/Dying Gasp" tanpa membedakan.');
    
    session.close();
    process.exit(0);
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 20000);
