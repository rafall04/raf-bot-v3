/**
 * Test cron grace-reminder (masa tenggang):
 * - Kirim hanya ke user unpaid, non-whitelist, non-infrastruktur
 * - Default ON bila status_masa_tenggang absen; OFF bila eksplisit false
 * - Render template masa_tenggang_reminder dgn jatuh_tempo + tanggal_isolir
 */
"use strict";

jest.mock('node-cron', () => ({
    schedule: jest.fn(() => ({ stop: jest.fn() }))
}));
jest.mock('../shared', () => ({
    isValidCron: jest.fn(() => true),
    loadCronConfig: jest.fn(() => ({})),
    delay: jest.fn(() => Promise.resolve()),
    safeSendMessage: jest.fn(() => Promise.resolve({ success: true }))
}));
jest.mock('../../templating', () => ({
    renderTemplate: jest.fn((key, data) => `[${key}] ${data.nama_pelanggan} tempo=${data.jatuh_tempo} isolir=${data.tanggal_isolir}`)
}));
jest.mock('../../myfunc', () => ({
    getProfileBySubscription: jest.fn((sub) => `profile-${sub}`)
}));
jest.mock('../../bill-pay-token', () => ({
    buildBillPayUrl: jest.fn(() => 'https://bayar/abc')
}));
jest.mock('../../whatsapp-gateway', () => ({
    isReady: jest.fn(() => true),
    getConnectionState: jest.fn(() => 'open')
}));
jest.mock('../../account-classification', () => ({
    isInfrastructure: jest.fn((u) => String(u.account_type || '').toLowerCase() === 'infrastruktur'),
    // Whitelist kini dikunci pada NAMA PAKET (lihat #b241). Mock WAJIB memuat fungsi ini —
    // tanpanya siklus melempar dan cron MENELAN galatnya, mengirim NOL pesan tanpa berisik.
    getWhitelistedPackageNames: jest.fn(() => new Set(
        (global.packages || []).filter((p) => p && p.whitelist === true).map((p) => p.name)
    )),
    // Kohort siklus akhir-bulan dikecualikan dari grace-reminder standar (#b303). Mock WAJIB
    // memuat fungsi ini — tanpanya siklus melempar & cron menelan galatnya (kirim NOL, senyap).
    isEndOfMonthBillingActive: jest.fn(() => false),
    // #b305: grace-reminder memakai ini utk tanggal isolir per-paket di pesan. Mock default: tak aktif.
    isPerPackageIsolirActive: jest.fn(() => false),
    getPackageIsolirDay: jest.fn(() => null)
}));

const cron = require('node-cron');
const { safeSendMessage } = require('../shared');
const { renderTemplate } = require('../../templating');
const { initGraceReminderTask, resolveScheduleConfig } = require('../jobs/grace-reminder');

function getScheduledCallback() {
    return cron.schedule.mock.calls[cron.schedule.mock.calls.length - 1][1];
}

describe('cron grace-reminder (masa tenggang)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.config = { tanggal_batas_bayar: '10', tanggal_isolir: '16', whatsapp_message_delay: 0 };
        global.packages = [
            { name: 'VIP', profile: 'profile-VIP', whitelist: true, price: 200000 },
            { name: 'REG', profile: 'profile-REG', whitelist: false, price: 150000 }
        ];
        global.users = [];
    });

    test('kirim hanya ke unpaid non-whitelist non-infra', async () => {
        global.users = [
            { id: 1, name: 'A', subscription: 'REG', paid: false, phone_number: '628111111111' }, // kirim
            { id: 2, name: 'B', subscription: 'REG', paid: true, phone_number: '628222222222' },  // sudah bayar → skip
            { id: 3, name: 'C', subscription: 'VIP', paid: false, phone_number: '628333333333' }, // whitelist → skip
            { id: 4, name: 'D', subscription: 'REG', paid: false, phone_number: '628444444444', account_type: 'infrastruktur' } // infra → skip
        ];
        initGraceReminderTask({ status_masa_tenggang: true, schedule_masa_tenggang: '0 8 11 * *' });
        await getScheduledCallback()();

        expect(safeSendMessage).toHaveBeenCalledTimes(1);
        expect(safeSendMessage.mock.calls[0][0]).toBe('628111111111@s.whatsapp.net');
        // Template terender dgn jatuh tempo (10) + isolir (16)
        expect(renderTemplate).toHaveBeenCalledWith('masa_tenggang_reminder', expect.objectContaining({
            nama_pelanggan: 'A'
        }));
        const data = renderTemplate.mock.calls[0][1];
        expect(data.jatuh_tempo).toMatch(/10/);
        expect(data.tanggal_isolir).toMatch(/16/);
    });

    test('default ON saat status_masa_tenggang absen; OFF saat eksplisit false', () => {
        expect(resolveScheduleConfig({}).enabled).toBe(true);
        expect(resolveScheduleConfig({ status_masa_tenggang: false }).enabled).toBe(false);
        expect(resolveScheduleConfig(undefined).schedule).toBe('0 8 11 * *');
        expect(resolveScheduleConfig({ schedule_masa_tenggang: '0 9 12 * *' }).schedule).toBe('0 9 12 * *');
    });

    test('disabled → task tidak dijadwalkan', () => {
        initGraceReminderTask({ status_masa_tenggang: false });
        expect(cron.schedule).not.toHaveBeenCalled();
    });
});
