/**
 * Header Doc
 * Purpose: Integration test lib/olt-ftp-receiver END-TO-END dengan klien FTP lokal (basic-ftp)
 *          sebagai "OLT tiruan" — memvalidasi jalur produksi: auth kredensial acak sekali-pakai,
 *          deteksi file via scan filesystem (BUKAN event STOR yang tak di-emit server-level di
 *          ftp-srv v4 — regresi yang pernah bikin receiver menggantung 3 menit), pengiriman
 *          byte-identik, dan cleanup dir sementara.
 * Caller: Jest (npm test).
 * Deps: lib/olt-ftp-receiver, basic-ftp, fs/os/path.
 * MainFuncs: -
 * SideEffects: bind FTP server di 127.0.0.1 port loopback tinggi selama test.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('basic-ftp');
const { withFtpReceiver } = require('../olt-ftp-receiver');

// Port loopback tinggi (hindari butuh hak port 21). PASV juga rentang tinggi bebas.
const PORT = 2122;

describe('olt-ftp-receiver (end-to-end, OLT tiruan)', () => {
    test('terima upload via kredensial acak yang diberikan + file byte-identik', async () => {
        const payload = 'olleh\nconfig-version 2.1\n' + 'data'.repeat(400) + '\nend\n';
        let credsSeen = null;

        const recv = await withFtpReceiver(
            { selfHost: '127.0.0.1', port: PORT, pasvMin: 50100, pasvMax: 50130, remoteDir: 'RAF', fileWaitMs: 8000 },
            async (ctx) => {
                credsSeen = { user: ctx.ftpUser, pass: ctx.ftpPass };
                const src = path.join(os.tmpdir(), `recv-test-${ctx.ftpUser}.dat`);
                fs.writeFileSync(src, payload);
                const client = new Client(8000);
                try {
                    await client.access({ host: '127.0.0.1', port: PORT, user: ctx.ftpUser, password: ctx.ftpPass, secure: false });
                    await client.ensureDir(ctx.remoteDir);
                    await client.uploadFrom(src, 'startrun.dat');
                } finally {
                    client.close();
                    fs.unlinkSync(src);
                }
                return { uploaded: true };
            }
        );

        try {
            // Kredensial acak: prefiks 'raf' + cukup panjang (sekali-pakai).
            expect(credsSeen.user).toMatch(/^raf[0-9a-f]+$/);
            expect(credsSeen.pass.length).toBeGreaterThanOrEqual(8);
            // File terdeteksi via scan filesystem (bukan event STOR).
            expect(recv.sizeBytes).toBe(Buffer.byteLength(payload));
            expect(fs.readFileSync(recv.filePath, 'utf8')).toBe(payload);
            expect(recv.fnResult).toEqual({ uploaded: true });
        } finally {
            recv.cleanup();
        }
        // cleanup menghapus dir sementara.
        expect(fs.existsSync(recv.filePath)).toBe(false);
    }, 20000);

    test('fn melempar (upload OLT gagal) → withFtpReceiver melempar & bersih', async () => {
        await expect(withFtpReceiver(
            { selfHost: '127.0.0.1', port: PORT, pasvMin: 50131, pasvMax: 50160, fileWaitMs: 3000 },
            async () => { throw new Error('Perintah upload OLT gagal: Initiate a FTP transfer failed'); }
        )).rejects.toThrow(/upload OLT gagal/);
    }, 15000);

    test('tanpa selfHost → tolak segera', async () => {
        await expect(withFtpReceiver({}, async () => {})).rejects.toThrow(/selfHost/);
    });
});
