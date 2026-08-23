/**
 * Header Doc
 * Purpose: Mengunci vonis kestabilan jalur (#b255) — termasuk bahwa ambangnya berasal dari
 *          telemetri terukur, MEDIAN dipakai supaya satu target buruk tak menyesatkan, dan
 *          "belum cukup bukti" tidak pernah dibaca sebagai "baik".
 * Caller: Jest test runner.
 * Deps: `lib/latency-verdict`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const { AMBANG_BAWAAN, ringkasKualitas, vonisKualitas } = require("../latency-verdict");

// Pembentuk baris probe ringkas.
const p = (target_key, loss_pct, jitter_ms, rtt_avg_ms = 25) => ({ target_key, loss_pct, jitter_ms, rtt_avg_ms });

// Potret jam SEPI dan jam PUNCAK, angkanya dari pengukuran 30 hari yang melandasi ambang.
const JAM_SEPI = ["google", "cloudflare", "akamai", "youtube", "garena", "moonton"].map((t) => p(t, 0.05, 1.4, 23));
const JAM_PUNCAK = ["google", "cloudflare", "akamai", "youtube", "garena", "moonton"].map((t) => p(t, 3.69, 6.35, 32));

describe("#b255 — ringkasan kualitas", () => {
    test("MEDIAN mengabaikan satu target yang buruk sistematis (meta), rata-rata tidak", () => {
        // `meta` terukur loss 7,34% & RTT 264ms sepanjang 30 hari di SEMUA jalur. Dengan
        // rata-rata, ia menaikkan angka jam 20:00 dari 3,69% jadi 7,12% — dan kita akan
        // memvonis "tidak stabil" untuk jaringan yang sebenarnya cuma ramai.
        const rows = [...JAM_SEPI, p("meta", 45, 1.35, 264)];
        const r = ringkasKualitas(rows);
        expect(r.lossPct).toBeCloseTo(0.05, 2);
        const rata = rows.reduce((s, x) => s + x.loss_pct, 0) / rows.length;
        expect(rata).toBeGreaterThan(6); // buktikan rata-rata memang tertipu
    });

    test("baris gateway (hop pertama) dipisah, tidak dicampur ke angka jalur jauh", () => {
        const r = ringkasKualitas([...JAM_PUNCAK, p("gateway", 1.12, 0.13, 0.1)]);
        expect(r.sampel).toBe(6);              // gateway tidak ikut dihitung sebagai sampel jauh
        expect(r.hopPertamaLossPct).toBeCloseTo(1.12, 2);
        expect(r.lossPct).toBeCloseTo(3.69, 2);
    });

    test("tanpa baris apa pun → semuanya null, bukan 0", () => {
        const r = ringkasKualitas([]);
        expect(r.sampel).toBe(0);
        expect(r.lossPct).toBeNull();
        expect(r.jitterMs).toBeNull();
    });
});

describe("#b255 — vonis kestabilan", () => {
    test("jam sepi terukur (loss 0,05% jitter 1,4) → STABIL", () => {
        expect(vonisKualitas(ringkasKualitas(JAM_SEPI))).toBe("STABIL");
    });

    test("jam puncak terukur (loss 3,69% jitter 6,35) → KURANG_STABIL", () => {
        // Inilah keadaan saat pelanggan mengeluh "sinyal merah" — dan yang DULU divonis NORMAL
        // oleh poller karena ambangnya `lossWarnPct: 5`.
        expect(vonisKualitas(ringkasKualitas(JAM_PUNCAK))).toBe("KURANG_STABIL");
    });

    test("lutut kurva jam 18:00 (loss 2,24%) sudah masuk KURANG_STABIL, bukan STABIL", () => {
        const r = ringkasKualitas(["a", "b", "c", "d", "e", "f"].map((t) => p(t, 2.24, 4.9)));
        expect(vonisKualitas(r)).toBe("KURANG_STABIL");
    });

    test("jam 17:00 (loss 1,02% jitter 4,28) masih STABIL — ambang tidak terlalu sensitif", () => {
        const r = ringkasKualitas(["a", "b", "c", "d", "e", "f"].map((t) => p(t, 1.02, 4.28)));
        expect(vonisKualitas(r)).toBe("STABIL");
    });

    test("loss berat → TIDAK_STABIL", () => {
        const r = ringkasKualitas(["a", "b", "c", "d", "e", "f"].map((t) => p(t, 10.6, 1.6)));
        expect(vonisKualitas(r)).toBe("TIDAK_STABIL");
    });

    test("jitter berat saja (loss kecil) tetap TIDAK_STABIL — game peduli jitter", () => {
        const r = ringkasKualitas(["a", "b", "c", "d", "e", "f"].map((t) => p(t, 0.2, 31)));
        expect(vonisKualitas(r)).toBe("TIDAK_STABIL");
    });

    test("sampel kurang → TIDAK_TERPANTAU, TIDAK PERNAH dibaca 'stabil'", () => {
        const r = ringkasKualitas([p("google", 0, 0.5), p("cloudflare", 0, 0.5)]);
        expect(r.sampel).toBeLessThan(AMBANG_BAWAAN.minSampel);
        expect(vonisKualitas(r)).toBe("TIDAK_TERPANTAU");
    });

    test("ringkasan kosong/null → TIDAK_TERPANTAU", () => {
        expect(vonisKualitas(null)).toBe("TIDAK_TERPANTAU");
        expect(vonisKualitas(ringkasKualitas([]))).toBe("TIDAK_TERPANTAU");
    });

    test("ambang bisa ditimpa lewat config tanpa mengubah kode", () => {
        const r = ringkasKualitas(JAM_PUNCAK);
        expect(vonisKualitas(r, { lossPeringatanPct: 99, jitterPeringatanMs: 99, lossBurukPct: 99, jitterBurukMs: 99 })).toBe("STABIL");
    });
});
