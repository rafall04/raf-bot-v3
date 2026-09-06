/**
 * Header Doc
 * Purpose: Mengunci logika BERSAMA "reaktivasi pasca-lunas perlu perhatian admin" (#b333) yang
 *   dipakai SEMUA permukaan settlement (WA konfirmasi bukti, web konfirmasi-bayar, callback
 *   iPaymu/Tripay/Mayar). Sebelumnya tiap permukaan menilai sendiri & menyimpang — pelanggan bisa
 *   bayar tapi MASIH terisolir tanpa ada yang tahu.
 * Caller: Jest.
 * Deps: lib/services/reactivation-outcome (deps di-inject).
 * SideEffects: -
 */
"use strict";

const { reactivationNeedsAttention, describeReactivation, alertReaktivasiGagal } =
    require("../reactivation-outcome");

describe("reactivationNeedsAttention — pelanggan mungkin MASIH terisolir?", () => {
    test("dicoba tapi GAGAL → perlu perhatian", () => {
        expect(reactivationNeedsAttention({ attempted: true, ok: false })).toBe(true);
    });
    test("router tak terbaca (profile_read_failed) → perlu perhatian (BUTA)", () => {
        expect(reactivationNeedsAttention({ attempted: false, reason: "profile_read_failed" })).toBe(true);
    });
    test("dicoba & SUKSES → tidak", () => {
        expect(reactivationNeedsAttention({ attempted: true, ok: true })).toBe(false);
    });
    test("pelanggan memang tidak terisolir → tidak", () => {
        expect(reactivationNeedsAttention({ attempted: false, reason: "not_isolated" })).toBe(false);
    });
    test("tanpa pppoe / tanpa config isolir → tidak (benign)", () => {
        expect(reactivationNeedsAttention({ attempted: false, reason: "no_pppoe" })).toBe(false);
        expect(reactivationNeedsAttention({ attempted: false, reason: "no_isolir_profile_config" })).toBe(false);
    });
    test("null/undefined → tidak", () => {
        expect(reactivationNeedsAttention(null)).toBe(false);
        expect(reactivationNeedsAttention(undefined)).toBe(false);
    });
});

describe("describeReactivation — catatan untuk pesan admin", () => {
    test("sukses → 'sudah diaktifkan kembali'", () => {
        expect(describeReactivation({ attempted: true, ok: true })).toMatch(/diaktifkan kembali/i);
    });
    test("gagal → 'GAGAL — cek profil'", () => {
        expect(describeReactivation({ attempted: true, ok: false })).toMatch(/GAGAL/);
    });
    test("router tak terbaca → 'pastikan manual ... mungkin masih terisolir'", () => {
        expect(describeReactivation({ attempted: false, reason: "profile_read_failed" })).toMatch(/masih terisolir/i);
    });
    test("benign → string kosong", () => {
        expect(describeReactivation({ attempted: false, reason: "not_isolated" })).toBe("");
        expect(describeReactivation(null)).toBe("");
    });
});

describe("alertReaktivasiGagal — alarm admin, never-throw", () => {
    function depsPalsu(over = {}) {
        const dikirim = [];
        return {
            dikirim,
            deps: {
                getAdminJids: () => ["628111@s.whatsapp.net", "628222@s.whatsapp.net"],
                sendCritical: async (jid, payload, opts) => { dikirim.push({ jid, payload, opts }); },
                renderTemplate: (key, data) => `[${key}] ${data.nama_pelanggan}|${data.pppoe}|${data.reference_id}`,
                ...over,
            },
        };
    }

    test("kirim ke SEMUA admin dengan nama/pppoe/ref di teks", async () => {
        const p = depsPalsu();
        const ok = await alertReaktivasiGagal(
            { user: { name: "Budi", pppoe_username: "budi" }, refId: "REF-9" }, p.deps
        );
        expect(ok).toBe(true);
        expect(p.dikirim).toHaveLength(2);
        expect(p.dikirim[0].payload.text).toContain("Budi");
        expect(p.dikirim[0].payload.text).toContain("budi");
        expect(p.dikirim[0].payload.text).toContain("REF-9");
        expect(p.dikirim[0].opts.label).toBe("tagihan-reaktivasi-gagal");
    });

    test("tak ada admin → return false, tak melempar", async () => {
        const p = depsPalsu({ getAdminJids: () => [] });
        await expect(alertReaktivasiGagal({ user: {}, refId: "x" }, p.deps)).resolves.toBe(false);
    });

    test("satu admin gagal dikirimi TIDAK menghentikan sisanya", async () => {
        let n = 0;
        const dikirim = [];
        const deps = {
            getAdminJids: () => ["a@s.whatsapp.net", "b@s.whatsapp.net"],
            sendCritical: async (jid, payload) => { n++; if (n === 1) throw new Error("WA putus"); dikirim.push({ jid, payload }); },
            renderTemplate: () => "teks",
        };
        const ok = await alertReaktivasiGagal({ user: { name: "X" }, refId: "y" }, deps);
        expect(n).toBe(2);
        expect(ok).toBe(true); // admin kedua tetap terkirim
    });

    test("renderTemplate melempar → never-throw, return false", async () => {
        const deps = {
            getAdminJids: () => ["a@s.whatsapp.net"],
            sendCritical: async () => {},
            renderTemplate: () => { throw new Error("template hilang"); },
        };
        await expect(alertReaktivasiGagal({ user: {}, refId: "z" }, deps)).resolves.toBe(false);
    });
});
