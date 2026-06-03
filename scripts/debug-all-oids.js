/**
 * DEBUG ALL OIDs - Walk semua OID di area ONT untuk menemukan yang bisa membedakan LOS vs Dying Gasp
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log('=== DEBUG ALL OIDs ===');
console.log('Host:', oltConfig.host);
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 1,
    port: oltConfig.port || 161
});

// OID dengan suffix yang benar (1.1.4)
const SUFFIX = '1.1.4';
const BASE_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1';

// Query banyak OID sekaligus untuk melihat semua data yang tersedia
const oids = [];
const oidNames = [];

// OID 35-50 untuk melihat semua field yang tersedia
for (let i = 35; i <= 50; i++) {
    oids.push(`${BASE_OID}.${i}.${SUFFIX}`);
    oidNames.push(`oid_${i}`);
}

console.log('Querying OIDs 35-50...');
console.log('');

session.get(oids, (err, varbinds) => {
    if (err) {
        console.log('SNMP Error:', err.message);
        session.close();
        process.exit(1);
    }
    
    console.log('=== HASIL ===');
    console.log('');
    
    varbinds.forEach((vb, i) => {
        let value = 'N/A';
        let typeStr = '';
        
        if (vb.type === snmp.ObjectType.NoSuchInstance) {
            value = 'NoSuchInstance';
            typeStr = '(not found)';
        } else if (vb.type === snmp.ObjectType.NoSuchObject) {
            value = 'NoSuchObject';
            typeStr = '(not found)';
        } else {
            value = vb.value?.toString() || 'null';
            typeStr = `(type: ${vb.type})`;
        }
        
        const oidNum = 35 + i;
        console.log(`OID .${oidNum}: ${value} ${typeStr}`);
    });
    
    console.log('');
    console.log('=== CATATAN ===');
    console.log('OID .37 = name');
    console.log('OID .39 = phaseState (1=online, 2=offline)');
    console.log('OID .40 = dyingGasp flag');
    console.log('OID .41 = lastDownCause');
    console.log('');
    console.log('Cari OID yang nilainya BERBEDA antara:');
    console.log('- Adaptor dicabut (Dying Gasp)');
    console.log('- Fiber dicabut (LOS)');
    
    session.close();
    process.exit(0);
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 20000);
