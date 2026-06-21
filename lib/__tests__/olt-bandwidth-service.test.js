/**
 * Header Doc
 * Purpose: Unit test parser bandwidth per-PON (olt-bandwidth-service.parseGponOltInterface)
 *          terhadap OUTPUT ASLI `show interface gpon-olt_1/2/1` VANS C320 V2.1.0.
 * Caller: Jest.
 * Deps: lib/olt-bandwidth-service.
 * MainFuncs: -
 * SideEffects: -
 */
'use strict';

const bw = require('../olt-bandwidth-service');

// Output ASLI recon read-only VANS
const FX_PON = `gpon-olt_1/2/1 is activate,line protocol is up.
  Description is none.
  The port is activate.
  The port link up/down notification is trap disable.
  The port has 128 onus, the number of registered onus is 15.

Current channel num : 1

OLT statistic:
   Input rate :             162656 Bps              320 pps
   Output rate:             528613 Bps              493 pps
   Input Instantaneous bandwidth throughput : 0.1%
   Output Instantaneous bandwidth throughput: 0.2%
   Input Average bandwidth throughput : 0.1%
   Output Average bandwidth throughput: 0.6%
Interface peak rate:
   Input peak rate :           12507538 Bps            10541 pps
   Output peak rate:           13265967 Bps             9960 pps`;

const FX_ERR = `                        ^
%Error 20202: Invalid input detected at '^' marker.Invalid parameter`;

describe('parseGponOltInterface', () => {
    const r = bw.parseGponOltInterface(FX_PON, 'gpon-olt_1/2/1');
    test('identitas + jumlah ONU', () =>
        expect(r).toMatchObject({ name: 'gpon-olt_1/2/1', kind: 'pon', onuCapacity: 128, onuRegistered: 15 }));
    test('rate input/output', () =>
        expect(r).toMatchObject({ inBps: 162656, inPps: 320, outBps: 528613, outPps: 493 }));
    test('utilisasi instan', () => {
        expect(r.utilIn).toBeCloseTo(0.1, 5);
        expect(r.utilOut).toBeCloseTo(0.2, 5);
    });
    test('output error → null', () => expect(bw.parseGponOltInterface(FX_ERR, 'gpon-olt_1/2/2')).toBeNull());
    test('teks kosong → null', () => expect(bw.parseGponOltInterface('', 'x')).toBeNull());
});
