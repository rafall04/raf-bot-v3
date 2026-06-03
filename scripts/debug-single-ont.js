/**
 * Debug script untuk melihat nilai raw dari single ONT
 * Jalankan: node scripts/debug-single-ont.js
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

// Target ONT
const TARGET_SLOT = '1';
const TARGET_ONU = '4';

// Load config
const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log(`\n=== DEBUG SINGLE ONT: Slot ${TARGET_SLOT} / ONU ${TARGET_ONU} ===`);
console.log(`Host: ${oltConfig.host}`);
console.log(`==========================================\n`);

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 10000,
    retries: 1,
    port: oltConfig.port || 161
});

// OIDs to check - semua yang relevan
const OIDs = {
    // Status dan info dasar
    phaseState: '1.3.6.1.4.1.25355.3.2.6.3.2.1.39',      // .39 - Phase State
    dyingGasp: '1.3.6.1.4.1.25355.3.2.6.3.2.1.40',       // .40 - Dying Gasp
    lastDownCause: '1.3.6.1.4.1.25355.3.2.6.3.2.1.41',   // .41 - Last Down Cause
    
    // Power
    rxPower: '1.3.6.1.4.1.25355.3.2.6.14.2.1.8',         // RX Power
    
    // Coba OID lain yang mungkin relevan
    oid_42: '1.3.6.1.4.1.25355.3.2.6.3.2.1.42',          // .42 - Unknown
    oid_43: '1.3.6.1.4.1.25355.3.2.6.3.2.1.43',          // .43 - Unknown
    oid_38: '1.3.6.1.4.1.25355.3.2.6.3.2.1.38',          // .38 - Unknown (sebelum phaseState)
};

// SNMP GET untuk OID spesifik
function snmpGet(oids) {
    return new Promise((resolve, reject) => {
        session.get(oids, (error, varbinds) => {
            if (error) {
                reject(error);
            } else {
                resolve(varbinds);
            }
        });
    });
}

async function main() {
    try {
        // Build specific OIDs for target ONT
        const targetOids = [];
        const oidNames = [];
        
        for (const [name, baseOid] of Object.entries(OIDs)) {
            const fullOid = `${baseOid}.${TARGET_SLOT}.${TARGET_ONU}`;
            targetOids.push(fullOid);
            oidNames.push(name);
        }
        
        console.log('Querying OIDs:');
        targetOids.forEach((oid, i) => {
            console.log(`  ${oidNames[i]}: ${oid}`);
        });
        console.log('');
        
        // Get all values
        const results = await snmpGet(targetOids);
        
        console.log('=== RESULTS ===\n');
        console.log('OID Name       | Full OID                                    | Type          | Value');
        console.log('---------------|---------------------------------------------|---------------|-------');
        
        results.forEach((vb, i) => {
            const typeName = snmp.ObjectType[vb.type] || `Unknown(${vb.type})`;
            let value = '';
            
            if (vb.type === snmp.ObjectType.NoSuchObject) {
                value = 'NoSuchObject';
            } else if (vb.type === snmp.ObjectType.NoSuchInstance) {
                value = 'NoSuchInstance';
            } else if (vb.type === snmp.ObjectType.EndOfMibView) {
                value = 'EndOfMibView';
            } else if (vb.type === snmp.ObjectType.OctetString) {
                // Try to decode as string
                const strVal = vb.value.toString('utf8').replace(/[\x00-\x1F\x7F-\x9F]/g, '');
                const hexVal = vb.value.toString('hex');
                value = `"${strVal}" (hex: ${hexVal})`;
            } else {
                value = vb.value.toString();
            }
            
            console.log(`${oidNames[i].padEnd(14)} | ${vb.oid.padEnd(43)} | ${typeName.padEnd(13)} | ${value}`);
        });
        
        // Interpretasi
        console.log('\n=== INTERPRETASI ===\n');
        
        results.forEach((vb, i) => {
            if (vb.type === snmp.ObjectType.NoSuchInstance || vb.type === snmp.ObjectType.NoSuchObject) {
                return;
            }
            
            const name = oidNames[i];
            const val = vb.value.toString();
            
            if (name === 'phaseState') {
                let meaning = 'Unknown';
                switch(val) {
                    case '1': meaning = 'Online/Working'; break;
                    case '2': meaning = 'LOS (Loss of Signal)'; break;
                    case '3': meaning = 'SyncMib'; break;
                    case '4': meaning = 'AuthFail'; break;
                    case '5': meaning = 'Offline'; break;
                }
                console.log(`phaseState (.39) = ${val} -> ${meaning}`);
            }
            else if (name === 'dyingGasp') {
                console.log(`dyingGasp (.40) = ${val} -> ${val === '0' ? 'Normal' : 'DYING GASP ACTIVE!'}`);
            }
            else if (name === 'lastDownCause') {
                console.log(`lastDownCause (.41) = ${val}`);
            }
            else if (name === 'rxPower') {
                const dbm = parseFloat(val);
                console.log(`rxPower = ${val} -> ${isNaN(dbm) ? 'N/A' : dbm.toFixed(2) + ' dBm'}`);
            }
            else {
                console.log(`${name} = ${val}`);
            }
        });
        
        session.close();
        process.exit(0);
        
    } catch (error) {
        console.error('Error:', error.message);
        session.close();
        process.exit(1);
    }
}

main();
