/**
 * DEBUG DYING GASP vs LOS
 * Script untuk memahami perbedaan antara Dying Gasp dan LOS di OLT HIOSO
 * 
 * Hipotesis:
 * - Dying Gasp: ONT TIDAK ADA di SNMP walk (MAC tidak ditemukan)
 * - LOS: ONT ADA di SNMP walk dengan phaseState = 2
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

// Target: tes@hw dengan MAC C0:F6:EC:1E:FF:DB
const TARGET_MAC_PREFIX = 'C0F6EC1EFF'; // 10 digit pertama

console.log('=== DEBUG DYING GASP vs LOS ===');
console.log('Host:', oltConfig.host);
console.log('Target MAC prefix:', TARGET_MAC_PREFIX);
console.log('');
console.log('Hipotesis:');
console.log('- Dying Gasp: ONT TIDAK ADA di SNMP walk');
console.log('- LOS: ONT ADA di SNMP walk dengan phaseState = 2');
console.log('');
console.log('==========================================');
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 15000,
    retries: 1,
    port: oltConfig.port || 161
});

const MAC_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1.11';
const PHASE_STATE_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1.39';

// Step 1: Walk MAC OID untuk cari target ONT
console.log('Step 1: Walking MAC OID untuk mencari target ONT...');
console.log('');

let foundOnt = null;
let allMacs = [];

function walkMac() {
    return new Promise((resolve) => {
        session.walk(MAC_OID, (varbinds) => {
            for (const vb of varbinds) {
                if (snmp.isVarbindError(vb)) continue;
                
                const macHex = vb.value.toString().toUpperCase();
                const macFormatted = macHex.match(/.{2}/g)?.join(':') || macHex;
                const macPrefix = macHex.substring(0, 10);
                
                allMacs.push({
                    oid: vb.oid,
                    mac: macFormatted,
                    prefix: macPrefix
                });
                
                if (macPrefix === TARGET_MAC_PREFIX) {
                    foundOnt = {
                        oid: vb.oid,
                        mac: macFormatted,
                        suffix: vb.oid.split('.').slice(-3).join('.')
                    };
                }
            }
        }, (error) => {
            if (error && !error.message.includes('not increasing')) {
                console.log('Walk error:', error.message);
            }
            resolve();
        });
    });
}

async function main() {
    await walkMac();
    
    console.log(`Total MAC ditemukan di OLT: ${allMacs.length}`);
    console.log('');
    
    if (foundOnt) {
        console.log('*** TARGET ONT DITEMUKAN DI SNMP ***');
        console.log('');
        console.log('OID:', foundOnt.oid);
        console.log('MAC:', foundOnt.mac);
        console.log('Suffix:', foundOnt.suffix);
        console.log('');
        
        // Query phaseState
        const phaseOid = PHASE_STATE_OID + '.' + foundOnt.suffix;
        console.log('Querying phaseState:', phaseOid);
        
        session.get([phaseOid], (err, results) => {
            if (err) {
                console.log('phaseState Error:', err.message);
            } else {
                const r = results[0];
                if (r.type === snmp.ObjectType.NoSuchInstance) {
                    console.log('phaseState: NoSuchInstance');
                    console.log('');
                    console.log('=== KESIMPULAN ===');
                    console.log('ONT ada di SNMP (MAC ditemukan) tapi phaseState tidak ada');
                    console.log('Ini BUKAN kondisi normal - perlu investigasi lebih lanjut');
                } else if (r.type === snmp.ObjectType.NoSuchObject) {
                    console.log('phaseState: NoSuchObject');
                } else {
                    const val = r.value.toString();
                    const meanings = {
                        '1': 'Online (Working)',
                        '2': 'LOS (Loss of Signal)',
                        '3': 'Sync',
                        '4': 'Auth Fail',
                        '5': 'Offline'
                    };
                    console.log('phaseState:', val, '->', meanings[val] || 'Unknown');
                    console.log('');
                    console.log('=== KESIMPULAN ===');
                    if (val === '2') {
                        console.log('Status: LOS (fiber putus atau masalah sinyal)');
                        console.log('Ini BUKAN Dying Gasp karena ONT masih merespons SNMP');
                    } else if (val === '1') {
                        console.log('Status: Online - ONT berfungsi normal');
                    } else {
                        console.log('Status:', meanings[val] || 'Unknown');
                    }
                }
                
                session.close();
                process.exit(0);
            }
        });
        
    } else {
        console.log('*** TARGET ONT TIDAK DITEMUKAN DI SNMP ***');
        console.log('');
        console.log('=== KESIMPULAN ===');
        console.log('ONT dengan MAC prefix', TARGET_MAC_PREFIX, 'TIDAK ADA di SNMP walk');
        console.log('');
        console.log('Kemungkinan penyebab:');
        console.log('1. DYING GASP - Adaptor modem mati, ONT tidak bisa merespons SNMP');
        console.log('2. ONT belum pernah terdaftar di OLT');
        console.log('3. ONT sudah dihapus dari OLT');
        console.log('');
        console.log('Jika adaptor modem dicabut, ini adalah kondisi DYING GASP yang benar!');
        
        session.close();
        process.exit(0);
    }
}

main();

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 60000);
