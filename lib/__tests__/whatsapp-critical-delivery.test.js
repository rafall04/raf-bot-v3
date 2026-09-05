jest.mock('fs', () => {
    const real = jest.requireActual('fs');
    const store = { data: null };
    // Spread real fs supaya fungsi lain (dipakai modul lain) tidak rusak kalau
    // isolasi mock bocor antar test file. Hanya 3 fungsi yang di-override + diarahkan
    // ke in-memory store untuk dead-letter file.
    return {
        ...real,
        __store: store,
        existsSync: jest.fn(() => store.data !== null),
        readFileSync: jest.fn(() => store.data),
        writeFileSync: jest.fn((_p, content) => { store.data = content; }),
    };
});

jest.mock('../whatsapp-gateway', () => ({
    isReady: jest.fn(),
    sendPayload: jest.fn(),
}));

const fs = require('fs');
const gateway = require('../whatsapp-gateway');
const critical = require('../whatsapp-critical-delivery');

describe('lib/whatsapp-critical-delivery', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.__store.data = null; // empty dead-letter file
        gateway.isReady.mockReturnValue(true);
    });

    const FAST = { baseDelayMs: 1, pollIntervalMs: 1, waitForReadyMs: 50 };

    test('delivers on first attempt when WA ready', async () => {
        gateway.sendPayload.mockResolvedValueOnce({ ok: true });
        const r = await critical.sendCritical('62812@s.whatsapp.net', { text: 'hi' }, { ...FAST, label: 'test' });
        expect(r.delivered).toBe(true);
        expect(r.attempts).toBe(1);
        expect(gateway.sendPayload).toHaveBeenCalledTimes(1);
        expect(fs.writeFileSync).not.toHaveBeenCalled(); // no dead-letter
    });

    test('retries transient failure then succeeds', async () => {
        gateway.sendPayload
            .mockRejectedValueOnce(new Error('timeout'))
            .mockRejectedValueOnce(new Error('timeout'))
            .mockResolvedValueOnce({ ok: true });
        const r = await critical.sendCritical('62812', { text: 'hi' }, { ...FAST, maxAttempts: 4, label: 'voucher_code' });
        expect(r.delivered).toBe(true);
        expect(r.attempts).toBe(3);
        expect(gateway.sendPayload).toHaveBeenCalledTimes(3);
    });

    test('exhausts retries → dead-letter persisted with full message', async () => {
        gateway.sendPayload.mockRejectedValue(new Error('boom'));
        const r = await critical.sendCritical('62812', { text: 'KODE-VC-123' }, { ...FAST, maxAttempts: 3, label: 'voucher_code' });
        expect(r.delivered).toBe(false);
        expect(r.attempts).toBe(3);
        expect(gateway.sendPayload).toHaveBeenCalledTimes(3);
        // Dead-letter written with the full message (recovery).
        const dl = JSON.parse(fs.__store.data);
        expect(dl).toHaveLength(1);
        expect(dl[0].label).toBe('voucher_code');
        expect(dl[0].message.text).toBe('KODE-VC-123');
        expect(dl[0].retried).toBe(false);
    });

    test('waits for WA ready, gives up → dead-letter (not connected)', async () => {
        gateway.isReady.mockReturnValue(false); // never ready
        const r = await critical.sendCritical('62812', { text: 'hi' }, { ...FAST, label: 'transfer_masuk' });
        expect(r.delivered).toBe(false);
        expect(r.errorCode).toBe('WHATSAPP_NOT_CONNECTED');
        expect(gateway.sendPayload).not.toHaveBeenCalled();
        const dl = JSON.parse(fs.__store.data);
        expect(dl[0].errorCode).toBe('WHATSAPP_NOT_CONNECTED');
    });

    test('recovers when WA becomes ready during wait', async () => {
        let calls = 0;
        gateway.isReady.mockImplementation(() => { calls += 1; return calls > 2; }); // ready on 3rd poll
        gateway.sendPayload.mockResolvedValueOnce({ ok: true });
        const r = await critical.sendCritical('62812', { text: 'hi' }, { ...FAST, label: 'test' });
        expect(r.delivered).toBe(true);
    });

    test('invalid recipient → dead-letter INVALID_RECIPIENT, no send', async () => {
        const r = await critical.sendCritical('', { text: 'hi' }, { ...FAST });
        expect(r.delivered).toBe(false);
        expect(r.errorCode).toBe('INVALID_RECIPIENT');
        expect(gateway.sendPayload).not.toHaveBeenCalled();
    });

    test('ensureJid normalizes phone to JID (0→62 untuk nomor Indonesia)', () => {
        expect(critical._ensureJid('62812')).toBe('62812@s.whatsapp.net');
        expect(critical._ensureJid('62812@s.whatsapp.net')).toBe('62812@s.whatsapp.net');
        expect(critical._ensureJid('0812-3456')).toBe('628123456@s.whatsapp.net'); // 0→62
        expect(critical._ensureJid('8123')).toBe('628123@s.whatsapp.net');          // tanpa prefix → 62
        expect(critical._ensureJid('abc')).toBe('');                                 // tanpa digit → invalid
        expect(critical._ensureJid('')).toBe('');
    });

    test('payload string dinormalisasi jadi { text } di boundary (kontrak sendPayload)', async () => {
        gateway.sendPayload.mockResolvedValueOnce({ ok: true });
        const r = await critical.sendCritical('62812', 'pesan polos', { ...FAST, label: 'test' });
        expect(r.delivered).toBe(true);
        expect(gateway.sendPayload).toHaveBeenCalledWith(
            '62812@s.whatsapp.net',
            { text: 'pesan polos' },
            expect.any(Object)
        );
    });

    test('retry entri dead-letter LAMA bermessage string → dikirim sebagai { text } (anti-racun)', async () => {
        // Seed entri legacy pra-fix 07-07: message tersimpan string polos.
        fs.__store.data = JSON.stringify([{
            id: 'dl_legacy', timestamp: '2026-07-07T06:40:00.000Z',
            recipient: '62812@s.whatsapp.net', label: 'upq-alert',
            message: '🚨 JALUR UPSTREAM GANGGUAN', errorCode: 'SEND_FAILED',
            attempts: 4, retried: false, retried_at: null,
        }]);
        gateway.sendPayload.mockResolvedValue({ ok: true });
        const res = await critical.retryFailedDeliveries();
        expect(res.delivered).toBe(1);
        // #b318: retry kini bawa skipDuplicateCheck:true (teks identik dgn kiriman semula tak boleh
        // dikenali duplikat → sukses-palsu). Normalisasi string→{text} tetap berlaku (anti-racun).
        expect(gateway.sendPayload).toHaveBeenCalledWith(
            '62812@s.whatsapp.net',
            { text: '🚨 JALUR UPSTREAM GANGGUAN' },
            { skipDuplicateCheck: true }
        );
    });

    test('listFailedDeliveries + retryFailedDeliveries', async () => {
        // Seed one failed entry.
        gateway.sendPayload.mockRejectedValue(new Error('down'));
        await critical.sendCritical('62812', { text: 'recover-me' }, { ...FAST, maxAttempts: 1, label: 'voucher_code' });
        expect(critical.listFailedDeliveries({ unretriedOnly: true })).toHaveLength(1);

        // Now WA recovered, retry succeeds.
        gateway.sendPayload.mockReset();
        gateway.sendPayload.mockResolvedValue({ ok: true });
        gateway.isReady.mockReturnValue(true);
        const res = await critical.retryFailedDeliveries();
        expect(res.attempted).toBe(1);
        expect(res.delivered).toBe(1);
        expect(critical.listFailedDeliveries({ unretriedOnly: true })).toHaveLength(0);
    });
});
