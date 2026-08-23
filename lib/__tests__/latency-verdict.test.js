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

    test("loss berat (p90 jam 20:00 = 20%) → TIDAK_STABIL", () => {
        const r = ringkasKualitas(["a", "b", "c", "d", "e", "f"].map((t) => p(t, 20, 1.6)));
        expect(vonisKualitas(r)).toBe("TIDAK_STABIL");
    });

    test("loss 10,6% → KURANG_STABIL, BUKAN keras: itu masih wilayah ramai biasa", () => {
        // Dulu tes ini menuntut TIDAK_STABIL (ambang lama 5%). Ambang itu membuat kalimat
        // TERKERAS muncul di 51% jendela puncak Dander — pesan sesering itu berhenti berarti.
        const r = ringkasKualitas(["a", "b", "c", "d", "e", "f"].map((t) => p(t, 10.6, 1.6)));
        expect(vonisKualitas(r)).toBe("KURANG_STABIL");
    });

    test("jitter 31ms = puncak RUTIN (p90 puncak 20-26ms) → lembut, bukan keras", () => {
        const r = ringkasKualitas(["a", "b", "c", "d", "e", "f"].map((t) => p(t, 0.2, 31)));
        expect(vonisKualitas(r)).toBe("KURANG_STABIL");
    });

    test("jitter luar biasa (45ms, di atas p95 puncak) → TIDAK_STABIL — game peduli jitter", () => {
        const r = ringkasKualitas(["a", "b", "c", "d", "e", "f"].map((t) => p(t, 0.2, 45)));
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

describe("#b255 — loss dihitung dari PAKET, bukan median antar-baris persentase", () => {
    // Probe di sini mengirim 3-5 paket, jadi loss_pct per baris cuma bisa 0/20/40/...
    // Median antar-BARIS mewarisi kuantisasi itu dan membuat ambang 2% & 5% runtuh jadi satu.
    const pkt = (target_key, sent, received, jitter_ms = 0.5) =>
        ({ target_key, sent, received, jitter_ms, rtt_avg_ms: 20 });

    test("1 paket hilang dari 5, sekali saja, TIDAK dibaca sebagai loss 20%", () => {
        // 10 siklus x 5 paket = 50 paket per target; satu hilang = 2%, bukan 20%.
        const rows = [];
        for (let i = 0; i < 10; i += 1) {
            for (const t of ["google", "cloudflare", "youtube", "akamai"]) {
                rows.push(pkt(t, 5, i === 0 && t === "google" ? 4 : 5));
            }
        }
        const r = ringkasKualitas(rows);
        expect(r.lossPct).toBeLessThan(1);
        expect(vonisKualitas(r)).toBe("STABIL");
    });

    test("satu target buruk sendirian tidak menggeser vonis (kasus `meta` terukur 6,54%)", () => {
        const rows = [];
        for (let i = 0; i < 10; i += 1) {
            for (const t of ["google", "cloudflare", "youtube", "akamai"]) rows.push(pkt(t, 5, 5));
            rows.push(pkt("meta", 5, 2)); // 60% loss, konsisten sepanjang jendela
        }
        const r = ringkasKualitas(rows);
        expect(r.lossPct).toBe(0);
        expect(vonisKualitas(r)).toBe("STABIL");
    });

    test("degradasi MERATA di semua target tetap tertangkap", () => {
        const rows = [];
        for (let i = 0; i < 10; i += 1) {
            for (const t of ["google", "cloudflare", "youtube", "akamai"]) rows.push(pkt(t, 5, 4));
        }
        const r = ringkasKualitas(rows);
        expect(r.lossPct).toBe(20);
        expect(vonisKualitas(r)).toBe("TIDAK_STABIL");
    });

    test("baris lama tanpa sent/received tetap terbaca (jangan dianggap sempurna)", () => {
        const rows = ["a", "b", "c", "d", "e", "f"].map((t) => ({ target_key: t, loss_pct: 30, jitter_ms: 1, rtt_avg_ms: 20 }));
        const r = ringkasKualitas(rows);
        expect(r.lossPct).toBe(30);
        expect(vonisKualitas(r)).toBe("TIDAK_STABIL");
    });

    test("hop pertama dihitung dengan cara yang sama dan tetap terpisah", () => {
        const rows = [];
        for (let i = 0; i < 10; i += 1) {
            for (const t of ["google", "cloudflare", "youtube", "akamai"]) rows.push(pkt(t, 5, 5));
            rows.push(pkt("gateway", 3, 2)); // hop1 rusak, target jauh bersih
        }
        const r = ringkasKualitas(rows);
        expect(r.lossPct).toBe(0);
        expect(Math.round(r.hopPertamaLossPct)).toBe(33);
        // Hop1 sengaja TIDAK ikut memvonis jalur — artinya beda, dan itu urusan admin.
        expect(vonisKualitas(r)).toBe("STABIL");
    });
});
