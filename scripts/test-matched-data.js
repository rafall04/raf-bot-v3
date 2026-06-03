/**
 * TEST MATCHED DATA - Verifikasi data matched dengan logika baru
 */

const { getOltData } = require('../lib/olt-hioso');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

const TARGET_MAC_PREFIX = 'C0F6EC1EFF';

console.log('=== TEST MATCHED DATA ===');
console.log('Host:', oltConfig.host);
console.log('Target MAC prefix:', TARGET_MAC_PREFIX);
console.log('');
console.log('Fetching OLT data...');
console.log('');

async function test() {
    try {
        const result = await getOltData(oltConfig);
        
        console.log('Status:', result.status);
        console.log('Total ONUs:', result.onus?.length || 0);
        console.log('');
        
        if (result.status === 'success' && result.onus) {
            // Cari ONT target
            const targetOnu = result.onus.find(onu => {
                const macNorm = onu.macAddress.replace(/[:\-]/g, '').toUpperCase();
                return macNorm.startsWith(TARGET_MAC_PREFIX);
            });
            
            if (targetOnu) {
                console.log('=== TARGET ONT DITEMUKAN ===');
                console.log('');
                console.log('Slot/ONU:', targetOnu.slotId + '/' + targetOnu.id);
                console.log('MAC:', targetOnu.macAddress);
                console.log('Status:', targetOnu.status);
                console.log('RX Power:', targetOnu.rxPower);
                console.log('isLos:', targetOnu.isLos);
                console.log('isDyingGasp:', targetOnu.isDyingGasp);
                console.log('lastDownCause:', targetOnu.lastDownCause);
                console.log('');
                
                console.log('=== VERIFIKASI ===');
                if (targetOnu.status === 'Online') {
                    console.log('✓ Status: ONLINE');
                } else if (targetOnu.status === 'LOS') {
                    console.log('✓ Status: LOS (Offline)');
                    console.log('');
                    console.log('CATATAN: OLT HIOSO tidak membedakan LOS vs Dying Gasp');
                    console.log('Kedua kondisi menghasilkan nilai SNMP yang sama.');
                } else {
                    console.log('Status:', targetOnu.status);
                }
            } else {
                console.log('TARGET ONT TIDAK DITEMUKAN');
                console.log('');
                console.log('Daftar ONT yang ditemukan:');
                result.onus.slice(0, 10).forEach(onu => {
                    console.log(`  ${onu.slotId}/${onu.id}: ${onu.macAddress} - ${onu.status}`);
                });
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
