/**
 * FULL DEBUG - Analisa lengkap ONT untuk user tes@hw
 * Jalankan: node scripts/debug-full-ont.js
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

// Load config
const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

// Target MAC dari cache tes@hw
const TARGET_MAC = 'C0:F6:EC:1E:FF:DB';
const TARGET_MAC_PREFIX = TARGET_MAC.replace(/:/g, '').substring(0, 10).toUpperCase();

console.log('='.repeat(60));
console.log('FULL DEBUG - ONT Analysis for tes@hw');
console.log('='.repeat(60));
console.log(`Target MAC: ${TARGET_MAC}`);
console.log(`Target MAC Prefix: ${TARGET_MAC_PREFIX}`);
console.log(`OLT Host: ${oltConfig.host}`);
console.log('='.repeat(60));
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 1,
    port: oltConfig.port || 161
});

// OIDs
const OIDs = {
    mac: '1.3.6.1.4.1.25355.3.2.6.3.2.1.11',
    phaseState: '1.3.6.1.4.1.25355.3.2.6.3.2.1.39',
    dyingGasp: '1.3.6.1.4.1.25355.3.2.6.3.2.1.40',
    rxPower: '1.3.6.1.4.1.25355.3.2.6.14.2.1.8',
};

function formatMac(hexStr) {
    if (typeof hexStr !== 'string' || hexStr.length !== 12) return hexStr;
    return hexStr.match(/.{2}/g).join(':').toUpperCase();
}

function walkOid(baseOid, name) {
    return new Promise((resolve) => {
        const results = [];
        
        session.walk(baseOid, (varbinds) => {
            for (const vb of varbinds) {
                if (snmp.isVarbindError(vb)) continue;
                
                const parts = vb.oid.split('.');
                const onuId = parts[parts.length - 1];
                const slotId = parts[parts.length - 2];
                
                let value = vb.value.toString();
                if (name === 'mac' && value.length === 12) {
                    value = formatMac(value);
                }
                
                results.push({
                    slot: slotId,
                    onu: onuId,
                    value: value,
                    oid: vb.oid
                });
            }
        }, (error) => {
            if (error && !error.message.includes('not increasing')) {
                console.log(`Walk error for ${name}:`, error.message);
            }
            resolve(results);
        });
    });
}

async function main() {
    try {
        // Step 1: Walk MAC untuk menemukan ONT yang match
        console.log('STEP 1: Walking MAC OID to find matching ONT...');
        console.log('-'.repeat(60));
        
        const macResults = await walkOid(OIDs.mac, 'mac');
        console.log(`Total MACs found: ${macResults.length}`);
        
        // Find matching MAC
        let matchedOnt = null;
        for (const item of macResults) {
            const macNormalized = item.value.replace(/:/g, '').toUpperCase();
            const macPrefix = macNormalized.substring(0, 10);
            
            if (macPrefix === TARGET_MAC_PREFIX) {
                matchedOnt = item;
                console.log(`\n*** MATCH FOUND ***`);
                console.log(`  Slot/ONU: ${item.slot}/${item.onu}`);
                console.log(`  MAC in OLT: ${item.value}`);
                console.log(`  MAC Prefix: ${macPrefix}`);
                break;
            }
        }
        
        if (!matchedOnt) {
            console.log('\n*** NO MATCH FOUND ***');
            console.log('ONT dengan MAC prefix tersebut tidak ada di OLT.');
            session.close();
            return;
        }
        
        const targetSlot = matchedOnt.slot;
        const targetOnu = matchedOnt.onu;
        
        // Step 2: Walk phaseState dan cari target ONT
        console.log('\n');
        console.log('STEP 2: Walking phaseState OID...');
        console.log('-'.repeat(60));
        
        const phaseResults = await walkOid(OIDs.phaseState, 'phaseState');
        console.log(`Total phaseState entries: ${phaseResults.length}`);
        
        const targetPhase = phaseResults.find(p => p.slot === targetSlot && p.onu === targetOnu);
        if (targetPhase) {
            let statusMeaning = 'Unknown';
            switch(targetPhase.value) {
                case '1': statusMeaning = 'Online'; break;
                case '2': statusMeaning = 'LOS'; break;
                case '3': statusMeaning = 'Sync'; break;
                case '4': statusMeaning = 'AuthFail'; break;
                case '5': statusMeaning = 'Offline'; break;
            }
            console.log(`\nphaseState for ${targetSlot}/${targetOnu}: ${targetPhase.value} (${statusMeaning})`);
        } else {
            console.log(`\n*** phaseState for ${targetSlot}/${targetOnu}: NOT FOUND ***`);
            console.log('Ini menunjukkan ONT dalam kondisi DYING GASP');
        }
        
        // Step 3: Walk rxPower dan cari target ONT
        console.log('\n');
        console.log('STEP 3: Walking rxPower OID...');
        console.log('-'.repeat(60));
        
        const rxResults = await walkOid(OIDs.rxPower, 'rxPower');
        console.log(`Total rxPower entries: ${rxResults.length}`);
        
        const targetRx = rxResults.find(p => p.slot === targetSlot && p.onu === targetOnu);
        if (targetRx) {
            const rxDbm = parseFloat(targetRx.value);
            console.log(`\nrxPower for ${targetSlot}/${targetOnu}: ${targetRx.value} (${isNaN(rxDbm) ? 'N/A' : rxDbm.toFixed(2) + ' dBm'})`);
        } else {
            console.log(`\n*** rxPower for ${targetSlot}/${targetOnu}: NOT FOUND ***`);
        }
        
        // Step 4: Walk dyingGasp dan cari target ONT
        console.log('\n');
        console.log('STEP 4: Walking dyingGasp OID...');
        console.log('-'.repeat(60));
        
        const dgResults = await walkOid(OIDs.dyingGasp, 'dyingGasp');
        console.log(`Total dyingGasp entries: ${dgResults.length}`);
        
        const targetDg = dgResults.find(p => p.slot === targetSlot && p.onu === targetOnu);
        if (targetDg) {
            console.log(`\ndyingGasp for ${targetSlot}/${targetOnu}: ${targetDg.value}`);
        } else {
            console.log(`\n*** dyingGasp for ${targetSlot}/${targetOnu}: NOT FOUND ***`);
        }
        
        // Summary
        console.log('\n');
        console.log('='.repeat(60));
        console.log('SUMMARY');
        console.log('='.repeat(60));
        console.log(`ONT: Slot ${targetSlot} / ONU ${targetOnu}`);
        console.log(`MAC: ${matchedOnt.value}`);
        console.log(`phaseState: ${targetPhase ? targetPhase.value : 'NOT FOUND'}`);
        console.log(`rxPower: ${targetRx ? targetRx.value : 'NOT FOUND'}`);
        console.log(`dyingGasp: ${targetDg ? targetDg.value : 'NOT FOUND'}`);
        console.log('');
        
        // Diagnosis
        console.log('DIAGNOSIS:');
        if (!targetPhase && !targetRx) {
            console.log('  -> ONT dalam kondisi DYING GASP (adaptor mati)');
            console.log('  -> MAC masih ada tapi phaseState dan rxPower tidak ada');
        } else if (targetPhase && targetPhase.value === '2') {
            console.log('  -> ONT dalam kondisi LOS (fiber putus)');
        } else if (targetPhase && targetPhase.value === '1') {
            console.log('  -> ONT dalam kondisi ONLINE');
        } else {
            console.log('  -> Status tidak dapat ditentukan');
        }
        
        session.close();
        process.exit(0);
        
    } catch (error) {
        console.error('Error:', error);
        session.close();
        process.exit(1);
    }
}

// Timeout
setTimeout(() => {
    console.log('\nTimeout - script took too long');
    session.close();
    process.exit(1);
}, 120000);

main();
