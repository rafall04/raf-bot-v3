/**
 * DEBUG LAST DOWN CAUSE
 * Cek nilai lastDownCause untuk membedakan LOS vs Dying Gasp
 * 
 * Dari hasil sebelumnya:
 * - phaseState = 2 (LOS) untuk semua kondisi offline
 * - lastDownCause = 1 saat adaptor dicabut
 * 
 * Perlu cek nilai lastDownCause saat:
 * 1. Adaptor dicabut (Dying Gasp) - lastDownCause = ?
 * 2. Fiber dicabut (LOS) - lastDownCause = ?
 * 3. Online normal - lastDownCause = ?
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

// OID dengan suffix yang benar (1.1.4)
const SUFFIX = '1.1.4';
const BASE_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1';

// Walk lastDownCause untuk semua ONT
const LAST_DOWN_CAUSE_OID = `${BASE_OID}.41`;

console.log('=== DEBUG LAST DOWN CAUSE ===');
console.log('Host:', oltConfig.host);
console.log('');
console.log('Walking lastDownCause OID:', LAST_DOWN_CAUSE_OID);
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 1,
    port: oltConfig.port || 161
});

// Juga query beberapa OID lain untuk referensi
const OIDS_TO_CHECK = {
    phaseState: `${BASE_OID}.39.${SUFFIX}`,
    dyingGasp: `${BASE_OID}.40.${SUFFIX}`,
    lastDownCause: `${BASE_OID}.41.${SUFFIX}`,
    // Coba OID lain yang mungkin relevan
    oid_42: `${BASE_OID}.42.${SUFFIX}`,
    oid_38: `${BASE_OID}.38.${SUFFIX}`,
};

console.log('Direct GET untuk ONT slot 1 / onu 4:');
console.log('');

const oidList = Object.values(OIDS_TO_CHECK);
const oidNames = Object.keys(OIDS_TO_CHECK);

session.get(oidList, (err, varbinds) => {
    if (err) {
        console.log('SNMP Error:', err.message);
        session.close();
        process.exit(1);
    }
    
    console.log('=== HASIL GET ===');
    console.log('');
    
    varbinds.forEach((vb, i) => {
        const name = oidNames[i];
        let value = 'N/A';
        
        if (vb.type === snmp.ObjectType.NoSuchInstance) {
            value = 'NoSuchInstance';
        } else if (vb.type === snmp.ObjectType.NoSuchObject) {
            value = 'NoSuchObject';
        } else {
            value = vb.value.toString();
        }
        
        console.log(`${name.padEnd(15)}: ${value}`);
    });
    
    console.log('');
    console.log('=== INTERPRETASI lastDownCause ===');
    console.log('');
    console.log('Kemungkinan nilai lastDownCause:');
    console.log('  0 = Normal / No down');
    console.log('  1 = Power failure / Dying Gasp');
    console.log('  2 = LOS (Loss of Signal)');
    console.log('  3 = LOF (Loss of Frame)');
    console.log('  4 = LOA (Loss of Ack)');
    console.log('  5 = Deactivate');
    console.log('');
    console.log('Catatan: Nilai ini perlu diverifikasi dengan dokumentasi HIOSO');
    
    session.close();
    process.exit(0);
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 30000);
