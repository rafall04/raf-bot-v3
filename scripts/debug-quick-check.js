/**
 * DEBUG QUICK CHECK - Cek langsung status ONT dengan OID yang sudah diketahui
 * 
 * Dari debug sebelumnya, kita tahu:
 * - MAC OID: 1.3.6.1.4.1.25355.3.2.6.3.2.1.11.1.1.4
 * - Suffix yang benar: 1.1.4 (bukan 1.4)
 */

const snmp = require('net-snmp');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const oltConfig = config.olt;

// OID dengan suffix yang benar (1.1.4)
const SUFFIX = '1.1.4';
const BASE_OID = '1.3.6.1.4.1.25355.3.2.6.3.2.1';

const OIDS_TO_CHECK = {
    mac: `${BASE_OID}.11.${SUFFIX}`,
    phaseState: `${BASE_OID}.39.${SUFFIX}`,
    dyingGasp: `${BASE_OID}.40.${SUFFIX}`,
    lastDownCause: `${BASE_OID}.41.${SUFFIX}`,
    rxPower: `1.3.6.1.4.1.25355.3.2.6.14.2.1.8.${SUFFIX}`
};

console.log('=== QUICK CHECK ONT STATUS ===');
console.log('Host:', oltConfig.host);
console.log('Suffix:', SUFFIX);
console.log('');
console.log('OIDs yang akan di-query:');
Object.entries(OIDS_TO_CHECK).forEach(([name, oid]) => {
    console.log(`  ${name}: ${oid}`);
});
console.log('');
console.log('==========================================');
console.log('');

const session = snmp.createSession(oltConfig.host, oltConfig.community || 'public', {
    version: snmp.Version2c,
    timeout: 10000,
    retries: 1,
    port: oltConfig.port || 161
});

const oidList = Object.values(OIDS_TO_CHECK);
const oidNames = Object.keys(OIDS_TO_CHECK);

session.get(oidList, (err, varbinds) => {
    if (err) {
        console.log('SNMP Error:', err.message);
        session.close();
        process.exit(1);
    }
    
    console.log('=== HASIL ===');
    console.log('');
    
    let hasData = false;
    let hasMac = false;
    let hasPhaseState = false;
    let hasRxPower = false;
    let phaseStateValue = null;
    
    varbinds.forEach((vb, i) => {
        const name = oidNames[i];
        let value = 'N/A';
        let status = '';
        
        if (vb.type === snmp.ObjectType.NoSuchInstance) {
            value = '*** NoSuchInstance ***';
        } else if (vb.type === snmp.ObjectType.NoSuchObject) {
            value = '*** NoSuchObject ***';
        } else {
            hasData = true;
            
            if (name === 'mac') {
                hasMac = true;
                const macHex = vb.value.toString().toUpperCase();
                value = macHex.match(/.{2}/g)?.join(':') || macHex;
            } else if (name === 'phaseState') {
                hasPhaseState = true;
                phaseStateValue = vb.value.toString();
                const meanings = {
                    '1': 'Online',
                    '2': 'LOS',
                    '3': 'Sync',
                    '4': 'Auth Fail',
                    '5': 'Offline'
                };
                value = phaseStateValue;
                status = meanings[phaseStateValue] || 'Unknown';
            } else if (name === 'rxPower') {
                hasRxPower = true;
                const rxVal = parseFloat(vb.value.toString());
                value = isNaN(rxVal) ? vb.value.toString() : rxVal.toFixed(2) + ' dBm';
            } else {
                value = vb.value.toString();
            }
        }
        
        console.log(`${name.padEnd(15)}: ${value}${status ? ' -> ' + status : ''}`);
    });
    
    console.log('');
    console.log('=== ANALISIS ===');
    console.log('');
    console.log('Has MAC:', hasMac);
    console.log('Has phaseState:', hasPhaseState);
    console.log('Has rxPower:', hasRxPower);
    console.log('');
    
    console.log('=== KESIMPULAN ===');
    console.log('');
    
    if (!hasMac && !hasPhaseState && !hasRxPower) {
        console.log('STATUS: *** DYING GASP ***');
        console.log('');
        console.log('Semua OID mengembalikan NoSuchInstance.');
        console.log('ONT tidak merespons SNMP sama sekali.');
        console.log('Ini terjadi ketika adaptor modem dicabut/mati.');
    } else if (hasPhaseState && phaseStateValue === '2') {
        console.log('STATUS: *** LOS (Loss of Signal) ***');
        console.log('');
        console.log('ONT masih merespons SNMP tapi melaporkan LOS.');
        console.log('Ini terjadi ketika fiber optik putus/terlepas.');
    } else if (hasPhaseState && phaseStateValue === '1') {
        console.log('STATUS: *** ONLINE ***');
        console.log('');
        console.log('ONT berfungsi normal.');
    } else if (hasMac && !hasPhaseState) {
        console.log('STATUS: *** KEMUNGKINAN DYING GASP ***');
        console.log('');
        console.log('MAC ada tapi phaseState tidak ada.');
        console.log('Kondisi transisi atau anomali.');
    } else {
        console.log('STATUS: *** TIDAK DIKETAHUI ***');
        console.log('');
        console.log('Kondisi tidak sesuai dengan pola yang diharapkan.');
    }
    
    session.close();
    process.exit(0);
});

setTimeout(() => {
    console.log('Timeout');
    session.close();
    process.exit(1);
}, 30000);
