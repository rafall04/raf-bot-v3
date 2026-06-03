/**
 * Quick check apakah ONT 1/4 ada di SNMP tree
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log(`Host: ${oltConfig.host}\n`);

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 5000,
    retries: 1,
    port: oltConfig.port || 161
});

// GETNEXT dari OID sebelum target untuk melihat apa yang ada setelahnya
const baseOid = '1.3.6.1.4.1.25355.3.2.6.3.2.1.39.1.3'; // OID untuk slot 1, onu 3

session.getNext([baseOid], (error, varbinds) => {
    if (error) {
        console.log('Error:', error.message);
    } else {
        console.log('GETNEXT dari 1.3.6.1.4.1.25355.3.2.6.3.2.1.39.1.3:');
        varbinds.forEach(vb => {
            console.log(`  OID: ${vb.oid}`);
            console.log(`  Type: ${snmp.ObjectType[vb.type]}`);
            console.log(`  Value: ${vb.value}`);
            
            // Parse slot/onu dari OID
            const parts = vb.oid.split('.');
            const onu = parts[parts.length - 1];
            const slot = parts[parts.length - 2];
            console.log(`  -> Slot ${slot} / ONU ${onu}`);
            
            if (slot === '1' && onu === '4') {
                console.log('\n✓ ONT 1/4 EXISTS in SNMP tree');
            } else {
                console.log(`\n✗ ONT 1/4 NOT in SNMP tree (next is ${slot}/${onu})`);
                console.log('  Ini berarti ONT 1/4 dalam kondisi DYING GASP');
            }
        });
    }
    
    session.close();
    process.exit(0);
});

// Timeout
setTimeout(() => {
    console.log('Timeout!');
    session.close();
    process.exit(1);
}, 10000);
