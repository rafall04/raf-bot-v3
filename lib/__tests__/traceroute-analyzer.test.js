/**
 * Header Doc
 * Purpose: Mengunci pembacaan traceroute (#b256) — ronde tertumpuk dipisah, snapshot TERAKHIR
 *          dipakai (bukan rata-rata), hop diam tak pernah dituduh, dan loss yang PULIH sebelum
 *          tujuan dibaca sebagai pembatasan ICMP, bukan kehilangan paket.
 * Caller: Jest test runner.
 * Deps: `lib/traceroute-analyzer`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * Bentuk data di sini disalin dari keluaran NYATA `/tool/traceroute` produksi, bukan dikarang.
 */
"use strict";

const { pisahkanRonde, gabungkanRonde, cariHopBermasalah, analisaTrace } = require("../traceroute-analyzer");

const h = (address, loss_pct, avg_ms) => ({ address, loss_pct, avg_ms, status: "" });
const KOSONG = h("", 0, 0);        // placeholder: belum diukur
const DIAM = h("", 100, null);     // diprobe, tak menjawab (ICMP dibatasi)

describe("#b256 — memisahkan ronde yang tertumpuk", () => {
    test("alamat awal yang muncul lagi menandai ronde baru", () => {
        const hops = [h("10.0.0.1", 0, 5), h("10.0.0.2", 0, 9), h("10.0.0.1", 0, 5), h("10.0.0.2", 0, 9)];
        expect(pisahkanRonde(hops).length).toBe(2);
    });

    test("tanpa alamat berulang tetap satu ronde", () => {
        const hops = [h("10.0.0.1", 0, 5), h("10.0.0.2", 0, 9), h("8.8.4.4", 0, 15)];
        expect(pisahkanRonde(hops).length).toBe(1);
    });

    test("panjang ronde TIDAK harus sama (hop diam kadang tak terpancar)", () => {
        const hops = [h("A", 0, 1), h("B", 0, 2), KOSONG, h("A", 0, 1), h("B", 0, 2)];
        const r = pisahkanRonde(hops);
        expect(r.map((x) => x.length)).toEqual([3, 2]);
    });

    test("larik kosong / bukan larik tidak melempar", () => {
        expect(pisahkanRonde([])).toEqual([]);
        expect(pisahkanRonde(null)).toEqual([]);
    });
});

describe("#b256 — snapshot terakhir, bukan rata-rata", () => {
    test("placeholder (alamat kosong, loss 0, avg 0) tidak mengencerkan loss nyata", () => {
        // Ronde 1 belum mengukur; ronde 2 & 3 mengukur 100% loss. Rata-rata akan bilang 67%.
        const r = [[KOSONG], [DIAM], [DIAM]];
        expect(gabungkanRonde(r)[0].lossPct).toBe(100);
    });

    test("nilai diambil dari snapshot TERAKHIR yang berisi data", () => {
        const r = [[h("A", 0, 10)], [h("A", 40, 10)]];
        const g = gabungkanRonde(r)[0];
        expect(g.lossPct).toBe(40);
        expect(g.address).toBe("A");
    });

    test("alamat tetap dikenali walau snapshot awal masih kosong", () => {
        const r = [[KOSONG], [h("10.11.9.161", 0, 52.9)]];
        expect(gabungkanRonde(r)[0].address).toBe("10.11.9.161");
    });
});

