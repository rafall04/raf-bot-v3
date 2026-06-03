/**
 * Debug script untuk list semua ONT yang ada di OLT
 * Jalankan: node scripts/debug-list-onts.js
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

// Load config
const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log(`\n=== LIST ALL ONTs ===`);
console.log(`Host: ${oltConfig.host}`);
console.log(`====================\n`);

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 1,
    port: oltConfig.port || 161
});

// Walk phaseState untuk melihat semua ONT
const PHASE_STATE_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1.39';

function walkOid(baseOid) {
    return new Promise((resolve) => {
        const results = [];
        
        session.walk(baseOid, (varbinds) => {
            for (const vb of varbinds) {
                if (snmp.isVarbindError(vb)) continue;
                
                const parts = vb.oid.split('.');
                const onuId = parts[parts.length - 1];
                const slotId = parts[parts.length - 2];
                
                results.push({
                    slot: slotId,
                    onu: onuId,
                    value: vb.value.toString()
                });
            }
        }, (error) => {
            if (error) console.log('Walk error:', error.message);
            resolve(results);
        });
        
        // Timeout after 30 seconds
        setTimeout(() => resolve(results), 30000);
    });
}

async function main() {
    console.log('Walking phaseState OID to list all ONTs...\n');
    
    const results = await walkOid(PHASE_STATE_OID);
    
    console.log('Slot/ONU | phaseState | Status');
    console.log('---------|------------|--------');
    
    results.forEach(r => {
        let status = 'Unknown';
        switch(r.value) {
            case '1': status = 'Online'; break;
            case '2': status = 'LOS'; break;
            case '3': status = 'Sync'; break;
            case '4': status = 'AuthFail'; break;
            case '5': status = 'Offline'; break;
        }
        console.log(`${r.slot}/${r.onu.padStart(3)}    | ${r.value.padStart(10)} | ${status}`);
    });
    
    // Check if slot 1 onu 4 exists
    const target = results.find(r => r.slot === '1' && r.onu === '4');
    console.log(`\n=== Target ONT (1/4) ===`);
    if (target) {
        console.log(`Found! phaseState = ${target.value}`);
    } else {
        console.log(`NOT FOUND in SNMP tree!`);
        console.log(`Ini menunjukkan ONT dalam kondisi DYING GASP (adaptor mati)`);
        console.log(`atau ONT belum pernah terdaftar di OLT.`);
    }
    
    console.log(`\nTotal ONTs found: ${results.length}`);
    
    session.close();
    process.exit(0);
}

main();
