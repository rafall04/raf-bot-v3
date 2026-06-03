/**
 * DEBUG LOS CHECK - Cek nilai saat fiber dicabut (LOS)
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

console.log('=== DEBUG LOS CHECK ===');
console.log('Host:', oltConfig.host);
console.log('Kondisi: Fiber dicabut (seharusnya LOS)');
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 10000,
    retries: 1,
    port: oltConfig.port || 161
});

// OID dengan suffix yang benar (1.1.4)
const SUFFIX = '1.1.4';
const BASE_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1';

const oids = [
    `${BASE_OID}.39.${SUFFIX}`,  // phaseState
    `${BASE_OID}.41.${SUFFIX}`,  // lastDownCause
    `${BASE_OID}.40.${SUFFIX}`,  // dyingGasp flag
];

console.log('Querying OIDs:');
console.log('  phaseState:', oids[0]);
console.log('  lastDownCause:', oids[1]);
console.log('  dyingGasp:', oids[2]);
console.log('');

session.get(oids, (err, varbinds) => {
    if (err) {
        console.log('SNMP Error:', err.message);
        session.close();
        process.exit(1);
    }
    
    console.log('=== HASIL RAW ===');
    console.log('');
    
    const phaseState = varbinds[0].type === snmp.ObjectType.NoSuchInstance ? 'NoSuchInstance' : varbinds[0].value?.toString();
    const lastDownCause = varbinds[1].type === snmp.ObjectType.NoSuchInstance ? 'NoSuchInstance' : varbinds[1].value?.toString();
    const dyingGasp = varbinds[2].type === snmp.ObjectType.NoSuchInstance ? 'NoSuchInstance' : varbinds[2].value?.toString();
    
    console.log('phaseState:', phaseState);
    console.log('lastDownCause:', lastDownCause);
    console.log('dyingGasp:', dyingGasp);
    console.log('');
    
    console.log('=== INTERPRETASI ===');
    console.log('');
    console.log('phaseState meanings:');
    console.log('  1 = Online');
    console.log('  2 = Offline/Down');
    console.log('');
    console.log('lastDownCause meanings (HIPOTESIS):');
    console.log('  0 = Normal');
    console.log('  1 = Power failure (Dying Gasp)');
    console.log('  2 = LOS (fiber putus)');
    console.log('  3 = LOF');
    console.log('');
    
    console.log('=== KESIMPULAN ===');
    console.log('');
    
    if (phaseState === '2') {
        if (lastDownCause === '1') {
            console.log('Dengan logika saat ini: DYING GASP');
            console.log('');
            console.log('TAPI jika fiber dicabut, seharusnya LOS!');
            console.log('Berarti hipotesis lastDownCause SALAH.');
            console.log('');
            console.log('Kemungkinan:');
            console.log('  - lastDownCause = 1 bukan Power failure');
            console.log('  - Atau OLT HIOSO tidak membedakan LOS vs Dying Gasp');
        } else if (lastDownCause === '2') {
            console.log('Dengan logika saat ini: LOS');
            console.log('Ini BENAR jika fiber dicabut.');
        } else {
            console.log('lastDownCause =', lastDownCause);
            console.log('Perlu investigasi lebih lanjut.');
        }
    }
    
    session.close();
    process.exit(0);
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 15000);
