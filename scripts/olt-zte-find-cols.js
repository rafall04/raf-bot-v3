/**
 * Cari kolom SNMP .50.12.1.1.C utk OLT Rx, ONU Tx, OLT Tx, atenuasi — regresi vs CLI.
 * Usage: node scripts/olt-zte-find-cols.js [host] [community] [port]
 */
const snmp = require('net-snmp');
const { host, community, port } = require('./_olt-args')(2);

// Ground truth CLI (6 ONU, pon 1/2/2=268567040, 1/2/4=268567552, 1/2/5=268567808)
const CLI = {
    '268567040.14': { oltRx: -29.183, onuTx: 2.380, onuRx: -23.188, downAtt: 29.908, upAtt: 31.563, oltTx: 6.720 },
    '268567040.16': { oltRx: -27.617, onuTx: 2.910, onuRx: -22.832, downAtt: 29.552, upAtt: 30.527, oltTx: 6.720 },
    '268567040.18': { oltRx: -27.687, onuTx: 2.846, onuRx: -22.518, downAtt: 29.238, upAtt: 30.533, oltTx: 6.720 },
    '268567040.20': { oltRx: -24.369, onuTx: 2.429, onuRx: -19.790, downAtt: 26.489, upAtt: 26.798, oltTx: 6.699 },
    '268567552.9': { oltRx: -31.984, onuTx: 3.096, onuRx: -30.968, downAtt: 37.577, upAtt: 35.080, oltTx: 6.609 },
    '268567808.9': { oltRx: -30.094, onuTx: 2.509, onuRx: -31.548, downAtt: 38.499, upAtt: 32.603, oltTx: 6.951 },
};
const keys = Object.keys(CLI);
const metrics = ['oltRx', 'onuTx', 'onuRx', 'downAtt', 'upAtt', 'oltTx'];

const s = snmp.createSession(host, community, { version: snmp.Version2c, port, timeout: 8000, retries: 2 });
const oids = []; const meta = [];
keys.forEach((k) => { const [p, o] = k.split('.'); for (let c = 1; c <= 24; c++) { oids.push(`1.3.6.1.4.1.3902.1012.3.50.12.1.1.${c}.${p}.${o}.1`); meta.push([k, c]); } });

s.get(oids, (e, vb) => {
    if (e) { console.error(e.message); process.exit(1); }
    const raw = {}; // key -> {cN: val}
    vb.forEach((v, i) => { const [k, c] = meta[i]; raw[k] = raw[k] || {}; raw[k]['c' + c] = snmp.isVarbindError(v) ? null : Number(v.value); });

    const s16 = (n) => (n > 32767 ? n - 65536 : n);
    function fit(xs, ys) {
        const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
        const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0), sxx = xs.reduce((a, b) => a + b * b, 0);
        const a = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - a * sx) / n;
        const rmse = Math.sqrt(xs.reduce((acc, x, i) => acc + (a * x + b - ys[i]) ** 2, 0) / n);
        return { a, b, rmse };
    }
    console.log('Kolom yang cocok tiap metrik (signed16, RMSE<0.4):\n');
    for (const m of metrics) {
        const ys = keys.map((k) => CLI[k][m]);
        const hits = [];
        for (let c = 1; c <= 24; c++) {
            const xs = keys.map((k) => raw[k]['c' + c]);
            if (xs.some((x) => x == null || x === 65535)) continue;
            if (new Set(xs).size === 1) continue;
            const f = fit(xs.map(s16), ys);
            if (f.rmse < 0.4) hits.push(`c${c}: dBm=${f.a.toFixed(5)}*s16+${f.b.toFixed(3)} (1/a=${(1 / f.a).toFixed(0)}) RMSE=${f.rmse.toFixed(3)}`);
        }
        console.log(`${m}: ${hits.length ? hits.join('  |  ') : '(tak ada kolom cocok)'}`);
    }
    // tampilkan raw c1..c24 utk 1 onu sbg referensi
    console.log('\nraw onu16:', JSON.stringify(raw['268567040.16']));
    s.close(); process.exit(0);
});
