/**
 * Test cctv-netwatch-sync — sinkron AMAN registry CCTV → netwatch MikroTik. Mengunci temuan
 * blocker review adversarial (#b314): sasar by-id/klasifikasi, JANGAN clobber entri infra/OLT
 * sehost, preserve-on-empty, urutan aman ganti-IP. Mock mikrotik; buildNetwatchScripts asli.
 */
jest.mock('../mikrotik', () => ({
    getNetwatchFull: jest.fn(),
    setNetwatch: jest.fn(async () => ({ ok: true, data: { mode: 'add', id: '*NEW' } })),
    removeNetwatch: jest.fn(async () => ({ ok: true, data: { removed: 1 } })),
}));
const mikrotik = require('../mikrotik');
const netscript = require('../cctv-netwatch-script');
const sync = require('../cctv-netwatch-sync');

const CFG = { botToken: 'BOTTOKEN', chatId: '-100', interval: '5s', timeout: '1s' };

function cctvEntry(id, host, device, cfg = CFG) {
    const s = netscript.buildNetwatchScripts(cfg, { name: device.name, area: device.area, host });
    return { id, host, comment: device.name, up_script: s.upScript, down_script: s.downScript, disabled: 'false', status: 'up' };
}
function infraEntry(id, host, comment = 'OLT HIOSO') {
    return { id, host, comment, up_script: ':local dev "OLT";', down_script: ':local dev "OLT";', disabled: 'false', status: 'up' };
}

beforeEach(() => {
    jest.clearAllMocks();
    global.config = { cctvMonitor: { netwatch: { ...CFG } } };
    mikrotik.setNetwatch.mockResolvedValue({ ok: true, data: { mode: 'add', id: '*NEW' } });
    mikrotik.removeNetwatch.mockResolvedValue({ ok: true, data: { removed: 1 } });
});

const DEV = { id: 'c1', name: 'CCTV A', host: '192.168.1.10', area: 'DANDER', enabled: true };

