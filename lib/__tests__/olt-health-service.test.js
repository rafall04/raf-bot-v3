/**
 * Header Doc
 * Purpose: Unit test parser kesehatan OLT terhadap OUTPUT ASLI OLT VANS C320 V2.1.0 (ditangkap
 *          recon read-only) + deriveUplinkPorts + deriveAlerts. Murni, tanpa SSH.
 * Caller: Jest.
 * Deps: lib/olt-health-service (parser di-export).
 * MainFuncs: -
 * SideEffects: -
 */
'use strict';

const svc = require('../olt-health-service');

// ── Fixtures: output ASLI OLT VANS 172.17.1.2 (read-only recon) ──────────────

const FX_CARD = `Rack Shelf Slot CfgType RealType Port  HardVer SoftVer         Status
-------------------------------------------------------------------------------
1    1     2    GTGH    GTGHG    16    V1.0.0  V2.1.0          INSERVICE
1    1     3    SMXA    SMXA     3     V1.0.0  V2.1.0          INSERVICE
1    1     4    SMXA             3                             OFFLINE`;

const FX_PROCESSOR = `Rack   Shelf    Slot   CPU(5s)   CPU(1m)    CPU(5m)   PhyMem(MB)  Memory
-------------------------------------------------------------------------------
1       1       2       20%       22%       22%       512         39%
1       1       3       8%        12%       8%        2048        26%`;

const FX_FAN = `Shelf                        : 1
FanControlType               : temperature-control
TemperatureThreshold         : 20  36  44  51 (deg c)
CriticalTemperatureThreshold : 160(deg c)
HighTemperatureThreshold     : 65(deg c)
LowTemperatureThreshold      : -20(deg c)
Environment Temperature      : 32(deg c)
EnvPowerMode                 : Mains Supply
Upper Fanboard Status        : online
All fan units actual status:
----------------------------------------------
FanUnitId     SpeedLevel     ActualSpeed(RPM)
----------------------------------------------
1             3              3426
2             3              3396
----------------------------------------------`;

const FX_SYSTEM = `System Description: C320 Version V2.1.0 Software, Copyright (c) by ZTE Corporation Compiled
System ObjectId: .1.3.6.1.4.1.3902.1082.1001.320.2.1
Started before: 10 days, 9 hours, 14 minutes
Contact with: HP/WA +6282363066495
System name:  ZXAN
Location: Jember-(Zidan-Febriyan)
System Info:  256  56c6e108`;

const FX_IPINTF = `Interface     IP-Address      Mask            Admin Phy  Prot Description
vlan10        172.17.1.2      255.255.255.0   up    up   up   none
vlan300       unassigned      unassigned      up    up   up   none`;

const FX_VLAN = `All created vlan num: 8
Details are following:
    1,10,100,300,310,320,330,340`;

const FX_GEI1 = `gei_1/3/1 is up,  line protocol is up,  detect status is OK
  Description is none
  The port is optical
  Duplex full
   20 seconds input rate :           23389178 Bps,            19030 pps
   20 seconds output rate:            1915985 Bps,             9906 pps
  Interface utilization: input     18.71134%,     output     1.53279%
  Input:
   Droppeds      : 6534751              Fragments     : 0
   CRC-ERROR     : 0`;

const FX_GEI_INVALID = `                           ^
%Error 20202: Invalid input detected at '^' marker.Invalid parameter`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parseCard', () => {
    const cards = svc.parseCard(FX_CARD);
    test('3 kartu terbaca', () => expect(cards).toHaveLength(3));
    test('GPON line-card slot 2 INSERVICE', () =>
        expect(cards[0]).toMatchObject({ slot: 2, cfgType: 'GTGH', realType: 'GTGHG', port: 16, ok: true }));
    test('kontrol slot 3 INSERVICE', () =>
        expect(cards[1]).toMatchObject({ slot: 3, cfgType: 'SMXA', realType: 'SMXA', ok: true }));
    test('slot 4 OFFLINE → ok=false (realType kosong)', () =>
        expect(cards[2]).toMatchObject({ slot: 4, cfgType: 'SMXA', realType: '', status: 'OFFLINE', ok: false }));
});

describe('parseProcessor', () => {
    const p = svc.parseProcessor(FX_PROCESSOR);
    test('2 slot', () => expect(p).toHaveLength(2));
    test('slot 2 cpu/mem', () =>
        expect(p[0]).toEqual({ slot: 2, cpu5s: 20, cpu1m: 22, cpu5m: 22, phyMemMb: 512, memPct: 39 }));
    test('slot 3 cpu/mem', () => expect(p[1]).toMatchObject({ slot: 3, cpu5m: 8, memPct: 26 }));
});

