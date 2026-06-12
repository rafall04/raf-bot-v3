/**
 * Header Doc
 * Purpose: Self-test lib/olt-ftp-receiver TANPA OLT — klien FTP lokal (basic-ftp) sebagai
 *          "OLT tiruan" memvalidasi jalur produksi: kredensial acak sekali-pakai, PASV range
 *          terpin, STOR, pengiriman file byte-identik. Menutup risiko sisa saat SSH OLT terkunci.
 * Caller: manual — `node scripts/olt-ftp-receiver-selftest.js`.
 * Deps: ../lib/olt-ftp-receiver, basic-ftp, fs/os/path.
 * MainFuncs: main (dengan pagar timeout keras).
 * SideEffects: FTP server sementara di 127.0.0.1:2121 (loopback), file temp.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('basic-ftp');
const { withFtpReceiver } = require('../lib/olt-ftp-receiver');

const PORT = 2121;
const PAYLOAD = 'olleh\nconfig-version 2.1\n! startup-config tiruan\n' + 'x'.repeat(5000) + '\nend\n';

// Pagar keras: apa pun yang terjadi, proses tidak menggantung > 30 dtk.
const hardTimer = setTimeout(() => { console.error('❌ TIMEOUT KERAS 30s — ada yang menggantung'); process.exit(2); }, 30000);
hardTimer.unref();

function log(...a) { console.log('[test]', ...a); }

(async () => {
    log('mulai; bind receiver 127.0.0.1:' + PORT);
    const recv = await withFtpReceiver(
        { selfHost: '127.0.0.1', port: PORT, pasvMin: 50000, pasvMax: 50050, remoteDir: 'RAF' },
        async (ctx) => {
            log(`receiver siap; upload sebagai ${ctx.ftpUser} (pass ${ctx.ftpPass.length} char) → /${ctx.remoteDir}`);
            const client = new Client(12000);
            client.ftp.verbose = false;
            const srcTmp = path.join(os.tmpdir(), 'selftest-src-' + ctx.ftpUser + '.dat');
            fs.writeFileSync(srcTmp, PAYLOAD);
            try {
                log('client.access…');
                await client.access({ host: '127.0.0.1', port: PORT, user: ctx.ftpUser, password: ctx.ftpPass, secure: false });
                log('access OK; ensureDir + uploadFrom startrun.dat…');
                await client.ensureDir(ctx.remoteDir);
                await client.uploadFrom(srcTmp, 'startrun.dat');
                log('upload selesai');
            } finally {
                client.close();
                fs.unlinkSync(srcTmp);
            }
            return { uploaded: true };
        }
    );

    const received = fs.readFileSync(recv.filePath, 'utf8');
    const byteIdentik = received === PAYLOAD;
    log(`file diterima: ${recv.sizeBytes} bytes`);
    recv.cleanup();
    clearTimeout(hardTimer);

    const pass = byteIdentik && recv.fnResult && recv.fnResult.uploaded && recv.sizeBytes === Buffer.byteLength(PAYLOAD);
    console.log('\n── HASIL ──');
    console.log('  random cred + PASV pin + STOR :', !!(recv.fnResult && recv.fnResult.uploaded));
    console.log('  file byte-identik diterima    :', byteIdentik);
    console.log(pass ? '\n✅ LULUS — jalur receiver produksi valid' : '\n❌ GAGAL');
    process.exit(pass ? 0 : 1);
})().catch((e) => {
    clearTimeout(hardTimer);
    console.error('GAGAL:', e.message);
    process.exit(1);
});
