/**
 * Header Doc
 * Purpose: Mengunci tiga perbaikan #b251 di sisi lib — (1) push PSB yang hanya DIANTREKAN
 *          (HTTP 202, modem tak terjangkau) tidak boleh lagi dilaporkan sukses, (2) modem yang
 *          tak menjawab connection-request tidak boleh menjatuhkan circuit breaker GLOBAL
 *          GenieACS, (3) kunci anti-kerja-dobel harus bertahan lebih lama daripada operasi I/O
 *          terpanjang yang dilindunginya.
 * Caller: Jest test runner.
 * Deps: mock `axios`, `lib/genieacs`, `lib/state-manager`.
 * MainFuncs: —
 * SideEffects: Tidak ada; semua jaringan di-mock.
 */
"use strict";

jest.mock('axios', () => jest.fn());
jest.mock('../database', () => ({ loadJSON: jest.fn(() => []) }));

describe('#b251 — vonis push PSB & breaker GenieACS', () => {
    const originalConfig = global.config;

    const axiosMock = () => require('axios');

    beforeEach(() => {
        jest.resetModules();
        axiosMock().mockReset();
        global.config = {
            genieacsBaseUrl: 'http://genieacs.local:7557',
            genieacsTimeoutMs: 1000,
            genieacsCircuitFailureThreshold: 3,
            genieacsCircuitOpenMs: 30000,
        };
    });

    afterAll(() => {
        global.config = originalConfig;
    });

    // ── (1) 202 = DIANTREKAN, bukan diterapkan ───────────────────────────────────────────────
    // Terukur di produksi 2026-08-20: 4 modem terjangkau → 200 semua; 3 modem mati → 202 semua.
    describe('updatePsbDeviceConfig: 202 tidak boleh dianggap sukses', () => {
        test('HTTP 202 (modem tak menjawab) → ok:false + DEVICE_UNREACHABLE', async () => {
            axiosMock().mockResolvedValue({ status: 202, data: {} });
            const { updatePsbDeviceConfig } = require('../genieacs');

            const hasil = await updatePsbDeviceConfig('DEV-1', {
                wifiSSID: 'UWAIS',
                wifiPassword: 'uwais123',
                ssidIndices: ['1'],
                pppUsername: 'siti@rafcybernet',
                pppPassword: 'rahasia',
            });

            expect(hasil.ok).toBe(false);
            expect(hasil.errorCode).toBe('DEVICE_UNREACHABLE');
            expect(hasil.message).toMatch(/BELUM diterapkan/i);
            expect(hasil.data.queuedOnly).toBe(true);
        });

        test('HTTP 200 (modem menerapkan) → tetap ok:true seperti sebelumnya', async () => {
            axiosMock().mockResolvedValue({ status: 200, data: {} });
            const { updatePsbDeviceConfig } = require('../genieacs');

            const hasil = await updatePsbDeviceConfig('DEV-2', {
                wifiSSID: 'UWAIS',
                wifiPassword: 'uwais123',
                ssidIndices: ['1'],
            });

            expect(hasil.ok).toBe(true);
            expect(hasil.data.deviceId).toBe('DEV-2');
            expect(hasil.data.queuedOnly).toBeUndefined();
        });

        test('pesan gagalnya TIDAK membocorkan kredensial yang dikirim', async () => {
            axiosMock().mockResolvedValue({ status: 202, data: {} });
            const { updatePsbDeviceConfig } = require('../genieacs');

            const hasil = await updatePsbDeviceConfig('DEV-3', {
                wifiSSID: 'UWAIS',
                wifiPassword: 'sandi-super-rahasia',
                ssidIndices: ['1'],
                pppPassword: 'pppoe-rahasia',
            });

            expect(hasil.message).not.toMatch(/sandi-super-rahasia|pppoe-rahasia/);
        });
    });

    // ── (2) modem bisu ≠ ACS rusak ───────────────────────────────────────────────────────────
    // Akar buta-senyap 18 jam di Tanjungharjo: 192 connection-request serentak, tiap timeout
    // ONU dihitung sebagai "GenieACS down" sampai breaker GLOBAL terbuka dan ikut menolak
    // cek-wifi pelanggan, PSB, reboot, serta panel admin.
    describe('breaker: timeout per-modem tidak boleh menjatuhkan breaker global', () => {
        function timeoutError() {
            const e = new Error('timeout of 1000ms exceeded');
            e.code = 'ECONNABORTED';
            return e;
        }

        test('banyak modem timeout beruntun → operasi ACS lain TETAP boleh jalan', async () => {
            const axios = axiosMock();
            axios.mockRejectedValue(timeoutError());
            const { refreshObjects, queryDevices } = require('../genieacs');

            // 6 modem bisu berturut-turut (ambang breaker cuma 3)
            for (let i = 0; i < 6; i += 1) {
                await refreshObjects(`DEV-${i}`, ['VirtualParameters.RXPower']);
            }

            // Operasi lain harus benar-benar MENCOBA ke jaringan, bukan fast-fail CIRCUIT_OPEN.
            axios.mockResolvedValue({ status: 200, data: [] });
            const hasil = await queryDevices({ query: {}, projection: '_id' });

            expect(hasil.errorCode).not.toBe('CIRCUIT_OPEN');
            expect(hasil.ok).toBe(true);
        });

        test('ACS-nya sendiri tak terjangkau (CONNECT_ERROR) → breaker TETAP terbuka', async () => {
            const axios = axiosMock();
            const connErr = new Error('connect ECONNREFUSED');
            connErr.code = 'ECONNREFUSED';
            axios.mockRejectedValue(connErr);
            const { refreshObjects, queryDevices } = require('../genieacs');

            for (let i = 0; i < 6; i += 1) {
                await refreshObjects(`DEV-${i}`, ['VirtualParameters.RXPower']);
            }

            const hasil = await queryDevices({ query: {}, projection: '_id' });
            expect(hasil.errorCode).toBe('CIRCUIT_OPEN');
        });
    });

    // ── (3) kunci harus lebih panjang dari kerja yang dilindunginya ──────────────────────────
    describe('state-manager: kunci tidak boleh lepas di tengah kerja', () => {
        afterEach(() => {
            jest.useRealTimers();
            require('../state-manager').clearAll();
        });

        test('kerja 21 detik (durasi provisioning PSB terukur) → kunci MASIH memegang', () => {
            jest.useFakeTimers();
            const sm = require('../state-manager');
            const sender = '628123@s.whatsapp.net';

            expect(sm.setProcessing(sender)).toBe(true);

            // Detik ke-11: inilah momen pemicu kedua teknisi pada insiden 2026-08-20.
            jest.advanceTimersByTime(11000);
            expect(sm.isProcessing(sender)).toBe(true);
            expect(sm.setProcessing(sender)).toBe(false);

            // Detik ke-21: provisioning baru selesai.
            jest.advanceTimersByTime(10000);
            expect(sm.isProcessing(sender)).toBe(true);
        });

        test('jaring darurat tetap ada: setelah 2 menit kunci dilepas', () => {
            jest.useFakeTimers();
            const sm = require('../state-manager');
            const sender = '628124@s.whatsapp.net';

            sm.setProcessing(sender);
            jest.advanceTimersByTime(sm.LOCK_TIMEOUT + 1);
            expect(sm.isProcessing(sender)).toBe(false);
        });

        test('ambangnya WAJIB lebih besar dari operasi PSB terpanjang yang terukur (±21 dtk)', () => {
            const sm = require('../state-manager');
            expect(sm.LOCK_TIMEOUT).toBeGreaterThan(21000);
        });
    });
});