describe('parseFan', () => {
    const f = svc.parseFan(FX_FAN);
    test('suhu lingkungan + ambang', () =>
        expect(f).toMatchObject({ envTempC: 32, highTempC: 65, criticalTempC: 160, lowTempC: -20 }));
    test('power mode + fanboard', () =>
        expect(f).toMatchObject({ powerMode: 'Mains Supply', upperFanboard: 'online' }));
    test('2 unit kipas dengan RPM', () => {
        expect(f.fans).toHaveLength(2);
        expect(f.fans[0]).toEqual({ id: 1, speedLevel: 3, rpm: 3426 });
    });
});

describe('parseSystemGroup', () => {
    const s = svc.parseSystemGroup(FX_SYSTEM);
    test('versi, uptime, identitas', () =>
        expect(s).toMatchObject({
            version: 'V2.1.0',
            uptime: '10 days, 9 hours, 14 minutes',
            name: 'ZXAN',
            location: 'Jember-(Zidan-Febriyan)',
            contact: 'HP/WA +6282363066495'
        }));
});

describe('parseIpInterfaceBrief', () => {
    const r = svc.parseIpInterfaceBrief(FX_IPINTF);
    test('2 interface L3', () => expect(r).toHaveLength(2));
    test('vlan10 mgmt', () => expect(r[0]).toMatchObject({ interface: 'vlan10', ip: '172.17.1.2', prot: 'up' }));
});

describe('parseVlanSummary', () => {
    const v = svc.parseVlanSummary(FX_VLAN);
    test('count 8 + list', () => {
        expect(v.count).toBe(8);
        expect(v.list).toEqual(['1', '10', '100', '300', '310', '320', '330', '340']);
    });
});

describe('parsePhysInterface', () => {
    test('uplink optik gei_1/3/1', () => {
        const u = svc.parsePhysInterface(FX_GEI1, 'gei_1/3/1');
        expect(u).toMatchObject({
            name: 'gei_1/3/1',
            up: true,
            protoUp: true,
            media: 'optical',
            duplex: 'full',
            inBps: 23389178,
            inPps: 19030,
            crcError: 0,
            drops: 6534751
        });
        expect(u.utilIn).toBeCloseTo(18.71134, 3);
    });
    test('port invalid → null', () => expect(svc.parsePhysInterface(FX_GEI_INVALID, 'gei_1/3/2')).toBeNull());
});

describe('deriveUplinkPorts', () => {
    test('hanya kartu kontrol INSERVICE, lewati GPON & OFFLINE', () => {
        const ports = svc.deriveUplinkPorts(svc.parseCard(FX_CARD));
        expect(ports).toEqual(['gei_1/3/1', 'gei_1/3/2', 'gei_1/3/3']);
    });
});

describe('deriveAlerts', () => {
    test('kartu OFFLINE → warn', () => {
        const alerts = svc.deriveAlerts({ cards: svc.parseCard(FX_CARD) });
        expect(alerts.some((a) => a.level === 'warn' && /slot 4/.test(a.message))).toBe(true);
    });
    test('suhu normal 32°C → tidak ada alert suhu', () => {
        const alerts = svc.deriveAlerts({ temperature: svc.parseFan(FX_FAN) });
        expect(alerts.some((a) => /Suhu/.test(a.message))).toBe(false);
    });
    test('suhu 70°C ≥ high 65 → critical', () => {
        const alerts = svc.deriveAlerts({ temperature: { envTempC: 70, highTempC: 65, criticalTempC: 160 } });
        expect(alerts.some((a) => a.level === 'critical' && /Suhu/.test(a.message))).toBe(true);
    });
    test('uplink down → critical', () => {
        const alerts = svc.deriveAlerts({ uplinks: [{ name: 'gei_1/3/1', up: false, protoUp: false }] });
        expect(alerts.some((a) => a.level === 'critical' && /Uplink/.test(a.message))).toBe(true);
    });
    test('CPU 90% (5m) → warn', () => {
        const alerts = svc.deriveAlerts({ processors: [{ slot: 2, cpu5m: 90, memPct: 10 }] });
        expect(alerts.some((a) => a.level === 'warn' && /CPU/.test(a.message))).toBe(true);
    });
});
