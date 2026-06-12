/**
 * Header Doc
 * Purpose: FTP receiver ON-DEMAND untuk backup OLT — menyalakan server FTP sementara
 *          (ftp-srv) hanya selama proses backup, menerima upload `startrun.dat` dari OLT
 *          (`file upload cfg-startup ... ftp ...`), lalu mati. Kredensial acak sekali-pakai
 *          per run; root dir unik per run di tmp/.
 * Caller: lib/olt-backup.js (metode backup 'ftp').
 * Deps: ftp-srv, fs, path, os, crypto.
 * MainFuncs: withFtpReceiver(opts, fn) — jalankan fn saat server hidup, kembalikan file
 *            yang diterima.
 * SideEffects: bind TCP port FTP (default 21) selama backup; tulis/hapus dir sementara.
 *
 * VERIF LIVE C320 V2.1.0: OLT login PASV ke ftp-srv (pasv_url=IP bot), STOR startrun.dat
 * (±500KB dalam ~9 dtk). Nama file tujuan TIDAK bisa custom (%Code 65639) — selalu
 * `startrun.dat`; rename dilakukan pemanggil setelah file diterima.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/**
 * Jalankan FTP server sementara, panggil `fn(ctx)` (biasanya: suruh OLT upload via SSH),
 * lalu tunggu satu file selesai di-upload.
 *
 * @param {object} opts
 * @param {string} opts.selfHost   IP host bot yang DIJANGKAU OLT (dipakai pasv_url & perintah CLI)
 * @param {number} [opts.port=21]  port FTP (ZXAN tidak mendukung port custom — biarkan 21)
 * @param {string} [opts.remoteDir='RAF'] path yang diminta OLT (dibuat di bawah root sementara)
 * @param {number} [opts.fileWaitMs=180000] batas tunggu file masuk setelah fn selesai
 * @param {number} [opts.pasvMin=50000] port PASV minimum (firewall: buka rentang ini)
 * @param {number} [opts.pasvMax=50050] port PASV maksimum
 * @param {(ctx: {ftpUser: string, ftpPass: string, remoteDir: string}) => Promise<any>} fn
 * @returns {Promise<{filePath: string, sizeBytes: number, fnResult: any, cleanup: () => void}>}
 *          filePath = file yang diterima (masih di dir sementara — PINDAHKAN lalu panggil cleanup()).
 */
async function withFtpReceiver(opts, fn) {
    const selfHost = opts && opts.selfHost;
    if (!selfHost) throw new Error('withFtpReceiver: selfHost (IP bot yang dijangkau OLT) wajib diisi');
    const port = (opts && opts.port) || 21;
    const remoteDir = (opts && opts.remoteDir) || 'RAF';
    const fileWaitMs = (opts && opts.fileWaitMs) || 180000;
    // PASV range DITEKAN ke rentang sempit yang deterministik supaya di server produksi
    // operator cukup membuka satu rentang firewall (bukan 1024-65535 acak). 50 port cukup
    // untuk satu transfer pada satu waktu (backup serial per host).
    const pasvMin = (opts && opts.pasvMin) || 50000;
    const pasvMax = (opts && opts.pasvMax) || 50050;

    // Lazy-require supaya app tetap bisa start bila dependency belum terpasang.
    let FtpSrv;
    try {
        ({ FtpSrv } = require('ftp-srv'));
    } catch (_e) {
        throw new Error('Dependency ftp-srv belum terpasang (npm install ftp-srv)');
    }

    // Kredensial acak sekali-pakai (muncul di perintah CLI/log — tidak masalah karena hangus).
    const ftpUser = 'raf' + crypto.randomBytes(3).toString('hex');
    const ftpPass = crypto.randomBytes(8).toString('hex');

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olt-ftp-'));
    fs.mkdirSync(path.join(rootDir, remoteDir), { recursive: true });

    // Senyapkan logger bawaan ftp-srv (bunyan JSON ke stdout — berisik di log bot).
    let quietLog;
    try {
        const bunyan = require('bunyan');
        quietLog = bunyan.createLogger({ name: 'olt-ftp', level: 'fatal' });
    } catch (_e) { quietLog = undefined; }

    const server = new FtpSrv({
        url: `ftp://0.0.0.0:${port}`,
        pasv_url: selfHost,
        pasv_min: pasvMin,
        pasv_max: pasvMax,
        anonymous: false,
        greeting: 'RAF-BOT OLT backup receiver',
        ...(quietLog ? { log: quietLog } : {}),
    });

    // STOR di ftp-srv v4 di-emit pada KONEKSI (bukan server) — hook lewat login event
    // sebagai fast-path. Sumber kebenaran tetap scan filesystem (lihat di bawah) supaya
    // deteksi tak bergantung nama/letak event antar versi ftp-srv.
    let storError = null;
    let storPath = null;
    server.on('login', ({ connection, username, password }, resolve, reject) => {
        if (username === ftpUser && password === ftpPass) {
            if (connection && typeof connection.on === 'function') {
                connection.on('STOR', (error, filePath) => {
                    if (error) storError = error;
                    else storPath = filePath;
                });
            }
            resolve({ root: rootDir });
        } else {
            reject(new Error('Kredensial FTP salah'));
        }
    });

    const cleanup = () => {
        try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch (_e) { /* abaikan */ }
    };

    /** Cari file teratas (terbaru) di bawah rootDir, abaikan direktori. */
    const findReceivedFile = () => {
        const found = [];
        const walk = (dir) => {
            for (const name of fs.readdirSync(dir)) {
                const full = path.join(dir, name);
                let st;
                try { st = fs.statSync(full); } catch (_e) { continue; }
                if (st.isDirectory()) walk(full);
                else found.push({ full, mtime: st.mtimeMs, size: st.size });
            }
        };
        try { walk(rootDir); } catch (_e) { /* abaikan */ }
        found.sort((a, b) => b.mtime - a.mtime);
        return found[0] || null;
    };

    try {
        await server.listen();
    } catch (e) {
        cleanup();
        throw new Error(`Gagal buka FTP receiver di port ${port}: ${e.message} (port dipakai aplikasi lain? mis. FileZilla)`);
    }

    try {
        const fnResult = await fn({ ftpUser, ftpPass, remoteDir });

        // fn selesai (perintah CLI OLT sudah balas "Successfully"). File mestinya sudah
        // ada di disk; tunggu sampai muncul (jaring untuk flush STOR terakhir).
        const t0 = Date.now();
        let file = findReceivedFile();
        while (!file && !storError && Date.now() - t0 < fileWaitMs) {
            await new Promise((r) => setTimeout(r, 250));
            file = findReceivedFile();
        }
        if (storError) throw new Error(`Transfer FTP gagal: ${storError.message}`);
        if (!file) throw new Error('OLT tidak mengirim file ke FTP receiver (cek route OLT → host bot, firewall port 21+PASV, & output CLI)');

        const filePath = storPath && fs.existsSync(storPath) ? storPath : file.full;
        const sizeBytes = fs.statSync(filePath).size;
        return { filePath, sizeBytes, fnResult, cleanup };
    } catch (e) {
        cleanup();
        throw e;
    } finally {
        try { await server.close(); } catch (_e) { /* abaikan */ }
    }
}

module.exports = { withFtpReceiver };
