/**
 * TEST NEW LOGIC - Verifikasi logika baru untuk deteksi Dying Gasp vs LOS
 * 
 * Logika baru:
 * - phaseState = 2 + lastDownCause = 1 → Dying Gasp (adaptor mati)
 * - phaseState = 2 + lastDownCause = 2 → LOS (fiber putus)
 */

const { getSingleOnuData } = require('../lib/olt-hioso');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log('=== TEST NEW LOGIC ===');
console.log('Host:', oltConfig.host);
console.log('');
console.log('Testing getSingleOnuData for slot 1 / onu 4...');
console.log('');

async function test() {
    try {
        const result = await getSingleOnuData(oltConfig, '1', '4');
        
        console.log('=== HASIL ===');
        console.log('');
        console.log('Status:', result.status);
        console.log('Timestamp:', result.timestamp);
        console.log('');
        
        if (result.data) {
            console.log('Data:');
            console.log('  rxPower:', result.data.rxPower);
            console.log('  status:', result.data.status);
            console.log('  isLos:', result.data.isLos);
            console.log('  isDyingGasp:', result.data.isDyingGasp);
            console.log('  lastDownCause:', result.data.lastDownCause);
            console.log('');
            
            console.log('=== VERIFIKASI ===');
            if (result.data.status === 'Online') {
                console.log('✓ Status: ONLINE');
            } else if (result.data.status === 'LOS') {
                console.log('✓ Status: LOS (Offline)');
                console.log('');
                console.log('CATATAN: OLT HIOSO tidak membedakan LOS vs Dying Gasp');
                console.log('Kedua kondisi (fiber dicabut / adaptor mati) menghasilkan');
                console.log('nilai SNMP yang sama, jadi ditampilkan sebagai "LOS".');
            } else {
                console.log('? Status:', result.data.status);
            }
        } else {
            console.log('Error:', result.message);
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    }
    
    process.exit(0);
}

test();
