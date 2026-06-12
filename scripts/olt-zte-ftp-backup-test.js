/**
 * Header Doc
 * Purpose: Uji live backup OLT via FTP — jalankan FTP server lokal sementara (ftp-srv),
 *          lalu perintahkan OLT (SSH) `file upload cfg-startup <nama> ftp ...` dan amati:
 *          output CLI, nama file yang sampai, durasi, dan dukungan nama file custom.
 * Caller: manual — `node scripts/olt-zte-ftp-backup-test.js <oltHost> <user> <pass> <selfIp> [destName]`.
 * Deps: ftp-srv, ../lib/olt-ssh-client. Kredensial via argv.
 * MainFuncs: main.
 * SideEffects: FTP server sementara di port 21 (berhenti saat selesai), file masuk scripts/out/ftp-recv/.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { FtpSrv } = require('ftp-srv');
const { runOltCommands } = require('../lib/olt-ssh-client');

const [oltHost, user, pass, selfIp, destNameArg] = process.argv.slice(2);
if (!oltHost || !user || !pass || !selfIp) {
    console.error('Pakai: node scripts/olt-zte-ftp-backup-test.js <oltHost> <sshUser> <sshPass> <selfIp> [destName]');
    process.exit(1);
}
const destName = destNameArg || 'startrun.dat';

const RECV_ROOT = path.join(__dirname, 'out', 'ftp-recv');
fs.mkdirSync(path.join(RECV_ROOT, 'OLT'), { recursive: true });

(async () => {
    // 1) FTP server sementara — kredensial sama dgn perintah (zte/zte ala user).
    const ftpServer = new FtpSrv({
        url: `ftp://0.0.0.0:21`,
        pasv_url: selfIp,
        anonymous: false,
        greeting: 'RAF-BOT OLT backup receiver (test)',
    });
    const uploaded = [];
    ftpServer.on('login', ({ username, password }, resolve, reject) => {
        console.log(`[FTP] login ${username}/${'*'.repeat(password.length)}`);
        if (username === 'zte' && password === 'zte') {
            resolve({ root: RECV_ROOT });
        } else {
            reject(new Error('kredensial salah'));
        }
    });
    ftpServer.on('STOR', (error, filePath) => {
        if (error) console.log('[FTP] STOR error:', error.message);
        else { console.log('[FTP] STOR selesai:', filePath); uploaded.push(filePath); }
    });
    await ftpServer.listen();
    console.log(`[FTP] server sementara aktif di 0.0.0.0:21 (pasv ${selfIp}), root ${RECV_ROOT}`);

    // 2) Perintah upload dari OLT.
    const device = { host: oltHost, sshPort: 22, sshUsername: user, sshPassword: pass };
    const cmd = `file upload cfg-startup ${destName} ftp ipaddress ${selfIp} path OLT user zte password zte`;
    console.log(`\n[SSH] ${cmd}`);
    const t0 = Date.now();
    const res = await runOltCommands(device, [cmd], {
        checkErrors: true,
        commandTimeoutMs: 300000,
    });
    const r = res.results[0] || {};
    console.log(`[SSH] selesai ${Date.now() - t0}ms ok=${r.ok}`);
    console.log('────── output CLI ──────');
    console.log(r.output || '(kosong)');
    console.log('────────────────────────');
    if (r.error) console.log('error terdeteksi:', r.error);

    // 3) Apa yang sampai?
    await new Promise((res2) => setTimeout(res2, 1500));
    const files = fs.readdirSync(path.join(RECV_ROOT, 'OLT')).map((f) => {
        const st = fs.statSync(path.join(RECV_ROOT, 'OLT', f));
        return `${f} (${st.size} bytes, ${st.mtime.toISOString()})`;
    });
    console.log('\nFile di ftp-recv/OLT:', files.length ? files.join('\n  ') : '(tidak ada)');

    await ftpServer.close();
    console.log('[FTP] server ditutup.');
    process.exit(0);
})().catch((e) => {
    console.error('GAGAL:', e.message);
    process.exit(1);
});