describe("#b256 — siapa yang boleh dituduh", () => {
    const jalur = (arr) => gabungkanRonde([arr]);

    test("!! tujuan tercapai utuh → jalur SEHAT walau ada hop diam 100% di tengah", () => {
        // Kasus NYATA jalur gmdp: hop 2 loss 100% tanpa alamat, tapi 8.8.4.4 menjawab 0%.
        const r = cariHopBermasalah(jalur([h("10.0.0.1", 0, 5), DIAM, DIAM, h("8.8.4.4", 0, 15)]));
        expect(r.hop).toBeNull();
        expect(r.sebab).toMatch(/SEHAT/);
    });

    test("hop DIAM tak pernah dituduh — ia tak bisa dinamai", () => {
        const r = cariHopBermasalah(jalur([h("A", 0, 5), DIAM, h("B", 60, 20), h("C", 60, 25)]));
        expect(r.hop && r.hop.address).toBe("B");
    });

    test("loss yang PULIH sebelum tujuan = pembatasan ICMP, bukan paket hilang", () => {
        // Router menolak menjawab dirinya sendiri tapi meneruskan paket dengan baik.
        const r = cariHopBermasalah(jalur([h("A", 0, 5), h("B", 80, 9), h("C", 0, 12), h("D", 0, 15)]));
        expect(r.hop).toBeNull();
        expect(r.sebab).toMatch(/SEHAT|PULIH/);
    });

    test("loss yang BERTAHAN sampai tujuan → hop pertama itulah yang dituduh", () => {
        const r = cariHopBermasalah(jalur([h("A", 0, 5), h("B", 40, 9), h("C", 45, 12), h("D", 42, 15)]));
        expect(r.hop && r.hop.address).toBe("B");
        expect(r.sebab).toMatch(/BERTAHAN/);
    });

    test("trace terlalu miskin → diam, dan sebabnya disebut", () => {
        const r = cariHopBermasalah(jalur([h("A", 0, 5)]));
        expect(r.hop).toBeNull();
        expect(r.sebab).toMatch(/miskin/);
    });

    test("sebab SELALU terisi — pembaca tak pernah cuma melihat null", () => {
        for (const kasus of [[], [KOSONG], [h("A", 0, 1), h("B", 0, 2)]]) {
            expect(analisaTrace(kasus).sebab).toEqual(expect.any(String));
            expect(analisaTrace(kasus).sebab.length).toBeGreaterThan(5);
        }
    });
});

describe("#b256 — analisaTrace tidak pernah melempar", () => {
    test.each([null, undefined, [], [{}], [{ address: null }], "bukan larik"])("masukan %p aman", (x) => {
        const r = analisaTrace(x);
        expect(r).toHaveProperty("hopBermasalah");
        expect(r).toHaveProperty("sebab");
    });
});

describe("#b256 — di mana latensi bertambah (untuk keluhan game)", () => {
    const { cariLonjakanRtt } = require("../traceroute-analyzer");
    const j = (arr) => gabungkanRonde([arr]);

    test("menunjuk hop dengan tambahan RTT terbesar beserta porsinya", () => {
        // Bentuk NYATA jalur GMDP -> server Garena: 1,3 / 13,2 / 13 / 27,5 / 25,4 / 24,7 ms.
        const r = cariLonjakanRtt(j([
            h("195.168.62.1", 0, 1.3), h("10.78.0.3", 0, 13.2), h("103.124.138.13", 0, 13),
            h("10.55.2.36", 0, 27.5), h("27.111.229.81", 0, 25.4), h("103.10.124.1", 0, 24.7)
        ]));
        expect(r.dari).toBe("103.124.138.13");
        expect(r.ke).toBe("10.55.2.36");
        expect(r.deltaMs).toBeCloseTo(14.5, 1);
        expect(r.porsiPct).toBeGreaterThan(50);
    });

    test("hop diam dilewati — tak bisa menyalahkan yang tak menjawab", () => {
        const r = cariLonjakanRtt(j([h("A", 0, 5), DIAM, h("B", 0, 40)]));
        expect(r.dari).toBe("A");
        expect(r.ke).toBe("B");
    });

    test("jalur datar / terlalu pendek → null, bukan angka karangan", () => {
        expect(cariLonjakanRtt(j([h("A", 0, 10)]))).toBeNull();
        expect(cariLonjakanRtt(j([h("A", 0, 10), h("B", 0, 10)]))).toBeNull();
    });
});