describe('syncDevice', () => {
    test('host belum ada → ADD entri baru + script', async () => {
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [] });
        mikrotik.setNetwatch.mockResolvedValue({ ok: true, data: { mode: 'add', id: '*5' } });
        const r = await sync.syncDevice(DEV);
        expect(r.ok).toBe(true);
        expect(r.mode).toBe('add');
        expect(r.netwatchId).toBe('*5');
        const call = mikrotik.setNetwatch.mock.calls[0][0];
        expect(call.id).toBeFalsy();
        expect(call.host).toBe('192.168.1.10');
        expect(call.upScript).toContain(':local cctv');
    });

    test('adopt entri CCTV yang sudah benar (script identik) → SET tanpa menulis script (preserve)', async () => {
        const existing = cctvEntry('*3', '192.168.1.10', DEV);
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [existing] });
        const r = await sync.syncDevice(DEV);
        expect(r.ok).toBe(true);
        expect(r.mode).toBe('set');
        expect(r.netwatchId).toBe('*3');
        const call = mikrotik.setNetwatch.mock.calls[0][0];
        expect(call.id).toBe('*3');
        expect(call.upScript).toBeUndefined(); // identik → tak ditimpa
        expect(call.downScript).toBeUndefined();
    });

    test('entri buatan tangan MULTI-BARIS, isi sama → SET tanpa menulis ulang (abaikan beda newline)', async () => {
        const s = netscript.buildNetwatchScripts(CFG, { name: DEV.name, area: DEV.area, host: DEV.host });
        const multiline = { id: '*3', host: '192.168.1.10', comment: DEV.name, up_script: s.upScript.replace(/;/g, ';\n'), down_script: s.downScript.replace(/;/g, ';\n'), disabled: 'false', status: 'up' };
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [multiline] });
        const r = await sync.syncDevice(DEV);
        expect(r.ok).toBe(true);
        expect(r.mode).toBe('set');
        const call = mikrotik.setNetwatch.mock.calls[0][0];
        expect(call.upScript).toBeUndefined(); // isi identik walau multi-baris → preserve
        expect(call.downScript).toBeUndefined();
    });

    test('rename → script beda → SET dengan script baru', async () => {
        const existing = cctvEntry('*3', '192.168.1.10', { ...DEV, name: 'CCTV LAMA' });
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [existing] });
        await sync.syncDevice({ ...DEV, name: 'CCTV BARU' });
        const call = mikrotik.setNetwatch.mock.calls[0][0];
        expect(call.upScript).toContain('CCTV BARU');
    });

    test('IP dipakai entri NON-CCTV (OLT/infra) → TOLAK, tak menyentuh router', async () => {
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [infraEntry('*9', '192.168.1.10')] });
        const r = await sync.syncDevice(DEV);
        expect(r.ok).toBe(false);
        expect(r.mode).toBe('conflict');
        expect(mikrotik.setNetwatch).not.toHaveBeenCalled();
        expect(mikrotik.removeNetwatch).not.toHaveBeenCalled();
    });

    test('config Telegram kosong + entri sudah ada → SET tak mengosongkan script', async () => {
        const existing = cctvEntry('*3', '192.168.1.10', DEV, CFG); // script dibuat saat cfg valid
        global.config.cctvMonitor.netwatch = {}; // token kosong sekarang
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [existing] });
        const r = await sync.syncDevice(DEV);
        expect(r.ok).toBe(true);
        const call = mikrotik.setNetwatch.mock.calls[0][0];
        expect(call.upScript).toBeUndefined(); // scripts kosong → tak ditulis (preserve)
        expect(call.downScript).toBeUndefined();
    });

    test('ganti IP → ADD di host BARU dulu, lalu HAPUS entri CCTV host lama', async () => {
        const oldEntry = cctvEntry('*3', '192.168.1.10', DEV);
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [oldEntry] });
        mikrotik.setNetwatch.mockResolvedValue({ ok: true, data: { mode: 'add', id: '*7' } });
        const r = await sync.syncDevice({ ...DEV, host: '192.168.1.20' }, { oldHost: '192.168.1.10', oldNetwatchId: '*3' });
        expect(r.ok).toBe(true);
        expect(mikrotik.setNetwatch.mock.calls[0][0].host).toBe('192.168.1.20');
        expect(mikrotik.removeNetwatch).toHaveBeenCalled();
        expect(mikrotik.removeNetwatch.mock.calls[0][0].ids).toContain('*3');
    });

    test('netwatch tak terbaca → {ok:false} (never-throw), tak menulis', async () => {
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: false, message: 'router down' });
        const r = await sync.syncDevice(DEV);
        expect(r.ok).toBe(false);
        expect(mikrotik.setNetwatch).not.toHaveBeenCalled();
    });
});

describe('removeForDevice', () => {
    test('hanya entri CCTV dihapus; entri infra sehost DIBIARKAN', async () => {
        const cctv = cctvEntry('*3', '192.168.1.10', DEV);
        const infra = infraEntry('*9', '192.168.1.10', 'OLT HOME');
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [cctv, infra] });
        const r = await sync.removeForDevice(DEV);
        expect(r.ok).toBe(true);
        expect(mikrotik.removeNetwatch.mock.calls[0][0].ids).toEqual(['*3']);
        expect(r.skippedNonCctv).toContain('OLT HOME');
    });

    test('tak ada entri CCTV (cuma infra) → removed 0, removeNetwatch TAK dipanggil', async () => {
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [infraEntry('*9', '192.168.1.10')] });
        const r = await sync.removeForDevice({ id: 'c1', name: 'X', host: '192.168.1.10' });
        expect(r.removed).toBe(0);
        expect(mikrotik.removeNetwatch).not.toHaveBeenCalled();
    });

    test('router gagal hapus → {ok:false} (caller pertahankan device)', async () => {
        const cctv = cctvEntry('*3', '192.168.1.10', DEV);
        mikrotik.getNetwatchFull.mockResolvedValue({ ok: true, data: [cctv] });
        mikrotik.removeNetwatch.mockResolvedValue({ ok: false, message: 'timeout' });
        const r = await sync.removeForDevice(DEV);
        expect(r.ok).toBe(false);
    });
});
