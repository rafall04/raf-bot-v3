/**
 * Header Doc
 * Purpose: Guard mesin routing notifikasi — recipientsFor & dispatch: gate OFF = perilaku lama
 *   (ke adminFallback), gate ON + grup valid = ke grup, gate ON tanpa grup/invalid = FAIL-OPEN
 *   ke admin, @lid/@non-grup ditolak, severity memilih transport (critical→sendCritical), dan
 *   NEVER-THROW walau helper kirim melempar. Registri kategori konsisten.
 * Caller: Jest.
 * Deps: ../notif-router, ../notif-categories.
 * SideEffects: -
 */
"use strict";

const { recipientsFor, dispatch, _validGroups } = require("../notif-router");
const { categoryByKey, listCategories } = require("../notif-categories");

const ADMIN = ["6281200000001@s.whatsapp.net", "6281200000002@s.whatsapp.net"];
const GRUP = "120363000000000001@g.us";

test("registri kategori: key unik + punya defaultSeverity", () => {
    const cats = listCategories();
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats.map((c) => c.key)).size).toBe(cats.length);
    cats.forEach((c) => expect(["info", "critical"]).toContain(c.defaultSeverity));
    expect(categoryByKey("otorisasi_gagal")).toBeTruthy();
    expect(categoryByKey("ngawur")).toBeNull();
});

test("_validGroups: hanya @g.us; buang kosong/@lid/@s.whatsapp.net", () => {
    expect(_validGroups([GRUP, "", "628@lid", "628@s.whatsapp.net", null])).toEqual([GRUP]);
});

test("gate OFF → mode legacy, kirim ke adminFallback", () => {
    const cfg = { notifRouting: { enabled: false, routes: { otorisasi_gagal: { groups: [GRUP] } } } };
    const r = recipientsFor("otorisasi_gagal", { adminFallback: ADMIN, config: cfg });
    expect(r.mode).toBe("legacy");
    expect(r.recipients).toEqual(ADMIN);
});

test("gate ON + grup valid → mode group, kirim ke grup", () => {
    const cfg = { notifRouting: { enabled: true, routes: { otorisasi_gagal: { groups: [GRUP], severity: "critical" } } } };
    const r = recipientsFor("otorisasi_gagal", { adminFallback: ADMIN, config: cfg });
    expect(r.mode).toBe("group");
    expect(r.recipients).toEqual([GRUP]);
    expect(r.severity).toBe("critical");
});

test("gate ON tapi grup kosong/invalid → FAIL-OPEN ke admin", () => {
    const cfg = { notifRouting: { enabled: true, routes: { otorisasi_gagal: { groups: ["628@lid", ""] } } } };
    const r = recipientsFor("otorisasi_gagal", { adminFallback: ADMIN, config: cfg });
    expect(r.mode).toBe("fallback_admin");
    expect(r.recipients).toEqual(ADMIN);
});

test("dispatch critical → sendCritical per-JID; info → sendMessage", async () => {
    const sendCritical = jest.fn().mockResolvedValue({ ok: true });
    const sendMessage = jest.fn().mockResolvedValue({ ok: true });
    const cfgGrupCritical = { notifRouting: { enabled: true, routes: { otorisasi_gagal: { groups: [GRUP], severity: "critical" } } } };
    const r1 = await dispatch("otorisasi_gagal", { text: "halo", adminFallback: ADMIN, config: cfgGrupCritical, deps: { sendCritical, sendMessage } });
    expect(r1.sent).toBe(1);
    expect(sendCritical).toHaveBeenCalledTimes(1);
    expect(sendCritical.mock.calls[0][0]).toBe(GRUP);
    expect(sendMessage).not.toHaveBeenCalled();

    sendCritical.mockClear();
    const cfgOff = { notifRouting: { enabled: false } };
    const r2 = await dispatch("payment_request", { text: "hai", adminFallback: ADMIN, config: cfgOff, deps: { sendCritical, sendMessage } });
    expect(r2.mode).toBe("legacy");
    expect(sendMessage).toHaveBeenCalledTimes(ADMIN.length); // info → sendMessage per admin
    expect(sendCritical).not.toHaveBeenCalled();
});

test("NEVER-THROW: helper kirim melempar → tetap resolve, sent tak menghitung yang gagal", async () => {
    const sendMessage = jest.fn().mockRejectedValue(new Error("WA mati"));
    const cfg = { notifRouting: { enabled: false } };
    let hasil;
    await expect((async () => { hasil = await dispatch("payment_request", { text: "x", adminFallback: ADMIN, config: cfg, deps: { sendMessage, sendCritical: jest.fn() } }); })()).resolves.toBeUndefined();
    expect(hasil.sent).toBe(0);
});
