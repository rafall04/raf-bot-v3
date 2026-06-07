/**
 * Check detail ONT 1/4 - semua OID
 */
const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log(`Checking ONT Slot 1 / ONU 4\n`);

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 5000,
    retries: 1,
    port: oltConfig.port || 161
});

// OIDs untuk slot 1, onu 4
const oids = [
    '1.3.6.1.4.1.25355.3.2.6.3.2.1.11.1.4',  // MAC
    '1.3.6.1.4.1.25355.3.2.6.3.2.1.39.1.4',  // phaseState
    '1.3.6.1.4.1.25355.3.2.6.3.2.1.40.1.4',  // dyingGasp
    '1.3.6.1.4.1.25355.3.2.6.14.2.1.8.1.4',  // rxPower
];

const oidNames = ['MAC', 'phaseState', 'dyingGasp', 'rxPower'];

session.get(oids, (error, varbinds) => {
    if (error) {
        console.log('Error:', error.message);
    } else {
        varbinds.forEach((vb, i) => {
            let value = '';
            
            if (vb.type === snmp.ObjectType.NoSuchInstance) {
                value = 'NoSuchInstance (OID tidak ada)';
            } else if (vb.type === snmp.ObjectType.NoSuchObject) {
                value = 'NoSuchObject';
            } else if (vb.type === snmp.ObjectType.OctetString) {
                value = vb.value.toString('hex').toUpperCase();
                if (value.length === 12) {
                    value = value.match(/.{2}/g).join(':') + ` (${value})`;
                }
            } else {
                value = vb.value.toString();
            }
            
            console.log(`${oidNames[i].padEnd(12)}: ${value}`);
        });
    }
    
    session.close();
    process.exit(0);
});

setTimeout(() => {
    session.close();
    process.exit(1);
}, 10000);
