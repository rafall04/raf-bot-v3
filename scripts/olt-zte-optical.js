/**
 * Discovery presisi RX power ZTE C320.
 * 1) Cari ONU online (phaseState .28.2.1.3 == 6).
 * 2) Untuk beberapa ONU, GET semua kolom kandidat optik + tabel state, tampilkan matriks.
 * 3) Bantu bedakan rx-power (dBm, biasanya negatif / butuh transform) vs jarak (meter) dll.
 * Usage: node scripts/olt-zte-optical.js <host> <community> <port>
 */
const snmp = require('net-snmp');
const { host, community, port } = require('./_olt-args')(2);

const PHASE = '1.3.6.1.4.1.3902.1012.3.50'; // akan enumerasi sub-tabel di sini juga
const PHASE_STATE = '1.3.6.1.4.1.3902.1012.3.28.2.1.3';

function session() {
    return snmp.createSession(host, community, { version: snmp.Version2c, port, timeout: 8000, retries: 1 });
}

function walk(base, cap = 4000) {
    return new Promise((resolve) => {
        const s = session(); const rows = []; let done = false;
        const fin = () => { if (done) return; done = true; try { s.close(); } catch (_e) {} resolve(rows); };
        s.on('error', fin);
        s.walk(base, 30, (vbs) => {
            for (const vb of vbs) {
                if (vb.type === snmp.ObjectType.EndOfMibView) { fin(); return; }
                const oid = vb.oid.replace(/^\./, '');
                if (!oid.startsWith(base.replace(/^\./, ''))) { fin(); return; }
                let v = vb.value, t = snmp.ObjectType[vb.type] || vb.type;
                if (Buffer.isBuffer(v)) v = 'str:' + v.toString('utf8').replace(/[\x00-\x1F]/g, '') + '|hex:' + v.toString('hex');
                rows.push({ oid, t, v });
                if (rows.length >= cap) { fin(); return; }
            }
        }, () => fin());
    });
}

function get(oids) {
    return new Promise((resolve) => {
        const s = session();
        s.get(oids, (err, vbs) => {
            try { s.close(); } catch (_e) {}
            if (err) return resolve({});
            const out = {};
            vbs.forEach((vb, i) => {
                if (snmp.isVarbindError(vb)) { out[oids[i]] = null; return; }
                let v = vb.value, t = snmp.ObjectType[vb.type] || vb.type;
                if (Buffer.isBuffer(v)) v = 'str:' + v.toString('utf8').replace(/[\x00-\x1F]/g, '') + '|hex:' + v.toString('hex');
                out[oids[i]] = { v, t };
            });
            resolve(out);
        });
    });
}

(async () => {
    console.log(`[OPTICAL] ${host}:${port}`);

    // 1) Online ONU (phaseState==6).
    const phaseRows = await walk(PHASE_STATE, 5000);
    const online = phaseRows.filter(r => String(r.v) === '6').slice(0, 5)
        .map(r => r.oid.slice(PHASE_STATE.length + 1)); // "<pon>.<onu>"
    console.log(`Online ONU sample (pon.onu): ${online.join(', ')}\n`);

    // 2) Enumerasi sub-tabel di .50 (kolom distinct, contoh nilai) untuk cari tabel DDM.
    console.log('=== Struktur .50 (sub-tabel & contoh) ===');
    const fifty = await walk(PHASE, 6000);
    const cols = new Map();
    for (const r of fifty) {
        // kolom = buang index ONU `.<big>.<onu>[.<sub>]`
        const col = r.oid.replace(/\.\d{6,}(\.\d+){1,2}$/, '');
        if (!cols.has(col)) cols.set(col, { t: r.t, samples: [] });
        const c = cols.get(col);
        if (c.samples.length < 4) c.samples.push(r.v);
    }
    for (const [col, info] of cols) {
        console.log(`${col}  (${info.t})  e.g. ${info.samples.map(x => String(x).slice(0, 24)).join(' , ')}`);
    }

    // 3) Untuk tiap ONU online, GET semua kolom .50.12.1.1.{1..16} (index .pon.onu.1)
    //    dan .28.2.1.{1..8} (index .pon.onu). Tampilkan matriks → cari rx power.
    console.log('\n=== Matriks kolom .50.12.1.1.C untuk ONU online (index .pon.onu.1) ===');
    for (const idx of online) {
        const oids = [];
        for (let c = 1; c <= 16; c++) oids.push(`1.3.6.1.4.1.3902.1012.3.50.12.1.1.${c}.${idx}.1`);
        const res = await get(oids);
        const line = oids.map((o, i) => {
            const r = res[o];
            const c = i + 1;
            return r ? `c${c}=${r.v}` : `c${c}=-`;
        }).join('  ');
        console.log(`ONU ${idx}:`);
        console.log('  ' + line);
    }

    process.exit(0);
})();
