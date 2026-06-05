/**
 * Histogram nilai untuk beberapa kolom status ONU ZTE (1 kolom = 1 walk penuh).
 * Bantu petakan kode status (online/LOS/dying-gasp) ke makna.
 * Usage: node scripts/olt-zte-hist.js
 */
const snmp = require('net-snmp');
const host = '103.171.83.121', community = 'onewanro', port = 1601;

const COLS = {
    'phaseState .28.2.1.3': '1.3.6.1.4.1.3902.1012.3.28.2.1.3',
    'configState .28.2.1.4': '1.3.6.1.4.1.3902.1012.3.28.2.1.4',
    'offlineReason .28.2.1.7': '1.3.6.1.4.1.3902.1012.3.28.2.1.7',
    'onuStatus .28.1.1.6': '1.3.6.1.4.1.3902.1012.3.28.1.1.6',
    'onuStatus .28.1.1.8': '1.3.6.1.4.1.3902.1012.3.28.1.1.8',
};

function walkCol(base) {
    return new Promise((resolve) => {
        const s = snmp.createSession(host, community, { version: snmp.Version2c, port, timeout: 8000, retries: 1 });
        const hist = {}; let n = 0, done = false;
        const fin = () => { if (done) return; done = true; try { s.close(); } catch (e) {} resolve({ hist, n }); };
        s.on('error', fin);
        s.walk(base, 30, (vbs) => {
            for (const vb of vbs) {
                if (vb.type === snmp.ObjectType.EndOfMibView) { fin(); return; }
                if (!vb.oid.startsWith(base + '.')) { fin(); return; }
                n++; const v = String(vb.value); hist[v] = (hist[v] || 0) + 1;
                if (n >= 5000) { fin(); return; }
            }
        }, () => fin());
    });
}

(async () => {
    for (const [label, base] of Object.entries(COLS)) {
        const { hist, n } = await walkCol(base);
        const parts = Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v}×${c}`).join('  ');
        console.log(`${label.padEnd(26)} n=${n}  → ${parts}`);
    }
    process.exit(0);
})();
