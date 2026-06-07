/**
 * Debug script untuk melihat nilai raw dari OLT SNMP
 * Jalankan: node scripts/debug-olt-status.js
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

// Load config
const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

if (!oltConfig || !oltConfig.host) {
    console.error('OLT tidak dikonfigurasi di config.json');
    process.exit(1);
}

console.log(`\n=== DEBUG OLT STATUS ===`);
console.log(`Host: ${oltConfig.host}`);
console.log(`Community: ${oltConfig.community || 'public'}`);
console.log(`========================\n`);

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 2,
    port: oltConfig.port || 161
});

// OIDs to check
const OIDs = {
    phaseState: '1.3.6.1.4.1.25355.3.2.6.3.2.1.39',  // Status ONT
    dyingGasp: '1.3.6.1.4.1.25355.3.2.6.3.2.1.40',   // Dying Gasp flag
    lastDownCause: '1.3.6.1.4.1.25355.3.2.6.3.2.1.41', // Last down cause
    rxPower: '1.3.6.1.4.1.25355.3.2.6.14.2.1.8',     // RX Power
};

async function walkOid(baseOid, name) {
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
                    value: vb.value.toString(),
                    type: snmp.ObjectType[vb.type]
                });
            }
        }, (error) => {
            if (error && error.message !== 'OID not increasing') {
                console.error(`Error walking ${name}:`, error.message);
            }
            resolve(results);
        });
    });
}

async function main() {
    try {
        console.log('Fetching phaseState (.39)...');
        const phaseStates = await walkOid(OIDs.phaseState, 'phaseState');
        
        console.log('Fetching dyingGasp (.40)...');
        const dyingGasps = await walkOid(OIDs.dyingGasp, 'dyingGasp');
        
        console.log('Fetching lastDownCause (.41)...');
        const lastDownCauses = await walkOid(OIDs.lastDownCause, 'lastDownCause');
        
        console.log('Fetching rxPower...');
        const rxPowers = await walkOid(OIDs.rxPower, 'rxPower');
        
        // Build combined data
        const onuMap = new Map();
        
        phaseStates.forEach(item => {
            const key = `${item.slot}/${item.onu}`;
            if (!onuMap.has(key)) onuMap.set(key, { slot: item.slot, onu: item.onu });
            onuMap.get(key).phaseState = item.value;
        });
        
        dyingGasps.forEach(item => {
            const key = `${item.slot}/${item.onu}`;
            if (!onuMap.has(key)) onuMap.set(key, { slot: item.slot, onu: item.onu });
            onuMap.get(key).dyingGasp = item.value;
        });
        
        lastDownCauses.forEach(item => {
            const key = `${item.slot}/${item.onu}`;
            if (!onuMap.has(key)) onuMap.set(key, { slot: item.slot, onu: item.onu });
            onuMap.get(key).lastDownCause = item.value;
        });
        
        rxPowers.forEach(item => {
            const key = `${item.slot}/${item.onu}`;
            if (!onuMap.has(key)) onuMap.set(key, { slot: item.slot, onu: item.onu });
            onuMap.get(key).rxPower = item.value;
        });
        
        // Print results
        console.log('\n=== RAW DATA ===\n');
        console.log('Slot/ONU | phaseState(.39) | dyingGasp(.40) | lastDownCause(.41) | rxPower');
        console.log('---------|-----------------|----------------|--------------------|---------');
        
        // Sort by slot then onu
        const sorted = Array.from(onuMap.values()).sort((a, b) => {
            const slotDiff = parseInt(a.slot) - parseInt(b.slot);
            if (slotDiff !== 0) return slotDiff;
            return parseInt(a.onu) - parseInt(b.onu);
        });
        
        sorted.forEach(item => {
            getPhaseStateDesc(item.phaseState);
            console.log(
                `${item.slot}/${item.onu.padStart(3)}    | ` +
                `${(item.phaseState || '-').padStart(15)} | ` +
                `${(item.dyingGasp || '-').padStart(14)} | ` +
                `${(item.lastDownCause || '-').padStart(18)} | ` +
                `${item.rxPower || '-'}`
            );
        });
        
        // Summary
        console.log('\n=== SUMMARY ===\n');
        console.log('phaseState values found:');
        const phaseValues = new Set(phaseStates.map(p => p.value));
        phaseValues.forEach(v => {
            const count = phaseStates.filter(p => p.value === v).length;
            console.log(`  ${v} (${getPhaseStateDesc(v)}): ${count} ONTs`);
        });
        
        console.log('\ndyingGasp values found:');
        const dgValues = new Set(dyingGasps.map(p => p.value));
        dgValues.forEach(v => {
            const count = dyingGasps.filter(p => p.value === v).length;
            console.log(`  ${v}: ${count} ONTs`);
        });
        
        console.log('\nlastDownCause values found:');
        const ldcValues = new Set(lastDownCauses.map(p => p.value));
        ldcValues.forEach(v => {
            const count = lastDownCauses.filter(p => p.value === v).length;
            console.log(`  ${v}: ${count} ONTs`);
        });
        
        session.close();
        
    } catch (error) {
        console.error('Error:', error);
        session.close();
    }
}

function getPhaseStateDesc(value) {
    switch (value) {
        case '1': return 'Online/Working';
        case '2': return 'LOS';
        case '3': return 'SyncMib';
        case '4': return 'AuthFail';
        case '5': return 'Offline';
        default: return 'Unknown';
    }
}

main();
