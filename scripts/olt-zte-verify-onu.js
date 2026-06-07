/**
 * Verifikasi OID optik ZTE terhadap GROUND TRUTH dari CLI.
 * Cari ONU by deskripsi, dump semua kolom .50.12.1.1.C (+ tetangga), cocokkan ke
 * nilai CLI yang diketahui (ONU Rx/Tx, OLT Rx/Tx) dengan beberapa encoding.
 * Usage: node scripts/olt-zte-verify-onu.js [descSubstring] [host] [community] [port]
 */
const snmp = require('net-snmp');

const descNeedle = (process.argv[2] || 'karangasem@asrulrendika').toLowerCase();
const { host, community, port } = require('./_olt-args')(3);

// Ground truth CLI utk karangasem@asrulrendika (gpon-onu_1/2/2:16):
const CLI = { onuRx: -23.182, oltRx: -27.617, onuTx: 2.957, oltTx: 6.699, upAtt: 30.574, downAtt: 29.881 };

const DESC = '1.3.6.1.4.1.3902.1012.3.28.1.1.2';
const IFNAME = '1.3.6.1.2.1.31.1.1.1.1';

function session() { return snmp.createSession(host, community, { version: snmp.Version2c, port, timeout: 8000, retries: 2 }); }

function walk(base, cap = 6000) {
  return new Promise((resolve) => {
    const s = session(); const rows = []; let done = false;
    const fin = () => { if (done) return; done = true; try { s.close(); } catch (_e) {} resolve(rows); };
    s.on('error', fin);
    s.walk(base, 30, (vbs) => { for (const vb of vbs) { if (vb.type === snmp.ObjectType.EndOfMibView) { fin(); return; } const oid = vb.oid.replace(/^\./, ''); if (!oid.startsWith(base.replace(/^\./, ''))) { fin(); return; } let v = vb.value; if (Buffer.isBuffer(v)) v = v.toString('utf8').replace(/[\x00-\x1F]/g, ''); rows.push({ oid, v: String(v) }); if (rows.length >= cap) { fin(); return; } } }, () => fin());
  });
}
function get(oids) {
  return new Promise((resolve) => { const s = session(); s.get(oids, (err, vbs) => { try { s.close(); } catch (_e) {} if (err) return resolve({}); const o = {}; vbs.forEach((vb, i) => { o[oids[i]] = snmp.isVarbindError(vb) ? null : (Buffer.isBuffer(vb.value) ? vb.value.toString('utf8') : Number(vb.value)); }); resolve(o); }); });
}

// Coba beberapa encoding untuk raw → dBm, return array {enc, val}
function decodings(raw) {
  if (raw == null) return [];
  const n = Number(raw);
  const s16 = n > 32767 ? n - 65536 : n;            // signed 16-bit
  const s32 = n > 2147483647 ? n - 4294967296 : n;  // signed 32-bit
  return [
    { enc: 'raw/100', val: n / 100 },
    { enc: '-raw/100', val: -n / 100 },
    { enc: 'raw/1000', val: n / 1000 },
    { enc: 's16/1000', val: s16 / 1000 },
    { enc: 's16/100', val: s16 / 100 },
    { enc: 's32/1000', val: s32 / 1000 },
    { enc: '(raw-65536)/1000', val: (n - 65536) / 1000 },
  ];
}
function matchCli(val) {
  const hits = [];
  for (const [k, t] of Object.entries(CLI)) { if (Math.abs(val - t) < 0.05) hits.push(k); }
  return hits;
}

(async () => {
  console.log(`[VERIFY] cari ONU desc~"${descNeedle}" di ${host}:${port}`);
  const descRows = await walk(DESC);
  const hit = descRows.find(r => String(r.v).toLowerCase().includes(descNeedle));
  if (!hit) { console.log('ONU tidak ditemukan'); process.exit(1); }
  const idx = hit.oid.slice(DESC.length + 1); // "<pon>.<onu>"
  const [pon, onu] = idx.split('.');
  console.log(`Ditemukan: desc="${hit.v}" | pon=${pon} onu=${onu}`);

  // ifName untuk pon (slot path)
  const ifn = await get([`${IFNAME}.${pon}`]);
  console.log(`ifName[pon ${pon}] = ${JSON.stringify(ifn[`${IFNAME}.${pon}`])}`);

  console.log(`\nGround truth CLI: ${JSON.stringify(CLI)}\n`);

  // Dump .50.12.1.1.C.pon.onu.1 untuk C=1..24
  console.log('=== .50.12.1.1.C.' + pon + '.' + onu + '.1 (semua kolom + decoding yang cocok CLI) ===');
  for (let c = 1; c <= 24; c++) {
    const oid = `1.3.6.1.4.1.3902.1012.3.50.12.1.1.${c}.${pon}.${onu}.1`;
    const r = await get([oid]);
    const raw = r[oid];
    if (raw == null) continue;
    const decs = decodings(raw);
    const matches = decs.map(d => ({ ...d, hits: matchCli(d.val) })).filter(d => d.hits.length);
    const matchStr = matches.length ? '  <<< ' + matches.map(m => `${m.enc}=${m.val.toFixed(3)}→${m.hits.join('/')}`).join(' , ') : '';
    console.log(`  c${c} raw=${raw}${matchStr}`);
  }

  // Juga coba tabel optik lain di .50 (mis. .50.13, .50.14, .50.15) utk onu ini
  console.log('\n=== sub-tabel .50.X lain utk ONU ini (cari nilai cocok CLI) ===');
  for (const sub of [11, 13, 14, 15, 16, 17, 18]) {
    for (let c = 1; c <= 12; c++) {
      for (const suffix of [`${pon}.${onu}.1`, `${pon}.${onu}`]) {
        const oid = `1.3.6.1.4.1.3902.1012.3.50.${sub}.1.1.${c}.${suffix}`;
        const r = await get([oid]);
        const raw = r[oid];
        if (raw == null || typeof raw !== 'number') continue;
        const matches = decodings(raw).map(d => ({ ...d, hits: matchCli(d.val) })).filter(d => d.hits.length);
        if (matches.length) console.log(`  .50.${sub}.1.1.${c}.${suffix} raw=${raw}  <<< ` + matches.map(m => `${m.enc}=${m.val.toFixed(3)}→${m.hits.join('/')}`).join(' , '));
        break; // pakai suffix pertama yang ada
      }
    }
  }
  process.exit(0);
})();
