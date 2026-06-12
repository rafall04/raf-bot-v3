/**
 * Header Doc
 * Purpose: Uji siklus hidup provisioning ONU di OLT ZTE ASLI memakai service produksi
 *          (lib/olt-zte-provision): okupansi → registrasi SN dummy di port KOSONG →
 *          status → viewer konfig → hapus (rollback) → verifikasi bersih. TANPA `write`
 *          — startup-config OLT tidak tersentuh; running-config kembali persis semula.
 * Caller: manual — `node scripts/olt-zte-live-cycle.js <host> <user> <pass> <ponPort> [sn]`.
 * Deps: ../lib/olt-zte-provision, ../lib/olt-provision-store.
 * MainFuncs: main. GUARD: batal bila port target ADA isinya (jangan ganggu pelanggan).
 * SideEffects: menambah lalu MENGHAPUS satu entri ONU dummy di running-config OLT target.
 */

'use strict';

const provision = require('../lib/olt-zte-provision');
const store = require('../lib/olt-provision-store');

const [host, user, pass, ponPort, snArg] = process.argv.slice(2);
if (!host || !user || !pass || !ponPort) {
    console.error('Pakai: node scripts/olt-zte-live-cycle.js <host> <user> <pass> <ponPort-kosong> [sn]');
    process.exit(1);
}
const sn = (snArg || 'ZTEGDEAD0001').toUpperCase();

const device = { id: 'live-test', name: 'live-test', host, sshPort: 22, sshUsername: user, sshPassword: pass };

(async () => {
    // 0) Guard: port target HARUS kosong — kita tidak menyentuh port berpelanggan.
    console.log(`\n[0] Cek okupansi gpon-olt_${ponPort}…`);
    const occ = await provision.getPonOccupancy(device, ponPort);
    console.log(`    terpakai: ${occ.usedIds.length} ONU; saran ID: ${occ.suggestedId}`);
    if (occ.usedIds.length !== 0) {
        console.error(`BATAL: port ${ponPort} tidak kosong (${occ.usedIds.length} ONU). Pilih port kosong.`);
        process.exit(2);
    }

    // 1) Registrasi dummy via template bridge bawaan + nilai yang ADA di OLT ini.
    const profile = store.getOnuType('zte-bridge');
    const vars = {
        ...profile.vars,
        ponPort,
        onuId: String(occ.suggestedId),
        sn,
        onuType: 'ALL',
        tcontProfile: '1G',   // profil tcont nyata di OLT (verif show gpon profile tcont)
        downProfile: '1G',    // profil traffic nyata
        pppoeVlan: '300',     // VLAN nyata
        name: 'TEST-CLAUDE-AUTO',
        description: 'TEST-AKAN-DIHAPUS',
    };
    console.log(`\n[1] Registrasi ONU dummy sn=${sn} → gpon-onu_${ponPort}:${vars.onuId} (template ${profile.id})…`);
    const reg = await provision.registerOnu(device, profile.scriptTemplate, vars, { saveConfig: false });
    for (const r of reg.results) {
        console.log(`    ${r.ok ? '✓' : '✗'} ${r.command}${r.error ? '  ← ' + r.error : ''}`);
    }
    if (!reg.ok) {
        console.error(`REGISTRASI GAGAL di perintah #${reg.failedIndex + 1} — lihat di atas. Mencoba bersih-bersih…`);
        await provision.deleteOnu(device, ponPort, vars.onuId).catch(() => {});
        process.exit(3);
    }
    console.log('    REGISTRASI OK');

    // 2) Status ONU (dummy → diharapkan OffLine/DOWN tapi terdaftar dengan SN benar).
    console.log(`\n[2] Status gpon-onu_${ponPort}:${vars.onuId}…`);
    const st = await provision.getOnuStatus(device, ponPort, vars.onuId);
    console.log('    detail:', JSON.stringify(st.detail));
    console.log('    power :', JSON.stringify(st.power));

    // 3) Viewer konfigurasi.
    console.log('\n[3] Konfigurasi ONU (viewer)…');
    const cfg = await provision.getOnuFullConfig(device, ponPort, vars.onuId);
    console.log('    interface:', JSON.stringify(cfg.interfaceConfig.slice(0, 220)));
    console.log('    onu-mng  :', JSON.stringify(cfg.onuMngConfig.slice(0, 220)));

    // 4) Okupansi harus berisi dummy kita.
    const occ2 = await provision.getPonOccupancy(device, ponPort);
    const found = occ2.used.find((u) => u.sn === sn);
    console.log(`\n[4] Okupansi pasca-registrasi: ${occ2.usedIds.length} ONU; dummy ${found ? 'DITEMUKAN ✓' : 'TIDAK DITEMUKAN ✗'}`);

    // 5) Rollback.
    console.log('\n[5] Hapus ONU dummy (rollback)…');
    const del = await provision.deleteOnu(device, ponPort, vars.onuId, { saveConfig: false });
    for (const r of del.results) {
        console.log(`    ${r.ok ? '✓' : '✗'} ${r.command}${r.error ? '  ← ' + r.error : ''}`);
    }
    if (!del.ok) {
        console.error('HAPUS GAGAL — bersihkan manual: conf t; int gpon-olt_' + ponPort + '; no onu ' + vars.onuId);
        process.exit(4);
    }

    // 6) Verifikasi bersih.
    const occ3 = await provision.getPonOccupancy(device, ponPort);
    console.log(`\n[6] Okupansi akhir: ${occ3.usedIds.length} ONU (harus 0)`);
    if (occ3.usedIds.length !== 0) {
        console.error('PERINGATAN: port tidak kembali kosong!');
        process.exit(5);
    }
    console.log('\n══ SIKLUS LIVE LENGKAP: registrasi → status → konfig → rollback SEMUA OK ══');
})().catch((e) => {
    console.error('GAGAL:', e.message);
    process.exit(1);
});
