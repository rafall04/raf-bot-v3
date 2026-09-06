/**
 * Header Doc
 * Purpose: Uji #b324 — alarm PUSH saat SEMUA OLT tak terbaca (throttled) + notif PULIH, supaya OLT
 *   mati total tak lagi "tak seorang pun tahu sampai buka halaman". Opt-out via config.
 * Caller: Jest.
 * Deps: mock ../admin-recipients, ../whatsapp-critical-delivery.
 * SideEffects: set global.config sementara.
 */
'use strict';

jest.mock('../admin-recipients', () => ({ getAdminJids: jest.fn(async () => ['628admin@s.whatsapp.net']) }));
jest.mock('../whatsapp-critical-delivery', () => ({ sendCritical: jest.fn(async () => ({ delivered: true })) }));

const { __testHooks } = require('../olt-log-scraper');
const { alertOltAllDown, _resetOltAllDownState } = __testHooks;
const { sendCritical } = require('../whatsapp-critical-delivery');

const DOWN = { successCount: 0, unreachableCount: 2, degradedCount: 0, oltDevices: [{}, {}] };

describe('alertOltAllDown (#b324)', () => {
    beforeEach(() => { sendCritical.mockClear(); _resetOltAllDownState(); global.config = { oltMonitor: {} }; });

    test('SEMUA OLT unreachable → alarm dikirim ke admin', async () => {
        await alertOltAllDown(DOWN);
        expect(sendCritical).toHaveBeenCalled();
        expect(String(sendCritical.mock.calls[0][1].text)).toMatch(/SEMUA OLT TAK TERBACA/);
    });

    test('throttle: panggilan kedua dalam jendela → tak kirim lagi', async () => {
        await alertOltAllDown(DOWN);
        sendCritical.mockClear();
        await alertOltAllDown(DOWN);
        expect(sendCritical).not.toHaveBeenCalled();
    });

    test('PULIH: setelah all-down lalu ada OLT sukses → notif pulih', async () => {
        await alertOltAllDown(DOWN);
        sendCritical.mockClear();
        await alertOltAllDown({ successCount: 1, unreachableCount: 1, degradedCount: 0, oltDevices: [{}, {}] });
        expect(sendCritical).toHaveBeenCalled();
        expect(String(sendCritical.mock.calls[0][1].text)).toMatch(/PULIH/);
    });

    test('opt-out config.oltMonitor.alertAllDown=false → tak kirim', async () => {
        global.config = { oltMonitor: { alertAllDown: false } };
        await alertOltAllDown(DOWN);
        expect(sendCritical).not.toHaveBeenCalled();
    });

    test('ada OLT sukses tanpa riwayat all-down → tak alarm', async () => {
        await alertOltAllDown({ successCount: 2, unreachableCount: 0, degradedCount: 0, oltDevices: [{}, {}] });
        expect(sendCritical).not.toHaveBeenCalled();
    });
});
