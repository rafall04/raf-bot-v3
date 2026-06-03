/**
 * DEBUG MORE OIDs - Cek OID di area lain untuk menemukan perbedaan LOS vs Dying Gasp
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log('=== DEBUG MORE OIDs ===');
console.log('Host:', oltConfig.host);
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 1,
    port: oltConfig.port || 161
});

const SUFFIX = '1.1.4';
const BASE_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1';

// Query OID 1-34 juga
const oids = [];

for (let i = 1; i <= 34; i++) {
    oids.push(`${BASE_OID}.${i}.${SUFFIX}`);
}

console.log('Querying OIDs 1-34...');
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
        
        if (vb.type === snmp.ObjectType.NoSuchInstance) {
            value = 'NoSuchInstance';
        } else if (vb.type === snmp.ObjectType.NoSuchObject) {
            value = 'NoSuchObject';
        } else if (vb.type === snmp.ObjectType.OctetString) {
            // Coba decode sebagai hex untuk MAC
            const hex = vb.value.toString('hex').toUpperCase();
            if (hex.length === 12) {
                value = hex.match(/.{2}/g).join(':') + ' (MAC)';
            } else {
                value = vb.value.toString() || hex;
            }
        } else {
            value = vb.value?.toString() || 'null';
        }
        
        const oidNum = 1 + i;
        // Hanya tampilkan yang ada nilainya
        if (value !== 'NoSuchInstance' && value !== 'NoSuchObject') {
            console.log(`OID .${oidNum}: ${value}`);
        }
    });
    
    session.close();
    process.exit(0);
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 20000);
