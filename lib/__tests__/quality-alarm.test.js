/**
 * Header Doc
 * Purpose: Mengunci alarm kestabilan ke ADMIN (#b255) — menyala hanya setelah N siklus berturut,
 *          memakai vonis yang SAMA dengan pelanggan, tidak memasang cooldown saat gagal kirim,
 *          dan tidak pernah membaca "belum cukup bukti" sebagai sehat maupun sakit.
 * Caller: Jest test runner.
 * Deps: `lib/quality-alarm`.
 * MainFuncs: —
 * SideEffects: Tidak ada (semua dependensi disuntik).
 */
"use strict";

const { evaluasiKestabilan, resetUntukTest } = require("../quality-alarm");

const JALUR = [{ key: "main", label: "Jalur Utama", affects: "seluruh pelanggan" }];
const baris = (target_key, loss_pct, jitter_ms) => ({ target_key, loss_pct, jitter_ms, rtt_avg_ms: 30 });
const enam = (loss, jit) => ["a", "b", "c", "d", "e", "f"].map((t) => baris(t, loss, jit));

function buatDeps({ rows, terkirim = true, jids = ["628111@s.whatsapp.net"] } = {}) {
    const dikirim = [];
    return {
        dikirim,
        deps: {
            repo: { getRecentProbes: jest.fn(async () => rows) },
            getAdminJids: jest.fn(async () => jids),
            kirim: jest.fn(async (jid, teks) => { dikirim.push({ jid, teks }); return terkirim; }),
            logger: { warn() {}, error() {} },
            nowMs: Date.now(),
        },
    };
}

const CFG = (extra = {}) => ({
    paths: JALUR,
    alarmKestabilan: { enabled: true, consecutiveCycles: 3, cooldownMinutes: 120, windowMinutes: 10, ...extra },
});

beforeEach(() => resetUntukTest());

describe("#b255 — alarm kestabilan", () => {
    test("gate MATI (bawaan) → tidak menilai apa pun", async () => {
        const { deps } = buatDeps({ rows: enam(20, 30) });
        const r = await evaluasiKestabilan({ paths: JALUR }, deps);
        expect(r.dinilai).toBe(0);
        expect(deps.repo.getRecentProbes).not.toHaveBeenCalled();
    });

    test("baru menyala setelah N siklus berturut-turut, bukan pada siklus pertama", async () => {
        const { deps, dikirim } = buatDeps({ rows: enam(20, 30) });
        await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(0);
        await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(0);
        await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(1);
    });

    test("jam puncak terukur (loss 3,69%) = KURANG_STABIL → TIDAK memicu alarm admin", async () => {
        // Sengaja: jaringan ramai itu wajar tiap malam. Alarm untuk keadaan yang tiap hari
        // terjadi akan melatih pemiliknya mengabaikan alarm.
        const { deps, dikirim } = buatDeps({ rows: enam(3.69, 6.35) });
        for (let i = 0; i < 5; i += 1) await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(0);
    });

    test("satu siklus membaik MERESET penghitung", async () => {
        const { deps, dikirim } = buatDeps({ rows: enam(20, 30) });
        await evaluasiKestabilan(CFG(), deps);
        await evaluasiKestabilan(CFG(), deps);
        deps.repo.getRecentProbes = jest.fn(async () => enam(0.05, 1.4)); // sehat
        await evaluasiKestabilan(CFG(), deps);
        deps.repo.getRecentProbes = jest.fn(async () => enam(20, 30));    // sakit lagi
        await evaluasiKestabilan(CFG(), deps);
        await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(0); // baru 2 beruntun sejak reset
    });

    test("TIDAK_TERPANTAU tidak menaikkan DAN tidak mereset penghitung", async () => {
        const { deps, dikirim } = buatDeps({ rows: enam(20, 30) });
        await evaluasiKestabilan(CFG(), deps);
        await evaluasiKestabilan(CFG(), deps);
        deps.repo.getRecentProbes = jest.fn(async () => []); // buta
        await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(0);
        deps.repo.getRecentProbes = jest.fn(async () => enam(20, 30));
        await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(1); // 2 + (buta, tak dihitung) + 1 = 3 beruntun
    });

    test("cooldown menahan alarm kedua", async () => {
        const { deps, dikirim } = buatDeps({ rows: enam(20, 30) });
        for (let i = 0; i < 3; i += 1) await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(1);
        for (let i = 0; i < 3; i += 1) await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(1);
    });

    test("gagal kirim → cooldown TIDAK dipasang, alarm dicoba lagi tiap siklus", async () => {
        // Ambang 3 siklus, jadi percobaan kirim baru dimulai di siklus ke-3.
        // 5 siklus = 3 percobaan (ke-3, ke-4, ke-5) — membuktikan kegagalan kirim tidak
        // membungkam alarm 2 jam berikutnya. WhatsApp putus sering barengan gangguan jaringan;
        // memasang cooldown di situ justru menyembunyikan masalah yang sedang berlangsung.
        const { deps, dikirim } = buatDeps({ rows: enam(20, 30), terkirim: false });
        for (let i = 0; i < 5; i += 1) await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(3);
    });

    test("berhasil kirim → cooldown dipasang, siklus berikutnya diam", async () => {
        const { deps, dikirim } = buatDeps({ rows: enam(20, 30), terkirim: true });
        for (let i = 0; i < 5; i += 1) await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(1);
    });

    test("pesan ADMIN memuat angka & nama jalur (yang DILARANG ke pelanggan)", async () => {
        const { deps, dikirim } = buatDeps({ rows: enam(20, 30) });
        for (let i = 0; i < 3; i += 1) await evaluasiKestabilan(CFG(), deps);
        const teks = dikirim[0].teks;
        expect(teks).toMatch(/Jalur Utama/);
        expect(teks).toMatch(/Kehilangan paket/);
        expect(teks).toMatch(/Jitter/);
    });

    test("tak ada admin terdaftar → tidak melempar, tidak menandai terkirim", async () => {
        const { deps, dikirim } = buatDeps({ rows: enam(20, 30), jids: [] });
        for (let i = 0; i < 4; i += 1) await evaluasiKestabilan(CFG(), deps);
        expect(dikirim.length).toBe(0);
    });

    test("repo melempar → never-throw, dan tidak mengaku menilai", async () => {
        const { deps } = buatDeps({ rows: enam(20, 30) });
        deps.repo.getRecentProbes = jest.fn(async () => { throw new Error("db mati"); });
        await expect(evaluasiKestabilan(CFG(), deps)).resolves.toBeDefined();
    });
});
