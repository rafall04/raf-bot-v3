/**
 * Header Doc
 * Purpose: Uji P0 housekeeping — alarm OLT mati SEBAGIAN (per-device). Melengkapi alertOltAllDown yang
 *   hanya menutup blackout TOTAL: bila ADA OLT sukses tapi OLT LAIN unreachable, harus tetap alarm
 *   per-OLT (throttled) + notif pulih. Menutup insiden nyata olt1 mati (~78% pelanggan) olt2 hidup.
 * Caller: Jest.
 * Deps: mock ../admin-recipients, ../whatsapp-critical-delivery.
 * SideEffects: set global.config sementara.
 */
'use strict';

jest.mock('../admin-recipients', () => ({ getAdminJids: jest.fn(async () => ['628admin@s.whatsapp.net']) }));
jest.mock('../whatsapp-critical-delivery', () => ({ sendCritical: jest.fn(async () => ({ delivered: true })) }));

const { __testHooks } = require('../olt-log-scraper');
const { alertOltPartialDown, markDeviceFailure, markDeviceHealthy, resetDeviceStatuses, _resetDeviceAlarms } = __testHooks;
const { sendCritical } = require('../whatsapp-critical-delivery');

const OLT_BESAR = { id: 'olt1', name: 'OLT Utama', host: '192.168.11.2' };
const OLT_KECIL = { id: 'olt2', name: 'OLT Kecil', host: '192.168.0.88' };

function jadikanUnreachable(olt) { for (let i = 0; i < 3; i++) markDeviceFailure(olt, 'timeout'); } // threshold 3

describe('alertOltPartialDown (P0 — OLT mati sebagian)', () => {
    beforeEach(() => {
        sendCritical.mockClear();
        resetDeviceStatuses();
        _resetDeviceAlarms();
        global.config = { oltMonitor: {} };
    });

    test('1 dari 2 OLT unreachable + OLT lain sukses → ALARM per-OLT (kasus yang dulu lolos)', async () => {
        jadikanUnreachable(OLT_BESAR);
        markDeviceHealthy(OLT_KECIL);
        await alertOltPartialDown({ successCount: 1 });
        expect(sendCritical).toHaveBeenCalledTimes(1);
        expect(String(sendCritical.mock.calls[0][1].text)).toMatch(/OLT Utama TAK TERBACA/);
    });

    test('successCount=0 (semua mati) → DILEWATI (ditangani alertOltAllDown, tak dobel)', async () => {
        jadikanUnreachable(OLT_BESAR);
        jadikanUnreachable(OLT_KECIL);
        await alertOltPartialDown({ successCount: 0 });
        expect(sendCritical).not.toHaveBeenCalled();
    });

    test('throttle per-OLT: panggilan kedua dalam jendela → tak kirim lagi', async () => {
        jadikanUnreachable(OLT_BESAR);
        markDeviceHealthy(OLT_KECIL);
        await alertOltPartialDown({ successCount: 1 });
        sendCritical.mockClear();
        await alertOltPartialDown({ successCount: 1 });
        expect(sendCritical).not.toHaveBeenCalled();
    });

    test('PULIH: OLT yang tadi dialarmi kembali healthy → notif pulih', async () => {
        jadikanUnreachable(OLT_BESAR);
        markDeviceHealthy(OLT_KECIL);
        await alertOltPartialDown({ successCount: 1 });
        sendCritical.mockClear();
        markDeviceHealthy(OLT_BESAR);
        await alertOltPartialDown({ successCount: 2 });
        expect(sendCritical).toHaveBeenCalledTimes(1);
        expect(String(sendCritical.mock.calls[0][1].text)).toMatch(/OLT Utama PULIH/);
    });

    test('opt-out config.oltMonitor.alertPartialDown=false → tak kirim', async () => {
        global.config = { oltMonitor: { alertPartialDown: false } };
        jadikanUnreachable(OLT_BESAR);
        await alertOltPartialDown({ successCount: 1 });
        expect(sendCritical).not.toHaveBeenCalled();
    });

    test('semua OLT healthy → tak ada alarm', async () => {
        markDeviceHealthy(OLT_BESAR);
        markDeviceHealthy(OLT_KECIL);
        await alertOltPartialDown({ successCount: 2 });
        expect(sendCritical).not.toHaveBeenCalled();
    });
});
