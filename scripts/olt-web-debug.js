/**
 * Header Doc
 * Purpose: Alat debug OLT lewat WEB (pengganti 18 skrip debug SNMP yang dibuang di #b283).
 *          SNMP membuat OLT HIOSO hang, jadi kemampuan debugnya dipindah, bukan dihapus.
 *          Subperintah:
 *            list                       — daftar OLT terdaftar + PON-nya
 *            onus <olt>                 — semua ONU di satu OLT (halaman daftar, bisa nge-cache)
 *            onu  <olt> <pon> <onuId>   — SATU ONU dari halamannya sendiri (angka paling nyata)
 *            log  <olt> [halaman]       — log OLT hasil scraping halaman
 *          <olt> boleh id, nama, atau host.
 * Caller: manual (teknisi/operator) — `node scripts/olt-web-debug.js <subperintah>`
 * Deps: ../lib/olt-manager, ../lib/olt-web-optical, ../lib/olt-log-scraper, ../lib/env-config
 * MainFuncs: main
 * SideEffects: HTTP GET read-only ke web OLT. Tidak menulis apa pun. TIDAK memakai SNMP.
 */

const { loadConfig } = require('../lib/env-config');

function cariOlt(daftar, kunci) {
    const k = String(kunci || '').toLowerCase();
    return daftar.find((d) =>
        String(d.id).toLowerCase() === k ||
        String(d.name || '').toLowerCase() === k ||
        String(d.host || '').toLowerCase() === k
    ) || null;
}

function fmt(v, satuan) {
    if (v == null || v === '' || v === 'N/A') return '—';
    return satuan ? v + ' ' + satuan : String(v);
}

async function main() {
    global.config = loadConfig();
    const oltManager = require('../lib/olt-manager');
    const web = require('../lib/olt-web-optical');

    const [sub, arg1, arg2, arg3] = process.argv.slice(2);
    const daftar = oltManager.getOltDevices() || [];

    if (!sub || sub === 'list') {
        if (!daftar.length) { console.log('Tidak ada OLT terdaftar.'); return; }
        for (const d of daftar) {
            const punyaWeb = d.webUsername ? 'ada' : 'BELUM DIISI';
            console.log('- ' + d.id + ' | ' + (d.name || '?') + ' | ' + d.host
                + ' | merk=' + (d.brand || 'auto') + ' | kredensial web: ' + punyaWeb);
            if (!d.webUsername) continue;
            const hal = await web.fetchPage(d, '/onuConfigPonList.asp');
            if (!hal || !hal.ok) {
                console.log('    PON: GAGAL dibaca — ' + ((hal && (hal.err || ('HTTP ' + hal.code))) || 'tak diketahui'));
                continue;
            }
            const pon = web.parsePonList(hal.body);
            console.log('    PON: ' + (pon.length ? pon.join(', ') : '(kosong)'));
        }
        return;
    }

    const dev = cariOlt(daftar, arg1);
    if (!dev) { console.log('OLT tidak ketemu: ' + arg1 + '. Coba `list` dulu.'); process.exitCode = 1; return; }
    if (!dev.webUsername) { console.log('Kredensial web OLT ini belum diisi — SNMP tidak dipakai (bikin hang).'); process.exitCode = 1; return; }

    if (sub === 'onus') {
        const snap = await web.getWebOpticalSnapshot({ getDevices: () => [dev] });
        if (snap.status !== 'success') { console.log('GAGAL: ' + snap.message); process.exitCode = 1; return; }
        for (const f of snap.failedOlts || []) console.log('!! OLT tak terbaca: ' + f.message);
        console.log('ONU terbaca: ' + (snap.onus || []).length);
        console.log('ONU-ID           MAC                STATUS    RX(dBm)  TX(dBm)');
        for (const o of snap.onus || []) {
            console.log(String(o.onuId || '').padEnd(16)
                + String(o.macAddress || '—').padEnd(19)
                + String(o.status || '—').padEnd(10)
                + String(fmt(o.rxPower)).padStart(7) + '  '
                + String(fmt(o.txPower)).padStart(7));
        }
        console.log('');
        console.log('CATATAN: halaman daftar kadang menyajikan angka lama. Untuk keputusan,');
        console.log('pakai `onu <olt> <pon> <onuId>` yang membaca halaman ONU-nya sendiri.');
        return;
    }

    if (sub === 'onu') {
        if (!arg2 || !arg3) { console.log('Pemakaian: onu <olt> <pon> <onuId>   contoh: onu 1 0/1/1 0/1/1:5'); process.exitCode = 1; return; }
        const r = await web.bacaOnuSegar(dev, arg2, arg3);
        if (!r || !r.ok) { console.log('GAGAL: ' + ((r && r.err) || 'tak terbaca')); process.exitCode = 1; return; }
        console.log('ONU     : ' + arg3);
        console.log('RX Power: ' + fmt(r.rxPower, 'dBm'));
        console.log('TX Power: ' + fmt(r.txPower, 'dBm'));
        if (r.rxPower == null) console.log('(RX kosong = ONU tak menjawab. Angka dBm lama SENGAJA tidak ditampilkan.)');
        return;
    }

    if (sub === 'log') {
        const scraper = require('../lib/olt-log-scraper');
        // fetchOltLog POSISIONAL: (host, user, pass, maxPages, jendelaMenit, hwmMs, port).
        // Kedalaman sebenarnya + alasan berhenti dicetak modulnya sendiri ke console
        // ([OLT-Scraper] ...) — termasuk peringatan TERPOTONG / CELAH DATA. Jangan ditelan.
        const halaman = arg2 ? Number(arg2) : undefined;
        const baris = await scraper.fetchOltLog(
            dev.host, dev.webUsername, dev.webPassword,
            halaman, 10, null, dev.webPort || 80
        ) || [];
        console.log('Baris log: ' + baris.length);
        console.log('');
        for (const b of baris.slice(0, 200)) console.log(typeof b === 'string' ? b : JSON.stringify(b));
        if (baris.length > 200) console.log('... (' + (baris.length - 200) + ' baris lagi)');
        console.log('');
        console.log('CATATAN: JAM DI OLT TIDAK DIPERCAYA (NTP sering meleset). Urutan kejadian');
        console.log('yang dipakai, bukan jamnya. Silang dengan syslog untuk waktu sebenarnya.');
        return;
    }

    console.log('Subperintah tidak dikenal: ' + sub);
    console.log('Pakai: list | onus <olt> | onu <olt> <pon> <onuId> | log <olt> [halaman]');
    process.exitCode = 1;
}

main().catch((e) => { console.error('GAGAL:', e && e.message); process.exitCode = 1; });
