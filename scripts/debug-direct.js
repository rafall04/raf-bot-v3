/**
 * DIRECT DEBUG - Langsung GET OID untuk slot 1/onu 4
 * Berdasarkan hasil sebelumnya, kita tahu ONT ada di slot 1/onu 4
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

// Target ONT dari hasil debug sebelumnya
const SLOT = '1';
const ONU = '4';

console.log('DIRECT DEBUG - GET specific OIDs for Slot', SLOT, '/ ONU', ONU);
console.log('Host:', oltConfig.host);
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 10000,
    retries: 2,
    port: oltConfig.port || 161
});

// OIDs untuk slot 1, onu 4
const oids = [
    `1.3.6.1.4.1.25355.3.2.6.3.2.1.11.${SLOT}.${ONU}`,   // MAC
    `1.3.6.1.4.1.25355.3.2.6.3.2.1.39.${SLOT}.${ONU}`,   // phaseState
    `1.3.6.1.4.1.25355.3.2.6.3.2.1.40.${SLOT}.${ONU}`,   // dyingGasp
    `1.3.6.1.4.1.25355.3.2.6.14.2.1.8.${SLOT}.${ONU}`,   // rxPower
];
const oidNames = ['MAC', 'phaseState', 'dyingGasp', 'rxPower'];

console.log('Getting OIDs:');
oids.forEach((oid, i) => console.log(`  ${oidNames[i]}: ${oid}`));
console.log('');

session.get(oids, (err, varbinds) => {
    if (err) {
        console.log('GET Error:', err.message);
        session.close();
        process.exit(1);
    }
    
    console.log('RESULTS:');
    console.log('='.repeat(60));
    
    let hasPhase = false;
    let hasRx = false;
    let hasMac = false;
    let phaseValue = null;
    
    varbinds.forEach((vb, i) => {
        let value = '';
        let exists = true;
        
        if (vb.type === snmp.ObjectType.NoSuchInstance) {
            value = '*** NOT FOUND (NoSuchInstance) ***';
            exists = false;
        } else if (vb.type === snmp.ObjectType.NoSuchObject) {
            value = '*** NOT FOUND (NoSuchObject) ***';
            exists = false;
        } else if (vb.type === snmp.ObjectType.OctetString) {
            const hex = vb.value.toString('hex').toUpperCase();
            if (hex.length === 12) {
                value = hex.match(/.{2}/g).join(':');
            } else {
                value = vb.value.toString();
            }
        } else {
            value = vb.value.toString();
        }
        
        // Track what exists
        if (oidNames[i] === 'MAC' && exists) hasMac = true;
        if (oidNames[i] === 'phaseState' && exists) {
            hasPhase = true;
            phaseValue = vb.value.toString();
            const meanings = {'1': 'Online', '2': 'LOS', '3': 'Sync', '4': 'AuthFail', '5': 'Offline'};
            value += ` -> ${meanings[phaseValue] || 'Unknown'}`;
        }
        if (oidNames[i] === 'rxPower' && exists) hasRx = true;
        
        console.log(`${oidNames[i].padEnd(12)}: ${value}`);
    });
    
    // Diagnosis
    console.log('');
    console.log('='.repeat(60));
    console.log('DIAGNOSIS:');
    console.log(`  MAC exists: ${hasMac}`);
    console.log(`  phaseState exists: ${hasPhase} ${hasPhase ? '(value: ' + phaseValue + ')' : ''}`);
    console.log(`  rxPower exists: ${hasRx}`);
    console.log('');
    
    if (hasMac && !hasPhase && !hasRx) {
        console.log('  RESULT: *** DYING GASP ***');
        console.log('  (MAC ada di OLT tapi phaseState dan rxPower tidak ada)');
    } else if (hasPhase && phaseValue === '2') {
        console.log('  RESULT: *** LOS (Loss of Signal) ***');
        console.log('  (phaseState = 2)');
    } else if (hasPhase && phaseValue === '1') {
        console.log('  RESULT: *** ONLINE ***');
        console.log('  (phaseState = 1)');
    } else if (!hasMac && !hasPhase && !hasRx) {
        console.log('  RESULT: *** ONT NOT REGISTERED ***');
        console.log('  (Tidak ada data sama sekali di OLT)');
    } else {
        console.log('  RESULT: *** UNKNOWN STATUS ***');
    }
    
    session.close();
    process.exit(0);
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 30000);
