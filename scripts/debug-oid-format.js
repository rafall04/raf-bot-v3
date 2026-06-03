/**
 * DEBUG OID FORMAT - Cek format OID yang benar dari walk
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

const TARGET_MAC_PREFIX = 'C0F6EC1EFF';

console.log('DEBUG OID FORMAT');
console.log('Host:', oltConfig.host);
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 1,
    port: oltConfig.port || 161
});

const MAC_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1.11';

console.log('Walking MAC OID to find exact OID format...');
console.log('Base OID:', MAC_OID);
console.log('');

let found = false;

session.walk(MAC_OID, (varbinds) => {
    if (found) return;
    
    for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        
        const macHex = vb.value.toString().toUpperCase();
        const macPrefix = macHex.substring(0, 10);
        
        if (macPrefix === TARGET_MAC_PREFIX) {
            found = true;
            
            console.log('FOUND!');
            console.log('');
            console.log('Full OID from walk:', vb.oid);
            console.log('MAC value:', macHex.match(/.{2}/g).join(':'));
            console.log('');
            
            // Parse OID
            const parts = vb.oid.split('.');
            console.log('OID parts:', parts.join(' . '));
            console.log('Total parts:', parts.length);
            console.log('');
            
            // Last few parts
            console.log('Last 5 parts:', parts.slice(-5).join('.'));
            console.log('Last 4 parts:', parts.slice(-4).join('.'));
            console.log('Last 3 parts:', parts.slice(-3).join('.'));
            console.log('Last 2 parts:', parts.slice(-2).join('.'));
            console.log('Last 1 part:', parts.slice(-1).join('.'));
            console.log('');
            
            // Expected OID format
            const baseOidParts = MAC_OID.split('.');
            const suffix = parts.slice(baseOidParts.length).join('.');
            console.log('Base OID parts count:', baseOidParts.length);
            console.log('Suffix after base:', suffix);
            console.log('');
            
            // Now try GET with exact OID
            console.log('Trying GET with exact OID...');
            session.get([vb.oid], (err, results) => {
                if (err) {
                    console.log('GET Error:', err.message);
                } else {
                    const r = results[0];
                    if (r.type === snmp.ObjectType.NoSuchInstance) {
                        console.log('GET Result: NoSuchInstance');
                    } else {
                        console.log('GET Result:', r.value.toString());
                    }
                }
                
                // Try phaseState with same suffix
                const phaseOid = '1.3.6.1.4.1.25355.3.2.6.3.2.1.39.' + suffix;
                console.log('');
                console.log('Trying phaseState OID:', phaseOid);
                
                session.get([phaseOid], (err2, results2) => {
                    if (err2) {
                        console.log('phaseState GET Error:', err2.message);
                    } else {
                        const r2 = results2[0];
                        if (r2.type === snmp.ObjectType.NoSuchInstance) {
                            console.log('phaseState Result: *** NoSuchInstance ***');
                        } else if (r2.type === snmp.ObjectType.NoSuchObject) {
                            console.log('phaseState Result: *** NoSuchObject ***');
                        } else {
                            const val = r2.value.toString();
                            const meanings = {'1': 'Online', '2': 'LOS', '3': 'Sync', '4': 'AuthFail', '5': 'Offline'};
                            console.log('phaseState Result:', val, '->', meanings[val] || 'Unknown');
                        }
                    }
                    
                    session.close();
                    process.exit(0);
                });
            });
            
            return;
        }
    }
}, (error) => {
    if (!found) {
        console.log('NOT FOUND');
    }
    if (error && !error.message.includes('not increasing')) {
        console.log('Walk error:', error.message);
    }
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 60000);
