/**
 * Header Doc
 * Purpose: Skrip eksplorasi READ-ONLY CLI ZTE C320 via SSH — dogfood lib/olt-ssh-client.js
 *          ke perangkat asli: tangkap banner/prompt, jalankan baterai perintah `show`,
 *          ukur durasi, dan dump output mentah ke scripts/out/ (gitignored) untuk kalibrasi
 *          parser lib/olt-zte-provision.js.
 * Caller: manual — `node scripts/olt-zte-ssh-explore.js <host> <user> <pass> [phase]`.
 * Deps: ../lib/olt-ssh-client. Kredensial via argv (TIDAK di-hardcode).
 * MainFuncs: main.
 * SideEffects: sesi SSH ke OLT (perintah show saja), tulis file dump di scripts/out/.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { openOltShell } = require('../lib/olt-ssh-client');

const [host, user, pass, phase] = process.argv.slice(2);
if (!host || !user || !pass) {
    console.error('Pakai: node scripts/olt-zte-ssh-explore.js <host> <user> <pass> [phase1|phase2 target]');
    process.exit(1);
}

const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

function save(name, content) {
    const f = path.join(OUT_DIR, `ssh-${name}.txt`);
    fs.writeFileSync(f, content == null ? '(null)' : String(content), 'utf8');
    console.log(`  → tersimpan ${f} (${content ? String(content).length : 0} chars)`);
}

async function timedExec(session, cmd, timeoutMs) {
    const t0 = Date.now();
    try {
        const out = await session.exec(cmd, { timeoutMs: timeoutMs || 20000 });
        const ms = Date.now() - t0;
        console.log(`[OK ${String(ms).padStart(6)}ms] ${cmd} → ${out.length} chars`);
        return { ok: true, ms, out };
    } catch (e) {
        const ms = Date.now() - t0;
        console.log(`[ERR ${String(ms).padStart(5)}ms] ${cmd} → ${e.message.split('\n')[0]}`);
        return { ok: false, ms, out: 'EXEC-ERROR: ' + e.message };
    }
}

(async () => {
    console.log(`Menghubungi ${host}:22 sebagai ${user}…`);
    const device = { host, sshPort: 22, sshUsername: user, sshPassword: pass };
    const t0 = Date.now();
    const session = await openOltShell(device, { connectTimeoutMs: 20000, commandTimeoutMs: 25000 });
    console.log(`TERHUBUNG dalam ${Date.now() - t0}ms`);
    console.log(`PROMPT: ${JSON.stringify(session.prompt)}`);
    save('00-banner', session.banner);

    try {
        if (!phase || phase === 'phase1') {
            // ── Fase 1: identitas + struktur + uncfg + running-config penuh ──
            const battery = [
                ['01-version', 'show version-running', 25000],
                ['02-card', 'show card', 25000],
                ['03-uncfg', 'show gpon onu uncfg', 25000],
                ['04-onu-type', 'show onu-type gpon', 30000],
                ['05-profile-tcont', 'show gpon profile tcont', 25000],
                ['06-profile-traffic', 'show gpon profile traffic', 25000],
                ['07-vlan-summary', 'show vlan summary', 25000],
                ['08-clock', 'show clock', 15000],
            ];
            for (const [name, cmd, to] of battery) {
                const r = await timedExec(session, cmd, to);
                save(name, `$ ${cmd}\n(durasi ${r.ms}ms, ok=${r.ok})\n\n${r.out}`);
            }
            // Running-config penuh — ukur durasi (acuan timeout backup).
            const rc = await timedExec(session, 'show running-config', 300000);
            save('10-running-config', rc.out);
            console.log(`\nshow running-config: ${rc.ms}ms, ${rc.out.length} chars, ${rc.out.split('\n').length} baris`);
        } else if (phase === 'phase2') {
            // ── Fase 2: detail satu ONU nyata (argv[5] = target gpon-onu_x/y/z:N) ──
            const target = process.argv[6];
            if (!target) { console.error('phase2 butuh target, mis. gpon-onu_1/1/1:1'); process.exit(1); }
            const ponPort = target.replace(/^gpon-onu_/, '').split(':')[0];
            const battery = [
                ['20-run-int-gpon-olt', `show running-config interface gpon-olt_${ponPort}`, 30000],
                ['21-detail-info', `show gpon onu detail-info ${target}`, 25000],
                ['22-pon-power', `show pon power attenuation ${target}`, 25000],
                ['23-onu-run-config', `show onu running config ${target}`, 30000],
                ['24-run-int-gpon-onu', `show running-config interface ${target}`, 25000],
                ['25-pon-onu-mng-run', `show running-config pon-onu-mng ${target}`, 25000],
                ['26-onu-state', `show gpon onu state gpon-olt_${ponPort}`, 25000],
                ['27-mac-onu', `show mac gpon onu ${target}`, 25000],
            ];
            for (const [name, cmd, to] of battery) {
                const r = await timedExec(session, cmd, to);
                save(name, `$ ${cmd}\n(durasi ${r.ms}ms, ok=${r.ok})\n\n${r.out}`);
            }
        } else if (phase === 'occ') {
            // ── Sweep okupansi: berapa ONU terdaftar per port PON (argv[5]=slotPrefix mis. 1/2, argv[6]=jumlah port) ──
            const prefix = process.argv[6] || '1/2';
            const nPorts = parseInt(process.argv[7], 10) || 16;
            const all = [];
            for (let p = 1; p <= nPorts; p++) {
                const port = `${prefix}/${p}`;
                const r = await timedExec(session, `show running-config interface gpon-olt_${port}`, 30000);
                const onus = [...r.out.matchAll(/^\s*onu\s+(\d+)\s+type\s+(\S+)\s+sn\s+(\S+)/gm)]
                    .map((m) => ({ id: m[1], type: m[2], sn: m[3] }));
                console.log(`  gpon-olt_${port}: ${onus.length} ONU ${onus.slice(0, 3).map((o) => `${o.id}:${o.type}:${o.sn}`).join(' ')}`);
                all.push(`── gpon-olt_${port} (${onus.length} ONU) ──\n${r.out}`);
            }
            save('40-occupancy-sweep', all.join('\n\n'));
        } else if (phase === 'cmd') {
            // ── Perintah arbitrer (argv[6..] digabung), timeout panjang ──
            const cmd = process.argv.slice(6).join(' ');
            const r = await timedExec(session, cmd, 1500000);
            save('99-cmd', `$ ${cmd}\n(durasi ${r.ms}ms, ok=${r.ok})\n\n${r.out}`);
            console.log(`${cmd}: ${r.ms}ms, ${r.out.length} chars, ${r.out.split('\n').length} baris`);
        } else if (phase === 'rc') {
            // ── Hanya running-config penuh (ukur durasi utk timeout backup) ──
            const rc = await timedExec(session, 'show running-config', 300000);
            save('10-running-config', rc.out);
            console.log(`show running-config: ${rc.ms}ms, ${rc.out.length} chars, ${rc.out.split('\n').length} baris`);
        } else if (phase === 'err-test') {
            // ── Uji perilaku error CLI (perintah show salah — tetap read-only) ──
            const battery = [
                ['30-err-unknown', 'show gpon onu uncfgX', 15000],
                ['31-err-invalid', 'show blablabla', 15000],
                ['32-err-incomplete', 'show gpon onu', 15000],
            ];
            for (const [name, cmd, to] of battery) {
                const r = await timedExec(session, cmd, to);
                save(name, `$ ${cmd}\n(durasi ${r.ms}ms, ok=${r.ok})\n\n${r.out}`);
            }
        }
    } finally {
        session.close();
        console.log('Sesi ditutup.');
    }
})().catch((e) => {
    console.error('GAGAL:', e.message);
    process.exit(1);
});
