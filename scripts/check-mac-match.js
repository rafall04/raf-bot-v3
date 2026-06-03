/**
 * Check MAC matching untuk tes@hw
 */
const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

// MAC dari cache untuk tes@hw
const targetMac = 'C0:F6:EC:1E:FF:DB';
const targetMacPrefix = targetMac.replace(/:/g, '').substring(0, 10).toUpperCase();

console.log(`Target MAC: ${targetMac}`);
console.log(`Target MAC Prefix (10 chars): ${targetMacPrefix}`);
console.log(`Host: ${oltConfig.host}\n`);

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 1,
    port: oltConfig.port || 161
});

// Walk MAC OID
const MAC_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1.11';

function formatMac(hexStr) {
    if (typeof hexStr !== 'string' || hexStr.length !== 12) return hexStr;
    return hexStr.match(/.{2}/g).join(':').toUpperCase();
}

session.walk(MAC_OID, (varbinds) => {
    for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        
        const parts = vb.oid.split('.');
        const onuId = parts[parts.length - 1];
        const slotId = parts[parts.length - 2];
        
        const macHex = vb.value.toString();
        const macFormatted = formatMac(macHex);
        const macPrefix = macHex.substring(0, 10).toUpperCase();
        
        // Check if this MAC matches our target
        if (macPrefix === targetMacPrefix) {
            console.log(`*** MATCH FOUND ***`);
            console.log(`  Slot/ONU: ${slotId}/${onuId}`);
            console.log(`  MAC: ${macFormatted}`);
            console.log(`  MAC Prefix: ${macPrefix}`);
        }
    }
}, (error) => {
    if (error) console.log('Walk error:', error.message);
    console.log('\nDone.');
    session.close();
    process.exit(0);
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 30000);
