/**
 * Test poller SNMP LOS (capability-driven, mis. ZTE GPON).
 * Fokus: semantik transisi (seed → LOS → recovery), gating, resolusi pelanggan by PPPoE.
 */
const { createSnmpLosPoller } = require('../olt-snmp-los-poller');

function makeDriver(getOnus, losViaSnmp = true) {
    return {
        brand: 'zte',
        capabilities: { losViaSnmp },
        getOltData: async () => ({ status: 'success', onus: getOnus() }),
    };
}

function setup({ losViaSnmp = true, enabled = true, users = [] } = {}) {
    let onus = [];
    const events = [];
    const driver = makeDriver(() => onus, losViaSnmp);
    const poller = createSnmpLosPoller({
        getDevices: () => [{ id: 'z1', name: 'ZTE', brand: 'zte', host: '10.0.0.1' }],
        resolveDriver: () => driver,
        getUsers: () => users,
        handleOltEvent: (ev) => events.push(ev),
        getConfig: () => ({ enabled }),
        now: () => 1700000000000,
        logger: { log() {}, warn() {}, error() {} },
    });
    return {
        poller,
        events,
        setOnus: (v) => { onus = v; },
    };
}

const onu = (over = {}) => ({
    id: '1', slotId: '268566784', ponName: 'ONU-1:1',
    serial: 'ZTEGD5D42874', description: 'caper@suwito',
    status: 'Online', ...over,
});

describe('snmp-los-poller: semantik transisi', () => {
    test('cycle pertama hanya seed — tidak broadcast walau ada LOS', async () => {
        const t = setup();
        t.setOnus([onu({ status: 'LOS' })]);
        await t.poller._pollOnceForTest();
        expect(t.events).toHaveLength(0);
        expect(t.poller._state().seeded).toBe(true);
    });

    test('transisi Online → LOS memicu event los + customer ter-resolve by PPPoE', async () => {
        const user = { id: 7, name: 'Budi', pppoe_username: 'caper@suwito', phone_number: '628111' };
        const t = setup({ users: [user] });
        t.setOnus([onu({ status: 'Online' })]);
        await t.poller._pollOnceForTest(); // seed
        t.setOnus([onu({ status: 'LOS' })]);
        await t.poller._pollOnceForTest(); // transisi

        expect(t.events).toHaveLength(1);
        const ev = t.events[0];
        expect(ev.event_type).toBe('los');
        expect(ev.mac).toBe('z1::268566784.1'); // key dedup = posisi unik (oltId::pon.onu)
        expect(ev.serial).toBe('ZTEGD5D42874');  // serial info tampilan
        expect(ev.slot).toBe('ONU-1:1');         // ponName human
        expect(ev.onu).toBe('1');
        expect(ev.olt_id).toBe('z1');
        expect(ev.customer).toBe(user);          // pre-resolved
        expect(ev.classification_confidence).toBe(1);
    });

    test('pemulihan LOS → Online memicu event discovery', async () => {
        const t = setup();
        t.setOnus([onu({ status: 'Online' })]);
        await t.poller._pollOnceForTest(); // seed online
        t.setOnus([onu({ status: 'LOS' })]);
        await t.poller._pollOnceForTest(); // los
        t.setOnus([onu({ status: 'Online' })]);
        await t.poller._pollOnceForTest(); // recovery

        const types = t.events.map((e) => e.event_type);
        expect(types).toEqual(['los', 'discovery']);
    });

    test('Dying Gasp & Offline-generik TIDAK memicu broadcast', async () => {
        const t = setup();
        t.setOnus([onu({ status: 'Online' })]);
        await t.poller._pollOnceForTest(); // seed
        t.setOnus([onu({ status: 'Dying Gasp' })]);
        await t.poller._pollOnceForTest();
        t.setOnus([onu({ status: 'Offline' })]);
        await t.poller._pollOnceForTest();
        expect(t.events).toHaveLength(0);
    });

    test('LOS tidak diulang tiap cycle (state diingat)', async () => {
        const t = setup();
        t.setOnus([onu({ status: 'Online' })]);
        await t.poller._pollOnceForTest();
        t.setOnus([onu({ status: 'LOS' })]);
        await t.poller._pollOnceForTest(); // 1 los
        await t.poller._pollOnceForTest(); // masih LOS → tidak emit lagi
        expect(t.events.filter((e) => e.event_type === 'los')).toHaveLength(1);
    });
});

describe('snmp-los-poller: gating', () => {
    test('config disabled → tidak poll / tidak emit', async () => {
        const t = setup({ enabled: false });
        t.setOnus([onu({ status: 'Online' })]);
        await t.poller._pollOnceForTest();
        await t.poller._pollOnceForTest();
        expect(t.events).toHaveLength(0);
        expect(t.poller._state().lastStatus.size).toBe(0); // tidak menyentuh state
    });

    test('driver tanpa losViaSnmp (mis. HIOSO) → device dilewati', async () => {
        const t = setup({ losViaSnmp: false });
        t.setOnus([onu({ status: 'LOS' })]);
        await t.poller._pollOnceForTest();
        await t.poller._pollOnceForTest();
        expect(t.events).toHaveLength(0);
        expect(t.poller._state().lastStatus.size).toBe(0);
    });

    test('resolusi pelanggan fallback ke serial bila deskripsi tak cocok', async () => {
        const user = { id: 9, name: 'Sari', pppoe_username: 'lain', olt_serial: 'ZTEGD5D42874', phone_number: '628222' };
        const t = setup({ users: [user] });
        t.setOnus([onu({ status: 'Online', description: 'tidak-terdaftar@x' })]);
        await t.poller._pollOnceForTest();
        t.setOnus([onu({ status: 'LOS', description: 'tidak-terdaftar@x' })]);
        await t.poller._pollOnceForTest();
        expect(t.events).toHaveLength(1);
        expect(t.events[0].customer).toBe(user); // ketemu via serial
    });
});
