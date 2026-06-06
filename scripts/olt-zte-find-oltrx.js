/**
 * Cari OID OLT Rx (upstream) + atenuasi: korelasi kolom dari banyak tabel vs CLI.
 * Usage: node scripts/olt-zte-find-oltrx.js [host] [community] [port]
 */
const snmp = require('net-snmp');
const { host, community, port } = require('./_olt-args')(2);

const CLI = {
    '268567040.14': { oltRx: -29.183, upAtt: 31.563, downAtt: 29.908 },
    '268567040.16': { oltRx: -27.617, upAtt: 30.527, downAtt: 29.552 },
    '268567040.18': { oltRx: -27.687, upAtt: 30.533, downAtt: 29.238 },
    '268567040.20': { oltRx: -24.369, upAtt: 26.798, downAtt: 26.489 },
    '268567552.9': { oltRx: -31.984, upAtt: 35.080, downAtt: 37.577 },
    '268567808.9': { oltRx: -30.094, upAtt: 32.603, downAtt: 38.499 },
};
const keys = Object.keys(CLI);

// kandidat tabel.kolom-prefix (index .pon.onu.1 atau .pon.onu)
const TABLES = [
    ['.50.13.1.1', '.1'], ['.50.14.1.1', '.1'], ['.50.16.1.1', '.1'], ['.50.17.1.1', '.1'],
    ['.50.18.1.1', '.1'], ['.50.19.3.1', ''], ['.50.25.2.1', '.1'], ['.50.26.2.1', '.1'],
    ['.50.11.2.1', ''], ['.50.13.1.1', ''], ['.50.14.1.1', ''], ['.50.16.1.1', ''],
    ['.50.12.4.1', '.1'], ['.50.12.5.1', '.1'], ['.50.12.6.1', '.1'],
];
const PREF = '1.3.6.1.4.1.3902.1012.3';

const s = snmp.createSession(host, community, { version: snmp.Version2c, port, timeout: 8000, retries: 2 });
const oids = []; const meta = [];
keys.forEach((k) => {
    const [p, o] = k.split('.');
    TABLES.forEach(([tbl, suf]) => { for (let c = 1; c <= 16; c++) { oids.push(`${PREF}${tbl}.${c}.${p}.${o}${suf}`); meta.push([k, tbl + '.' + c]); } });
});

// chunk get (max ~120/req aman)
function getChunk(list) {
    return new Promise((res) => { s.get(list, (e, vb) => { if (e) return res({}); const o = {}; vb.forEach((v, i) => { o[list[i]] = snmp.isVarbindError(v) ? null : (Buffer.isBuffer(v.value) ? null : Number(v.value)); }); res(o); }); });
}
(async () => {
    const all = {};
    for (let i = 0; i < oids.length; i += 100) { Object.assign(all, await getChunk(oids.slice(i, i + 100))); }
    // raw[key][col] = val
    const raw = {};
    meta.forEach(([k, col], i) => { raw[k] = raw[k] || {}; raw[k][col] = all[oids[i]]; });

    const s16 = (n) => (n == null ? null : (n > 32767 ? n - 65536 : n));
    function fit(xs, ys) {
        const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
        const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0), sxx = xs.reduce((a, b) => a + b * b, 0);
        const a = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - a * sx) / n;
        const rmse = Math.sqrt(xs.reduce((acc, x, i) => acc + (a * x + b - ys[i]) ** 2, 0) / n);
        return { a, b, rmse };
    }
    const cols = [...new Set(meta.map((m) => m[1]))];
    for (const metric of ['oltRx', 'upAtt', 'downAtt']) {
        const ys = keys.map((k) => CLI[k][metric]);
        const hits = [];
        for (const col of cols) {
            const xs = keys.map((k) => s16(raw[k][col]));
            if (xs.some((x) => x == null || Math.abs(x) === 1 || Math.abs(x) >= 32767)) continue;
            if (new Set(xs).size < 4) continue;
            const f = fit(xs, ys);
            if (f.rmse < 0.5) hits.push(`${col}: a=${f.a.toFixed(5)} b=${f.b.toFixed(2)} (1/a=${(1 / f.a).toFixed(0)}) RMSE=${f.rmse.toFixed(3)}`);
        }
        hits.sort((a, b) => parseFloat(a.split('RMSE=')[1]) - parseFloat(b.split('RMSE=')[1]));
        console.log(`\n${metric}: ${hits.length ? hits.slice(0, 5).join('\n   ') : '(tak ada cocok)'}`);
    }
    s.close(); process.exit(0);
})();
