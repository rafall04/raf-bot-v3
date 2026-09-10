/**
 * Header Doc
 * Purpose: Guard P2 — registri feature-flags: readFlags (status enabled dari config, dukung path
 *   bersarang), applyFlag (set immutable jalur bersarang), flagByKey. Menopang panel toggle /feature-flags.
 * Caller: Jest.
 * Deps: ../feature-flags.
 * SideEffects: -
 */
"use strict";

const { FEATURE_FLAGS, readFlags, applyFlag, flagByKey, getFlagEnabled } = require("../feature-flags");

test("readFlags: baca enabled dari config, default false bila absen", () => {
    const cfg = { teknisiPrefs: { enabled: true }, customerAssist: { fallback: { enabled: true } } };
    const flags = readFlags(cfg);
    const tp = flags.find((f) => f.key === "teknisiPrefs");
    const caf = flags.find((f) => f.key === "customerAssistFallback");
    const rw = flags.find((f) => f.key === "redamanWatch");
    expect(tp.enabled).toBe(true);
    expect(caf.enabled).toBe(true); // path bersarang customerAssist.fallback.enabled
    expect(rw.enabled).toBe(false); // absen → false
    expect(flags.length).toBe(FEATURE_FLAGS.length);
    expect(flags[0]).toHaveProperty("label");
    expect(flags[0]).toHaveProperty("kategori");
});

test("applyFlag: set nilai immutable + tak sentuh key lain", () => {
    const cfg = { teknisiPrefs: { enabled: false, other: 1 }, lain: { x: 2 } };
    const next = applyFlag(cfg, "teknisiPrefs", true);
    expect(next.teknisiPrefs.enabled).toBe(true);
    expect(next.teknisiPrefs.other).toBe(1);       // subfield lain terjaga
    expect(next.lain).toEqual({ x: 2 });            // key lain utuh
    expect(cfg.teknisiPrefs.enabled).toBe(false);   // sumber tak dimutasi (immutable)
});

test("applyFlag: buat jalur bersarang bila belum ada", () => {
    const next = applyFlag({}, "customerAssistFallback", true);
    expect(next.customerAssist.fallback.enabled).toBe(true);
});

test("applyFlag: key tak dikenal → lempar", () => {
    expect(() => applyFlag({}, "ngawur", true)).toThrow(/tak dikenal/i);
});

test("flagByKey + getFlagEnabled konsisten", () => {
    expect(flagByKey("paymentRequestWa")).toBeTruthy();
    expect(flagByKey("ngawur")).toBeNull();
    expect(getFlagEnabled({ paymentRequestWa: { enabled: true } }, flagByKey("paymentRequestWa"))).toBe(true);
});
