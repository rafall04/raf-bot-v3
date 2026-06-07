/**
 * FAST DEBUG - Cek langsung OID spesifik untuk ONT yang match
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

const TARGET_MAC_PREFIX = 'C0F6EC1EFF';

console.log('FAST DEBUG - Finding ONT with MAC prefix:', TARGET_MAC_PREFIX);
console.log('Host:', oltConfig.host);
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 10000,
    retries: 1,
    port: oltConfig.port || 161
});

// Walk MAC dengan limit dan stop saat ketemu
const MAC_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1.11';

let foundSlot = null;
let foundOnu = null;
let count = 0;

console.log('Walking MAC OID (will stop when found)...');

session.walk(MAC_OID, (varbinds) => {
    for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        count++;
        
        const parts = vb.oid.split('.');
        const onuId = parts[parts.length - 1];
        const slotId = parts[parts.length - 2];
        
        const macHex = vb.value.toString().toUpperCase();
        const macPrefix = macHex.substring(0, 10);
        
        if (macPrefix === TARGET_MAC_PREFIX) {
            foundSlot = slotId;
            foundOnu = onuId;
            console.log(`\nFOUND at count ${count}!`);
            console.log(`  Slot/ONU: ${slotId}/${onuId}`);
            console.log(`  MAC: ${macHex.match(/.{2}/g).join(':')}`);
            // Don't break - let walk continue to see if there are more
        }
    }
}, async (_error) => {
    console.log(`\nWalk completed. Total MACs scanned: ${count}`);
    
    if (!foundSlot) {
        console.log('NO MATCH FOUND');
        session.close();
        process.exit(0);
    }
    
    // Now check specific OIDs for this ONT
    console.log(`\nChecking specific OIDs for Slot ${foundSlot} / ONU ${foundOnu}...`);
    
    const oids = [
        `1.3.6.1.4.1.25355.3.2.6.3.2.1.39.${foundSlot}.${foundOnu}`,  // phaseState
        `1.3.6.1.4.1.25355.3.2.6.3.2.1.40.${foundSlot}.${foundOnu}`,  // dyingGasp
        `1.3.6.1.4.1.25355.3.2.6.14.2.1.8.${foundSlot}.${foundOnu}`,  // rxPower
    ];
    const oidNames = ['phaseState', 'dyingGasp', 'rxPower'];
    
    session.get(oids, (err, varbinds) => {
        if (err) {
            console.log('GET Error:', err.message);
        } else {
            console.log('\nRESULTS:');
            console.log('-'.repeat(50));
            
            varbinds.forEach((vb, i) => {
                let value = '';
                let exists = true;
                
                if (vb.type === snmp.ObjectType.NoSuchInstance) {
                    value = 'NOT FOUND (NoSuchInstance)';
                    exists = false;
                } else if (vb.type === snmp.ObjectType.NoSuchObject) {
                    value = 'NOT FOUND (NoSuchObject)';
                    exists = false;
                } else {
                    value = vb.value.toString();
                    if (oidNames[i] === 'phaseState') {
                        const meanings = {1: 'Online', 2: 'LOS', 3: 'Sync', 4: 'AuthFail', 5: 'Offline'};
                        value += ` (${meanings[value] || 'Unknown'})`;
                    }
                }
                
                console.log(`${oidNames[i].padEnd(12)}: ${value}`);
            });
            
            // Diagnosis
            const hasPhase = varbinds[0].type !== snmp.ObjectType.NoSuchInstance && varbinds[0].type !== snmp.ObjectType.NoSuchObject;
            const hasRx = varbinds[2].type !== snmp.ObjectType.NoSuchInstance && varbinds[2].type !== snmp.ObjectType.NoSuchObject;
            
            console.log('\n' + '='.repeat(50));
            console.log('DIAGNOSIS:');
            if (!hasPhase && !hasRx) {
                console.log('  -> DYING GASP (MAC ada, tapi phaseState & rxPower tidak ada)');
            } else if (hasPhase && varbinds[0].value.toString() === '2') {
                console.log('  -> LOS (phaseState = 2)');
            } else if (hasPhase && varbinds[0].value.toString() === '1') {
                console.log('  -> ONLINE (phaseState = 1)');
            } else {
                console.log('  -> Status: phaseState=' + (hasPhase ? varbinds[0].value : 'N/A'));
            }
        }
        
        session.close();
        process.exit(0);
    });
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 60000);
