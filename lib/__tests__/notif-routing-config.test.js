/**
 * Header Doc
 * Purpose: Guard helper mutasi config.notifRouting (halaman /notif-routing) — readRouting merangkum
 *   status per kategori; setEnabled/setRoute immutable + sanitasi grup (@g.us saja, buang @lid/dup);
 *   kategori tak dikenal → lempar.
 * Caller: Jest.
 * Deps: ../notif-routing-config, ../notif-categories.
 * SideEffects: -
 */
"use strict";

const { readRouting, setEnabled, setRoute, sanitizeGroups } = require("../notif-routing-config");
const { listCategories } = require("../notif-categories");

const GRUP = "120363000000000001@g.us";
const GRUP2 = "120363000000000002@g.us";

test("readRouting: enabled + tiap kategori dgn grup & severity efektif", () => {
    const cfg = { notifRouting: { enabled: true, routes: { otorisasi_gagal: { groups: [GRUP], severity: "critical" } } } };
    const r = readRouting(cfg);
    expect(r.enabled).toBe(true);
    expect(r.categories.length).toBe(listCategories().length);
    const og = r.categories.find((c) => c.key === "otorisasi_gagal");
    expect(og.groups).toEqual([GRUP]);
    expect(og.severity).toBe("critical");
    const pr = r.categories.find((c) => c.key === "payment_request");
    expect(pr.groups).toEqual([]); // absen → kosong
    expect(pr.severity).toBe(pr.defaultSeverity);
});

test("sanitizeGroups: hanya @g.us, buang @lid/kosong/dup", () => {
    expect(sanitizeGroups([GRUP, GRUP, "", "628@lid", "628@s.whatsapp.net", GRUP2])).toEqual([GRUP, GRUP2]);
});

test("setEnabled: immutable + jaga routes", () => {
    const cfg = { notifRouting: { enabled: false, routes: { x: { groups: [] } } }, lain: 1 };
    const next = setEnabled(cfg, true);
    expect(next.notifRouting.enabled).toBe(true);
    expect(next.notifRouting.routes).toEqual({ x: { groups: [] } });
    expect(next.lain).toBe(1);
    expect(cfg.notifRouting.enabled).toBe(false); // sumber tak dimutasi
});

test("setRoute: set grup+severity immutable, sanitasi diterapkan", () => {
    const next = setRoute({}, "los_alarm", { groups: [GRUP, "628@lid"], severity: "critical" });
    expect(next.notifRouting.routes.los_alarm.groups).toEqual([GRUP]);
    expect(next.notifRouting.routes.los_alarm.severity).toBe("critical");
});

test("setRoute: kategori tak dikenal → lempar", () => {
    expect(() => setRoute({}, "ngawur", { groups: [] })).toThrow(/tak dikenal/i);
});
