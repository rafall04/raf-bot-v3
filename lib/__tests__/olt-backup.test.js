/**
 * Header Doc
 * Purpose: Unit test backup OLT — penulisan file backup (header + isi), retensi (prune
 *          terlama), listing terurut, dan guard path-traversal pada resolve file download.
 *          Capture SSH di-inject (mock) — tidak ada koneksi keluar.
 * Caller: Jest (npm test).
 * Deps: lib/olt-backup, fs/path/os (temp dir per test).
 * MainFuncs: -
 * SideEffects: tulis/hapus file di direktori temp OS (dibersihkan di afterEach).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const backup = require('../olt-backup');

describe('olt-backup', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'olt-backup-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const device = {
        id: 'olt1',
        name: 'OLT Pusat',
        host: '10.0.0.2',
        sshUsername: 'zte',
        sshPassword: 'rahasia',
    };

    test('runBackupForDevice: menulis file .cfg berisi header + konfigurasi', async () => {
        const capture = jest.fn().mockResolvedValue('interface gpon-olt_1/3/16\n  onu 8 type ALL sn ZTEGCCA16805\nend');
        const res = await backup.runBackupForDevice(device, { baseDir: tmpDir, method: 'capture', capture, sendTelegram: false });

        expect(res.ok).toBe(true);
        expect(res.file).toMatch(/^olt1_\d{8}-\d{6}\.cfg$/);
        expect(res.telegram).toBeNull();
        const content = fs.readFileSync(path.join(tmpDir, 'olt1', res.file), 'utf8');
        expect(content).toContain('! Backup konfigurasi OLT — OLT Pusat (10.0.0.2)');
        expect(content).toContain('onu 8 type ALL sn ZTEGCCA16805');
        expect(capture).toHaveBeenCalledWith(device);
    });

    test('runBackupForDevice: tanpa kredensial SSH → gagal dengan pesan jelas', async () => {
        const capture = jest.fn();
        const res = await backup.runBackupForDevice({ id: 'olt2', name: 'X', host: 'h' }, { baseDir: tmpDir, capture });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/SSH belum dikonfigurasi/);
        expect(capture).not.toHaveBeenCalled();
    });

    test('runBackupForDevice: capture gagal → ok=false, tidak melempar', async () => {
        const capture = jest.fn().mockRejectedValue(new Error('Timeout koneksi SSH'));
        const res = await backup.runBackupForDevice(device, { baseDir: tmpDir, method: 'capture', capture, sendTelegram: false });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/Timeout/);
    });

    test('retensi: file terlama dihapus melebihi keep', async () => {
        const dir = path.join(tmpDir, 'olt1');
        fs.mkdirSync(dir, { recursive: true });
        // 3 file lama dengan mtime menaik.
        for (let i = 1; i <= 3; i++) {
            const f = path.join(dir, `olt1_2024010${i}-000000.cfg`);
            fs.writeFileSync(f, 'lama ' + i);
            fs.utimesSync(f, new Date(2024, 0, i), new Date(2024, 0, i));
        }
        const capture = jest.fn().mockResolvedValue('config baru yang cukup panjang untuk lolos validasi minimal');
        const res = await backup.runBackupForDevice(device, { baseDir: tmpDir, method: 'capture', capture, keep: 2, sendTelegram: false });

        expect(res.ok).toBe(true);
        const remaining = fs.readdirSync(dir).sort();
        expect(remaining).toHaveLength(2); // keep=2: file baru + 1 terbaru dari yang lama
        expect(remaining).toContain(res.file);
        expect(remaining).not.toContain('olt1_20240101-000000.cfg');
        expect(remaining).not.toContain('olt1_20240102-000000.cfg');
    });

    test('listBackups: terurut terbaru dulu + filter device', async () => {
        const capture = jest.fn().mockResolvedValue('isi konfigurasi panjang untuk listing dan pengurutan backup');
        await backup.runBackupForDevice(device, { baseDir: tmpDir, method: 'capture', capture, sendTelegram: false });
        await backup.runBackupForDevice({ ...device, id: 'olt2', name: 'OLT 2' }, { baseDir: tmpDir, method: 'capture', capture, sendTelegram: false });

        const all = backup.listBackups(null, tmpDir);
        expect(all).toHaveLength(2);
        expect(all[0].mtime >= all[1].mtime).toBe(true);

        const only1 = backup.listBackups('olt1', tmpDir);
        expect(only1).toHaveLength(1);
        expect(only1[0].deviceId).toBe('olt1');
    });

    test('resolveBackupFile: guard path traversal & ekstensi', async () => {
        const capture = jest.fn().mockResolvedValue('isi konfigurasi panjang untuk uji resolve file download');
        const res = await backup.runBackupForDevice(device, { baseDir: tmpDir, method: 'capture', capture, sendTelegram: false });

        const okPath = backup.resolveBackupFile('olt1', res.file, tmpDir);
        expect(fs.existsSync(okPath)).toBe(true);

        expect(() => backup.resolveBackupFile('olt1', '../../config.json', tmpDir)).toThrow(/tidak valid/);
        expect(() => backup.resolveBackupFile('olt1', 'abc.txt', tmpDir)).toThrow(/tidak valid/);
        expect(() => backup.resolveBackupFile('olt1', 'tidak-ada.cfg', tmpDir)).toThrow(/tidak ditemukan/);
    });

    test('getBackupSettings: default aman saat config kosong', () => {
        const s = backup.getBackupSettings();
        expect(typeof s.enabled).toBe('boolean');
        expect(typeof s.schedule).toBe('string');
        expect(s.keep).toBeGreaterThanOrEqual(1);
        expect(['ftp', 'capture']).toContain(s.method);
    });

    // ── Metode FTP (receiver on-demand + file upload cfg-startup) ──
    // ftpReceive & ftpUpload di-inject; tidak ada SSH/FTP nyata.

    /** Tiruan withFtpReceiver: jalankan fn lalu "terima" file dummy startrun.dat. */
    function fakeReceiver(uploadOk = true) {
        return async (recvOpts, fn) => {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-recv-'));
            const recvFile = path.join(tmp, 'startrun.dat');
            // fn = perintah upload OLT; harus dapat kredensial sekali-pakai.
            const fnResult = await fn({ ftpUser: 'rafabc123', ftpPass: 'deadbeef', remoteDir: 'RAF' });
            if (!uploadOk) throw new Error('upload OLT gagal');
            fs.writeFileSync(recvFile, 'olleh\nconfig-version 2.1\n! isi startup-config dummy\n');
            return { filePath: recvFile, sizeBytes: 60, fnResult, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
        };
    }

    test('metode ftp: file .dat tersimpan byte-identik (verif live: startrun.dat 498KB)', async () => {
        const ftpUpload = jest.fn().mockResolvedValue({ ok: true, output: 'Successfully', error: null });
        const res = await backup.runBackupForDevice(device, {
            baseDir: tmpDir, method: 'ftp', ftpSelfHost: '172.17.231.2',
            ftpReceive: fakeReceiver(true), ftpUpload, sendTelegram: false,
        });
        expect(res.ok).toBe(true);
        expect(res.method).toBe('ftp');
        expect(res.file).toMatch(/^olt1_\d{8}-\d{6}\.dat$/);
        const content = fs.readFileSync(path.join(tmpDir, 'olt1', res.file), 'utf8');
        expect(content).toContain('config-version 2.1'); // tanpa header tambahan — apa adanya
        expect(content).not.toContain('! Backup konfigurasi OLT —'); // header capture TIDAK dipasang
        // upload dipanggil dengan kredensial sekali-pakai dari receiver.
        expect(ftpUpload).toHaveBeenCalledWith(device, expect.objectContaining({
            selfHost: '172.17.231.2', ftpUser: 'rafabc123', ftpPass: 'deadbeef',
        }));
    });

    test('metode ftp tanpa ftpSelfHost → gagal jelas', async () => {
        const res = await backup.runBackupForDevice(device, {
            baseDir: tmpDir, method: 'ftp', ftpSelfHost: '',
            ftpReceive: fakeReceiver(true), ftpUpload: jest.fn(), ftpFallbackCapture: false,
        });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/ftpSelfHost|IP bot/i);
    });

    test('ftp gagal + fallback capture → tetap kebackup sebagai .cfg', async () => {
        const failingReceive = async () => { throw new Error('OLT tidak mengirim file ke FTP receiver'); };
        const capture = jest.fn().mockResolvedValue('running config hasil fallback yang cukup panjang');
        const res = await backup.runBackupForDevice(device, {
            baseDir: tmpDir, method: 'ftp', ftpSelfHost: '172.17.231.2',
            ftpReceive: failingReceive, ftpUpload: jest.fn(), capture,
            ftpFallbackCapture: true, sendTelegram: false,
        });
        expect(res.ok).toBe(true);
        expect(res.method).toBe('capture-fallback');
        expect(res.file).toMatch(/\.cfg$/);
        expect(capture).toHaveBeenCalled();
    });

    test('ftp gagal + fallback OFF → gagal (tidak diam-diam capture)', async () => {
        const failingReceive = async () => { throw new Error('route OLT→bot belum ada'); };
        const capture = jest.fn();
        const res = await backup.runBackupForDevice(device, {
            baseDir: tmpDir, method: 'ftp', ftpSelfHost: '172.17.231.2',
            ftpReceive: failingReceive, ftpUpload: jest.fn(), capture,
            ftpFallbackCapture: false,
        });
        expect(res.ok).toBe(false);
        expect(capture).not.toHaveBeenCalled();
    });

    test('listBackups & resolveBackupFile mengenali .dat (metode ftp)', async () => {
        const ftpUpload = jest.fn().mockResolvedValue({ ok: true, output: 'Successfully' });
        const res = await backup.runBackupForDevice(device, {
            baseDir: tmpDir, method: 'ftp', ftpSelfHost: '172.17.231.2',
            ftpReceive: fakeReceiver(true), ftpUpload, sendTelegram: false,
        });
        const list = backup.listBackups('olt1', tmpDir);
        expect(list.some((f) => f.file === res.file)).toBe(true);
        const okPath = backup.resolveBackupFile('olt1', res.file, tmpDir);
        expect(fs.existsSync(okPath)).toBe(true);
    });
});
