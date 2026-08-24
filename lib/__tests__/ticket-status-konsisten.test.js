/**
 * Header Doc
 * Purpose: Mengunci SATU kosakata status tiket (#b265) di semua permukaan — workflow, rute admin,
 *          bot WhatsApp (admin & teknisi), dan halaman web. Bug aslinya: tombol Batalkan admin
 *          menulis `dibatalkan`, ejaan itu tak dikenal, lalu status DIPULANGKAN ke `baru` — tiket
 *          yang sudah dibatalkan tampak terbuka lagi.
 * Caller: Jest test runner.
 * Deps: `lib/ticket-workflow`, pembacaan sumber lintas-permukaan.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const repoRoot = path.join(__dirname, "..", "..");
const wf = require("../ticket-workflow");
const baca = (...p) => fs.readFileSync(path.join(repoRoot, ...p), "utf8");

describe("#b265 — satu kosakata, banyak ejaan", () => {
    test.each([
        ["dibatalkan", "cancelled"],
        ["batal", "cancelled"],
        ["Dibatalkan Admin", "cancelled"],
        ["dibatalkan pelanggan", "cancelled"],
        ["canceled", "cancelled"],
        ["selesai", "completed"],
        ["resolved", "completed"],
        ["done", "completed"],
        ["diproses teknisi", "process"],
        ["open", "baru"],
        ["cancelled", "cancelled"],
        ["completed", "completed"]
    ])("normalizeStatus(%p) -> %p", (masuk, harap) => {
        expect(wf.normalizeStatus(masuk)).toBe(harap);
    });
});

describe("#b265 — !! status tak dikenal TIDAK boleh membuka kembali tiket", () => {
    test("ensureTicketShape TIDAK memulangkan `dibatalkan` jadi `baru`", () => {
        // Ini bug aslinya, terbukti di produksi: 2 tiket berstatus `baru` tapi ber-`cancelled_by`.
        const t = { ticketId: "T1", status: "dibatalkan", cancelled_by: "admin" };
        wf.ensureTicketShape(t);
        expect(t.status).toBe("cancelled");
        expect(t.status).not.toBe("baru");
    });

    test("ejaan yang benar-benar asing dipertahankan, bukan direset ke `baru`", () => {
        // Memulangkan ke `baru` memutar tiket TERMINAL jadi terbuka — jauh lebih mahal daripada
        // status aneh yang kelihatan. Dan sekarang ada peringatannya di log.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const t = { ticketId: "T2", status: "ejaan-yang-belum-ada" };
        wf.ensureTicketShape(t);
        expect(t.status).toBe("ejaan-yang-belum-ada");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    test("tiket selesai tetap selesai setelah dibentuk ulang", () => {
        const t = { ticketId: "T3", status: "selesai", completedAt: new Date().toISOString() };
        wf.ensureTicketShape(t);
        expect(t.status).toBe("completed");
    });
});

describe("#b265 — rute admin tidak menulis status sendiri", () => {
    const src = baca("routes", "tickets-admin-routes.js");

    test("pembatalan lewat cancelTicket (dapat penjaga transisi + idempoten)", () => {
        expect(src).toMatch(/cancelTicket\(\{/);
        expect(src).not.toMatch(/report\.status = 'dibatalkan'/);
    });

    test("keadaan yang menolak aksi dibalas 409, bukan 500", () => {
        // "Tiket sudah selesai" bukan kesalahan server; UI harus bisa menjelaskannya.
        expect(src).toMatch(/ALREADY_COMPLETED/);
        expect(src).toMatch(/status\(409\)/);
    });

    test("log aktivitas mencatat ejaan KANONIK", () => {
        expect(src).toMatch(/newValue: \{ status: 'cancelled'/);
    });
});

describe("#b265 — permukaan WhatsApp membaca lewat normalizeStatus", () => {
    test("daftar tiket admin tidak lagi membandingkan ejaan mentah", () => {
        // Dulu hanya mengenal `baru`/`diproses teknisi`/`selesai`, sehingga SEMUA tiket ber-status
        // kanonik (`process`, `completed`, ...) jatuh ke ❌ — admin melihat "gagal" untuk tiket
        // yang sedang dikerjakan maupun yang sudah selesai.
        const src = baca("message", "handlers", "admin-handler.js");
        expect(src).toMatch(/normalizeTicketStatus\(report\.status\)/);
        expect(src).not.toMatch(/report\.status === 'diproses teknisi'/);
    });

    test("intent teknisi 'tiket selesai' mengenali ejaan kanonik", () => {
        const src = baca("message", "handlers", "raf-intent-dispatch", "ticket-teknisi-intents.js");
        expect(src).toMatch(/normalizeStatus\(report\.status\) === "completed"/);
        expect(src).not.toMatch(/report\.status === 'selesai'/);
    });

    test("workflow teknisi memakai satu variabel status ternormalkan", () => {
        const src = baca("message", "handlers", "teknisi-workflow-handler.js");
        expect(src).toMatch(/const stNow = require\(.*ticket-workflow.*\)\.normalizeStatus\(ticket\.status\)/);
        expect(src).not.toMatch(/ticket\.status === 'selesai'/);
    });
});

describe("#b265 — halaman web sepakat dengan kosakata server", () => {
    const src = baca("static", "js", "tiket.js");

    test("normalizer admin memetakan SEMUA ejaan pembatalan & penyelesaian", () => {
        const m = src.match(/function normalizeTicketStatusAdmin[\s\S]*?\n        \}/);
        expect(m).toBeTruthy();
        const fn = new Function("return (" + m[0] + ")")();
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        ["dibatalkan", "batal", "cancelled", "dibatalkan admin"].forEach((s) => expect(fn(s)).toBe("cancelled"));
        ["selesai", "resolved", "completed", "closed", "done"].forEach((s) => expect(fn(s)).toBe("completed"));
        warn.mockRestore();
    });

    test("tombol Batalkan tersembunyi untuk SEMUA ejaan terminal", () => {
        const m = src.match(/function normalizeTicketStatusAdmin[\s\S]*?\n        \}/);
        const fn = new Function("return (" + m[0] + ")")();
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const terminal = ["dibatalkan", "batal", "cancelled", "selesai", "completed", "closed", "resolved"];
        terminal.forEach((s) => {
            const n = fn(s);
            const bolehBatal = n !== "completed" && n !== "cancelled";
            expect(bolehBatal).toBe(false);
        });
        // Yang masih terbuka tetap bisa dibatalkan.
        ["baru", "process", "otw", "arrived", "working"].forEach((s) => {
            const n = fn(s);
            expect(n !== "completed" && n !== "cancelled").toBe(true);
        });
        warn.mockRestore();
    });
});

describe("#b265 — sapu bersih: tak ada lagi perbandingan status MENTAH di jalur tiket", () => {
    // Guard ini memindai REPO, bukan daftar manual — ejaan lama yang kembali di berkas baru pun
    // ikut ketahuan. Terbukti perlu: penulisan pertama perbaikan ini melewatkan dua tempat di
    // `admin-handler.js` (filter daftar & penanda teknisi), dan guard inilah yang menemukannya.
    const BERKAS = [
        ["message", "handlers", "admin-handler.js"],
        ["message", "handlers", "teknisi-workflow-handler.js"],
        ["message", "handlers", "raf-intent-dispatch", "ticket-teknisi-intents.js"],
        ["routes", "tickets-admin-routes.js"]
    ];
    // Ejaan LAMA yang tak boleh lagi dibandingkan mentah ke `.status`.
    const POLA = /\.status\s*===\s*['"](selesai|diproses teknisi|dibatalkan|batal|resolved)['"]/;

    test.each(BERKAS)("%s/%s/%s bebas perbandingan status mentah", (...bagian) => {
        const isi = baca(...bagian);
        // Buang komentar supaya penjelasan yang MENGUTIP pola lama tak ikut terhitung.
        const kode = isi
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .split("\n")
            .map((b) => b.replace(/(^|[^:])\/\/.*$/, "$1"))
            .join("\n");
        expect(kode).not.toMatch(POLA);
    });
});
