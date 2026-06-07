/**
 * Quick debug script - hanya ambil 10 ONT pertama
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log(`Host: ${oltConfig.host}`);

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 5000,
    retries: 1,
    port: oltConfig.port || 161
});

// Walk dengan limit
function walkLimited(baseOid, limit = 20) {
    return new Promise((resolve) => {
        const results = [];
        let count = 0;
        
        session.walk(baseOid, (varbinds) => {
            for (const vb of varbinds) {
                if (count >= limit) return;
                if (snmp.isVarbindError(vb)) continue;
                
                const parts = vb.oid.split('.');
                results.push({
                    slot: parts[parts.length - 2],
                    onu: parts[parts.length - 1],
                    value: vb.value.toString()
                });
                count++;
            }
        }, (_error) => {
            resolve(results);
        });
        
        // Force resolve after 10 seconds
        setTimeout(() => resolve(results), 10000);
    });
}

async function main() {
    console.log('\nFetching sample data (max 20 per OID)...\n');
    
    const [phaseStates, dyingGasps] = await Promise.all([
        walkLimited('1.3.6.1.4.1.25355.3.2.6.3.2.1.39', 20),
        walkLimited('1.3.6.1.4.1.25355.3.2.6.3.2.1.40', 20)
    ]);
    
    console.log('=== phaseState (.39) ===');
    console.log('Slot/ONU | Value | Meaning');
    phaseStates.forEach(p => {
        let meaning = 'Unknown';
        switch(p.value) {
            case '1': meaning = 'Online'; break;
            case '2': meaning = 'LOS'; break;
            case '3': meaning = 'Sync'; break;
            case '4': meaning = 'AuthFail'; break;
            case '5': meaning = 'Offline'; break;
        }
        console.log(`${p.slot}/${p.onu.padStart(3)} | ${p.value.padStart(5)} | ${meaning}`);
    });
    
    console.log('\n=== dyingGasp (.40) ===');
    console.log('Slot/ONU | Value');
    dyingGasps.forEach(p => {
        console.log(`${p.slot}/${p.onu.padStart(3)} | ${p.value}`);
    });
    
    // Unique values
    console.log('\n=== Unique Values ===');
    console.log('phaseState:', [...new Set(phaseStates.map(p => p.value))].join(', '));
    console.log('dyingGasp:', [...new Set(dyingGasps.map(p => p.value))].join(', '));
    
    session.close();
    process.exit(0);
}

main();
